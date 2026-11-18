import { describe, expect, it } from 'vitest';
import { schedule, INTERVAL_DAYS, masteryOf } from './srs';
import { gradeAnswer, editDistance } from './grading';
import { pickBatch } from './queue';
import { answer, next, startSession, type Ctx } from './session';
import { createCard } from './factory';
import { convertLegacy } from './legacy';
import { levelOf, streakOf, buildTimeline } from './stats';
import { DEFAULT_SETTINGS, type Card, type ReviewLog } from './types';
import { addDays, startOfDay } from './time';
import { sanitizeCards, sanitizeEmoji, normalizeOx } from '../shared/generation';

const NOW = new Date(2026, 10, 17, 9, 30).getTime();
const today = startOfDay(NOW);

function card(partial: Partial<Card> = {}): Card {
  return {
    ...createCard('deck-1', { type: 'multiple_choice', question: 'Q', answer: 'A', options: ['A', 'B', 'C', 'D'] }, 'ai', NOW - 1000),
    ...partial,
  };
}

describe('srs.schedule', () => {
  it('follows 1 → 3 → 7 → 14 days on consecutive correct answers', () => {
    let c = card();
    const dues: number[] = [];
    let t = NOW;
    for (let i = 0; i < 4; i += 1) {
      c = { ...c, ...schedule(c, 'good', t) };
      dues.push(Math.round((c.due - startOfDay(t)) / 86400000));
      t = c.due + 3600_000;
    }
    expect(dues).toEqual([1, 3, 7, 14]);
    expect(c.box).toBe(4);
  });

  it('resets to tomorrow on a miss and counts the lapse', () => {
    const c = card({ box: 5, due: NOW - 1, reps: 6, correctCount: 6 });
    const s = schedule(c, 'again', NOW);
    expect(s.box).toBe(1);
    expect(s.due).toBe(addDays(today, 1));
    expect(s.lapses).toBe(1);
    expect(s.lastWrongAt).toBe(NOW);
  });

  it('does not push the schedule when answered early', () => {
    const c = card({ box: 3, due: addDays(today, 5), reps: 3, correctCount: 3 });
    const s = schedule(c, 'good', NOW);
    expect(s.box).toBe(3);
    expect(s.due).toBe(c.due);
    expect(s.reps).toBe(4);
  });

  it('hard keeps the interval', () => {
    const c = card({ box: 3, due: NOW - 1, reps: 3, correctCount: 3 });
    const s = schedule(c, 'hard', NOW);
    expect(s.box).toBe(3);
    expect(s.due).toBe(addDays(today, INTERVAL_DAYS[3]));
  });

  it('caps at the last box and maps mastery', () => {
    const c = card({ box: 7, due: NOW - 1, reps: 10 });
    expect(schedule(c, 'good', NOW).box).toBe(7);
    expect(masteryOf(card())).toBe('new');
    expect(masteryOf(card({ box: 2, reps: 2 }))).toBe('learning');
    expect(masteryOf(card({ box: 5, reps: 5 }))).toBe('mastered');
  });
});

describe('grading', () => {
  it('handles OX aliases', () => {
    expect(gradeAnswer({ type: 'ox', answer: 'O' }, 'O').correct).toBe(true);
    expect(gradeAnswer({ type: 'ox', answer: 'X' }, 'O').correct).toBe(false);
    expect(normalizeOx('참')).toBe('O');
  });

  it('accepts alternatives, parentheses and synonyms for short answers', () => {
    const c = { type: 'short_answer' as const, answer: '엽록체(chloroplast)', acceptedAnswers: ['클로로플라스트'] };
    expect(gradeAnswer(c, '엽록체').correct).toBe(true);
    expect(gradeAnswer(c, 'Chloroplast').correct).toBe(true);
    expect(gradeAnswer(c, '클로로플라스트').correct).toBe(true);
    expect(gradeAnswer(c, '미토콘드리아').correct).toBe(false);
    expect(gradeAnswer(c, '').correct).toBe(false);
  });

  it('forgives small typos on longer answers but not on numbers or short words', () => {
    const long = { type: 'short_answer' as const, answer: '미토콘드리아' };
    expect(gradeAnswer(long, '미토콘드리야')).toEqual({ correct: true, typo: true });
    expect(gradeAnswer({ type: 'short_answer', answer: '1945' }, '1946').correct).toBe(false);
    expect(gradeAnswer({ type: 'short_answer', answer: '산소' }, '산수').correct).toBe(false);
    expect(editDistance('kitten', 'sitting')).toBe(3);
  });
});

describe('queue.pickBatch', () => {
  it('puts overdue cards first, then new cards within the allowance, then practice', () => {
    const due1 = card({ id: 'due-old', box: 2, reps: 2, due: NOW - 3 * 86400000 });
    const due2 = card({ id: 'due-new', box: 2, reps: 2, due: NOW - 86400000 });
    const fresh = [1, 2, 3].map(i => card({ id: `new-${i}`, createdAt: NOW + i }));
    const later = card({ id: 'later', box: 3, reps: 3, due: NOW + 5 * 86400000, lapses: 2, lastWrongAt: NOW - 3600_000 });
    const picks = pickBatch({ cards: [later, ...fresh, due2, due1], now: NOW, size: 5, newAllowance: 2, random: () => 0 });
    expect(picks.map(p => p.id)).toEqual(['due-old', 'due-new', 'new-1', 'new-2', 'later']);
    expect(picks.map(p => p.reason)).toEqual(['due', 'due', 'new', 'new', 'practice']);
  });

  it('skips deleted, suspended and excluded cards and never repeats within a batch', () => {
    const cards = [card({ id: 'a' }), card({ id: 'b', deletedAt: NOW }), card({ id: 'c', suspended: true }), card({ id: 'd' })];
    const picks = pickBatch({ cards, now: NOW, size: 10, newAllowance: 10, exclude: new Set(['d']) });
    expect(picks.map(p => p.id)).toEqual(['a']);
  });
});

describe('session engine', () => {
  const ctx = (cards: Card[], logs: ReviewLog[] = []): Ctx => ({ cards, logs, settings: DEFAULT_SETTINGS, now: NOW });

  it('requeues a missed card a few positions later and does not count the retry as progress', () => {
    const cards = ['a', 'b', 'c', 'd', 'e'].map(id => card({ id }));
    let s = startSession({ mode: 'review', title: 't', stops: 1 }, ctx(cards));
    expect(s.target).toBe(5);
    const first = cards.find(c => c.id === s.queue[0].id)!;
    const out = answer(s, first, { userAnswer: 'B' }, NOW);
    expect(out.correct).toBe(false);
    expect(out.xp).toBe(2);
    s = next(out.session, ctx(cards));
    expect(s.queue.map(q => q.id).indexOf(first.id)).toBe(3);
    expect(s.queue.find(q => q.id === first.id)!.retry).toBe(true);
    expect(s.queue).toHaveLength(5);
    expect(s.firstAnswered).toBe(1);
    // Missing the retry too doesn't queue it a third time.
    for (let i = 0; i < 3; i += 1) s = next(answer(s, cards.find(c => c.id === s.queue[0].id)!, { userAnswer: 'A' }, NOW).session, ctx(cards));
    expect(s.queue[0]).toMatchObject({ id: first.id, retry: true });
    s = next(answer(s, first, { userAnswer: 'B' }, NOW).session, ctx(cards));
    expect(s.queue.filter(q => q.id === first.id)).toHaveLength(0);
  });

  it('awards a combo bonus every 5 in a row', () => {
    const cards = Array.from({ length: 6 }, (_, i) => card({ id: `c${i}` }));
    let s = startSession({ mode: 'deck', deckId: 'deck-1', title: 't', stops: 2 }, ctx(cards));
    const xps: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const c = cards.find(x => x.id === s.queue[0].id)!;
      const out = answer(s, c, { userAnswer: 'A' }, NOW + i);
      xps.push(out.xp);
      s = next(out.session, ctx(cards));
    }
    expect(xps).toEqual([10, 10, 10, 10, 15]);
    expect(s.bestCombo).toBe(5);
  });

  it('keeps the infinite feed going even with a tiny deck', () => {
    const cards = [card({ id: 'only', box: 1, reps: 1, due: NOW + 86400000 })];
    let s = startSession({ mode: 'infinite', title: 't', stops: null }, ctx(cards));
    for (let i = 0; i < 6; i += 1) {
      expect(s.queue.length).toBeGreaterThan(0);
      const out = answer(s, cards[0], { userAnswer: 'A' }, NOW + i);
      s = next(out.session, ctx(cards));
    }
    expect(s.firstAnswered).toBe(6);
  });

  it('marks the first-ever answer as new and respects the daily new-card cap', () => {
    const cards = Array.from({ length: 30 }, (_, i) => card({ id: `n${i}`, createdAt: NOW + i }));
    const logs = Array.from({ length: 19 }, (_, i) => ({ id: `l${i}`, wasNew: true, at: NOW - 1000 }) as ReviewLog);
    const s = startSession({ mode: 'review', title: 't', stops: 1 }, ctx(cards, logs));
    // 1 new card allowed by the cap, then (no reviewed cards to practice) more new cards fill the stop.
    expect(s.queue[0].reason).toBe('new');
    expect(s.queue).toHaveLength(5);
    const out = answer(s, cards.find(c => c.id === s.queue[0].id)!, { userAnswer: 'A' }, NOW);
    expect(out.log.wasNew).toBe(true);
  });
});

describe('sanitizeCards', () => {
  it('drops malformed items and fixes recoverable ones', () => {
    const raw = [
      { type: 'multiple_choice', question: 'Q1', options: ['가', '나', '다', '라'], answer: '나 ', concept: 'x' },
      { type: 'multiple_choice', question: 'Q2', options: ['가', '나'], answer: '마' },
      { type: 'ox', question: 'Q3', answer: 'true' },
      { type: 'ox', question: 'Q4', answer: 'maybe' },
      { type: 'short_answer', question: 'Q5', answer: '산소', accepted_answers: ['산소', 'O2', 'oxygen'] },
      { type: 'flashcard', question: 'Q1', answer: 'dup' },
      { type: 'essay', question: 'Q6', answer: 'nope' },
      'garbage',
    ];
    const out = sanitizeCards(raw, ['multiple_choice', 'ox', 'short_answer', 'flashcard']);
    expect(out.map(c => c.question)).toEqual(['Q1', 'Q3', 'Q5']);
    expect(out[0].answer).toBe('나');
    expect(out[1].answer).toBe('O');
    expect(out[2].acceptedAnswers).toEqual(['O2', 'oxygen']);
  });

  it('respects the avoid list and keeps one emoji', () => {
    expect(sanitizeCards([{ type: 'ox', question: 'Old one', answer: 'O' }], ['ox'], ['old one!'])).toHaveLength(0);
    expect(sanitizeEmoji('🌱🌿 식물')).toBe('🌱');
    expect(sanitizeEmoji('plant')).toBe('');
  });
});

describe('legacy conversion', () => {
  it('turns v1 sessions, flashcards and attempts into decks, cards and scheduled logs', () => {
    const { decks, cards, logs } = convertLegacy({
      sessions: [{
        id: 's1',
        sourceText: '광합성 자료',
        createdAt: '2026-09-01T00:00:00Z',
        questions: [
          { type: 'multiple_choice', question: '광합성 장소?', options: ['엽록체', '핵'], answer: '엽록체', concept: '광합성' },
          { type: 'ox', question: '빛이 필요하다', answer: 'O', concept: '광합성' },
        ],
      }],
      flashcardSets: [{ id: 'f1', sourceText: 'terms', createdAt: '2026-09-02T00:00:00Z', flashcards: [{ term: 'ATP', definition: '에너지 화폐' }] }],
      attempts: [{
        id: 'a1',
        createdAt: '2026-09-03T00:00:00Z',
        items: [{ question: '광합성 장소?', type: 'multiple_choice', concept: '광합성', userAnswer: '엽록체', correctAnswer: '엽록체', isCorrect: true }],
      }],
    });
    expect(decks.map(d => d.title)).toEqual(['광합성 퀴즈', 'terms']);
    expect(cards).toHaveLength(3);
    const answered = cards.find(c => c.id === 's1:q0')!;
    expect(answered.box).toBe(1);
    expect(answered.reps).toBe(1);
    expect(logs[0]).toMatchObject({ id: 'a1:0', cardId: 's1:q0', correct: true });
  });
});

describe('stats', () => {
  const log = (at: number, correct = true, extra: Partial<ReviewLog> = {}) =>
    ({ id: `${at}-${Math.random()}`, at, correct, type: 'ox', concept: '', xp: 10, ...extra }) as ReviewLog;

  it('counts a streak only for days with a full stop, without breaking on an unfinished today', () => {
    const day = (d: number, n: number) => Array.from({ length: n }, (_, i) => log(addDays(today, -d) + 3600_000 + i));
    const logs = [...day(1, 5), ...day(2, 7), ...day(3, 2), ...day(0, 3)];
    expect(streakOf(logs, NOW)).toEqual({ days: 2, todayDone: false });
    expect(streakOf([...logs, ...day(0, 2)], NOW)).toEqual({ days: 3, todayDone: true });
  });

  it('levels at 0, 100, 300, 600 XP', () => {
    expect(levelOf(0).level).toBe(1);
    expect(levelOf(99).level).toBe(1);
    expect(levelOf(100).level).toBe(2);
    expect(levelOf(300).level).toBe(3);
    expect(levelOf(650)).toMatchObject({ level: 4, into: 50, span: 400 });
  });

  it('excludes retries from accuracy timelines', () => {
    const points = buildTimeline([log(NOW, false), log(NOW + 1, true, { retry: true })], '7d', NOW);
    expect(points.at(-1)).toMatchObject({ total: 1, correct: 0 });
  });
});
