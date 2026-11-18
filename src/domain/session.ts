// Pure session engine: which card comes next, what an answer does to the card and the session.
// The UI (hooks/useSession) applies the returned card patch and log to the store.
import type { Card, Grade, ReviewLog, Settings, StudyMode } from './types';
import { STOP_SIZE } from './types';
import { gradeAnswer } from './grading';
import { conceptCards, examCards, isActive, pickBatch, shuffle, type PickReason } from './queue';
import { isNew, schedule } from './srs';
import { XP, newIntroducedToday } from './stats';
import { newId } from './factory';

export type SessionConfig = {
  mode: StudyMode;
  title: string;
  deckId?: string;
  concept?: string;
  cardIds?: string[];
  // null = infinite
  stops: number | null;
};

export type QueueItem = { id: string; retry: boolean; reason: PickReason | 'retry' | 'fixed' };

export type SessionAnswer = {
  cardId: string;
  correct: boolean;
  grade: Grade;
  userAnswer: string;
  typo?: boolean;
  retry: boolean;
  xp: number;
  at: number;
};

export type Session = {
  id: string;
  config: SessionConfig;
  queue: QueueItem[];
  // First-try answers this session needs (null = infinite).
  target: number | null;
  firstAnswered: number;
  answers: SessionAnswer[];
  combo: number;
  bestCombo: number;
  xp: number;
  startedAt: number;
  updatedAt: number;
  // Increments whenever the head card changes; the UI keys each card view on it.
  step: number;
  // Recently shown ids, so the infinite feed doesn't repeat a card right away.
  recent: string[];
  examAnswers: Record<string, string>;
  // Options shuffled once per card per session, so going back/resuming shows the same order.
  optionOrder: Record<string, string[]>;
};

export type Ctx = { cards: Card[]; logs: ReviewLog[]; settings: Settings; now: number };

const RETRY_GAP = 3;
const RECENT_WINDOW = 12;
const REFILL_BELOW = 3;
const INFINITE_BATCH = 10;
export const EXAM_LIMIT = 20;

function scopedCards(config: SessionConfig, cards: Card[]) {
  const active = cards.filter(isActive);
  if (config.cardIds) {
    const byId = new Map(active.map(c => [c.id, c]));
    return config.cardIds.map(id => byId.get(id)).filter((c): c is Card => !!c);
  }
  if (config.mode === 'starred') return active.filter(c => c.starred);
  if (config.deckId) return active.filter(c => c.deckId === config.deckId);
  return active;
}

function newAllowance(config: SessionConfig, ctx: Ctx) {
  // Studying a specific deck is an explicit choice: no daily cap there.
  if (config.deckId || config.cardIds || config.concept) return Infinity;
  return Math.max(0, ctx.settings.newPerDay - newIntroducedToday(ctx.logs, ctx.now));
}

function initialQueue(config: SessionConfig, ctx: Ctx): QueueItem[] {
  const pool = scopedCards(config, ctx.cards);
  const size = config.stops === null ? INFINITE_BATCH : config.stops * STOP_SIZE;

  if (config.mode === 'exam') {
    return examCards(pool, EXAM_LIMIT).map(c => ({ id: c.id, retry: false, reason: 'fixed' }));
  }
  if (config.cardIds) {
    return shuffle(pool).map(c => ({ id: c.id, retry: false, reason: 'fixed' }));
  }
  if (config.concept) {
    return conceptCards(pool, config.concept, ctx.now).slice(0, size).map(c => ({ id: c.id, retry: false, reason: 'practice' }));
  }
  return pickBatch({ cards: pool, now: ctx.now, size, newAllowance: newAllowance(config, ctx) }).map(p => ({ id: p.id, retry: false, reason: p.reason }));
}

export function startSession(config: SessionConfig, ctx: Ctx): Session {
  const queue = initialQueue(config, ctx);
  return {
    id: newId(),
    config,
    queue,
    target: config.stops === null ? null : queue.length,
    firstAnswered: 0,
    answers: [],
    combo: 0,
    bestCombo: 0,
    xp: 0,
    startedAt: ctx.now,
    updatedAt: ctx.now,
    step: 0,
    recent: [],
    examAnswers: {},
    optionOrder: {},
  };
}

export function currentItem(s: Session): QueueItem | undefined {
  return s.queue[0];
}

export function isExam(s: Session) {
  return s.config.mode === 'exam';
}

export function isFinished(s: Session) {
  return s.queue.length === 0;
}

export function progressOf(s: Session) {
  if (s.target === null) return { done: s.firstAnswered, total: null as number | null };
  return { done: Math.min(s.firstAnswered, s.target), total: s.target };
}

export function optionsFor(s: Session, card: Card): { session: Session; options: string[] } {
  if (card.type !== 'multiple_choice' || !card.options) return { session: s, options: card.options ?? [] };
  const saved = s.optionOrder[card.id];
  if (saved && saved.length === card.options.length && saved.every(o => card.options!.includes(o))) return { session: s, options: saved };
  const options = shuffle(card.options);
  return { session: { ...s, optionOrder: { ...s.optionOrder, [card.id]: options } }, options };
}

export type AnswerInput = { userAnswer: string } | { grade: Grade };

export type AnswerOutcome = {
  session: Session;
  correct: boolean;
  typo: boolean;
  grade: Grade;
  xp: number;
  cardPatch: Partial<Card>;
  log: ReviewLog;
  comboBonus: boolean;
};

/**
 * Grades the current card. The card stays at the head of the queue (the feedback sheet shows
 * it) until next() is called. A first-try miss re-inserts the card a few positions later.
 */
export function answer(s: Session, card: Card, input: AnswerInput, now: number, opts: { override?: boolean; ms?: number } = {}): AnswerOutcome {
  const item = currentItem(s);
  const retry = item?.retry ?? false;

  let grade: Grade;
  let correct: boolean;
  let typo = false;
  let userAnswer: string;
  if ('grade' in input) {
    grade = input.grade;
    correct = grade !== 'again';
    userAnswer = grade === 'good' ? '알아요' : grade === 'hard' ? '헷갈려요' : '몰라요';
  } else {
    userAnswer = input.userAnswer;
    const r = opts.override ? { correct: true } : gradeAnswer(card, userAnswer);
    correct = r.correct;
    typo = Boolean('typo' in r && r.typo);
    grade = correct ? 'good' : 'again';
  }

  const combo = correct ? s.combo + 1 : 0;
  const comboBonus = correct && combo > 0 && combo % XP.comboEvery === 0;
  const xp = (correct ? (retry ? 5 : XP.correct) : XP.wrong) + (comboBonus ? XP.comboBonus : 0);

  const cardPatch = schedule(card, grade, now);
  const log: ReviewLog = {
    id: newId(),
    cardId: card.id,
    deckId: card.deckId,
    at: now,
    correct,
    grade,
    type: card.type,
    concept: card.concept ?? '',
    question: card.question,
    userAnswer,
    correctAnswer: card.answer,
    mode: s.config.mode,
    xp,
    updatedAt: now,
    ...(retry ? { retry: true } : {}),
    ...(isNew(card) ? { wasNew: true } : {}),
    ...(opts.ms ? { ms: Math.round(opts.ms) } : {}),
  };

  let queue = s.queue;
  if (!correct && !isExam(s) && !retry) {
    // Ask again a few cards later, Duolingo-style. Only once per session: a second miss is left
    // to the schedule (it's due tomorrow anyway) so a short ride can't turn into a loop.
    const rest = queue.slice(1);
    const at = Math.min(RETRY_GAP, rest.length);
    queue = [queue[0], ...rest.slice(0, at), { id: card.id, retry: true, reason: 'retry' }, ...rest.slice(at)];
  }

  const session: Session = {
    ...s,
    queue,
    firstAnswered: s.firstAnswered + (retry ? 0 : 1),
    answers: [...s.answers, { cardId: card.id, correct, grade, userAnswer, typo, retry, xp, at: now }],
    combo,
    bestCombo: Math.max(s.bestCombo, combo),
    xp: s.xp + xp,
    updatedAt: now,
  };
  return { session, correct, typo, grade, xp, cardPatch, log, comboBonus };
}

// Moves past the current card; tops up the infinite feed.
export function next(s: Session, ctx: Ctx): Session {
  const [done, ...rest] = s.queue;
  const recent = done ? [...s.recent, done.id].slice(-RECENT_WINDOW) : s.recent;
  let queue = rest;
  if (s.target === null && queue.length < REFILL_BELOW) {
    const pool = scopedCards(s.config, ctx.cards);
    const exclude = new Set([...recent, ...queue.map(q => q.id)]);
    let batch = pickBatch({ cards: pool, now: ctx.now, size: INFINITE_BATCH, newAllowance: newAllowance(s.config, ctx), exclude });
    // Small decks: everything was shown recently, so start cycling again — avoiding the card just
    // answered when there's any alternative, and allowing it when it's the only one.
    const queued = queue.map(q => q.id);
    if (!batch.length) batch = pickBatch({ cards: pool, now: ctx.now, size: INFINITE_BATCH, newAllowance: Infinity, exclude: new Set(done ? [...queued, done.id] : queued) });
    if (!batch.length && !queue.length) batch = pickBatch({ cards: pool, now: ctx.now, size: 1, newAllowance: Infinity });
    queue = [...queue, ...batch.map(p => ({ id: p.id, retry: false, reason: p.reason }))];
  }
  return { ...s, queue, recent, step: s.step + 1, updatedAt: ctx.now };
}

// Exam mode: remember the answer, move on without feedback.
export function recordExamAnswer(s: Session, cardId: string, value: string, now: number): Session {
  const [, ...rest] = s.queue;
  return { ...s, queue: rest, examAnswers: { ...s.examAnswers, [cardId]: value }, firstAnswered: s.firstAnswered + 1, step: s.step + 1, updatedAt: now };
}

// Drops a card from the session (deleted/hidden mid-session).
export function skipCard(s: Session, cardId: string, now: number): Session {
  const queue = s.queue.filter(q => q.id !== cardId);
  const removed = s.queue.length - queue.length;
  const target = s.target === null ? null : Math.max(s.firstAnswered, s.target - (removed ? 1 : 0));
  return { ...s, queue, target, step: s.step + 1, updatedAt: now };
}

export function missedFirstTry(s: Session) {
  return [...new Set(s.answers.filter(a => !a.retry && !a.correct).map(a => a.cardId))];
}

export function firstTryAccuracy(s: Session) {
  const first = s.answers.filter(a => !a.retry);
  return first.length ? first.filter(a => a.correct).length / first.length : 0;
}
