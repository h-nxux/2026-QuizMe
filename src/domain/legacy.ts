// Converts v1 data (saved quiz sessions, flashcard sets, graded attempts) into v2 decks, cards and
// review logs. Ids are derived from the v1 ids so importing twice (two devices, a retry) upserts
// the same documents instead of duplicating them.
import { normalizeLoose, sanitizeCard, type CardType } from '../shared/generation';
import { DECK_COLORS, type Card, type Deck, type ReviewLog } from './types';
import { fallbackTitle } from './factory';
import { schedule } from './srs';
import { XP } from './stats';

export type LegacyQuestion = {
  type: string;
  question: string;
  options?: string[] | null;
  answer: string;
  accepted_answers?: string[] | null;
  explanation?: string | null;
  concept?: string | null;
};

export type LegacySession = { id: string; sourceText: string; createdAt: string; questions: LegacyQuestion[] };
export type LegacyFlashcardSet = { id: string; sourceText: string; createdAt: string; flashcards: { term: string; definition: string }[] };
export type LegacyAttempt = {
  id: string;
  createdAt: string;
  items: { question: string; type: string; concept?: string | null; userAnswer: string; correctAnswer: string; isCorrect: boolean }[];
};

export type LegacyBundle = { sessions: LegacySession[]; flashcardSets: LegacyFlashcardSet[]; attempts: LegacyAttempt[] };

const QUIZ_TYPES: CardType[] = ['multiple_choice', 'ox', 'short_answer'];

function mostCommonConcept(questions: LegacyQuestion[]) {
  const counts = new Map<string, number>();
  questions.forEach(q => q.concept && counts.set(q.concept, (counts.get(q.concept) ?? 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

function baseCard(deckId: string, id: string, created: number): Omit<Card, 'type' | 'question' | 'answer'> {
  return { id, deckId, origin: 'legacy', box: 0, due: created, reps: 0, lapses: 0, correctCount: 0, createdAt: created, updatedAt: created };
}

export function convertLegacy(bundle: LegacyBundle, now = Date.now()) {
  const decks: Deck[] = [];
  const cards: Card[] = [];
  let colorIndex = 0;
  const nextColor = () => DECK_COLORS[colorIndex++ % DECK_COLORS.length];

  for (const s of bundle.sessions) {
    if (!s.questions?.length) continue;
    const created = Date.parse(s.createdAt) || now;
    const deckCards = s.questions
      .map((q, i) => {
        const clean = sanitizeCard(q, QUIZ_TYPES);
        return clean ? ({ ...baseCard(s.id, `${s.id}:q${i}`, created + i), ...clean } as Card) : null;
      })
      .filter((c): c is Card => c !== null);
    if (!deckCards.length) continue;
    const concept = mostCommonConcept(s.questions);
    decks.push({
      id: s.id,
      title: concept ? `${concept} 퀴즈` : fallbackTitle(s.sourceText),
      emoji: '📝',
      color: nextColor(),
      sourceText: s.sourceText ?? '',
      createdAt: created,
      updatedAt: created,
    });
    cards.push(...deckCards);
  }

  for (const set of bundle.flashcardSets) {
    if (!set.flashcards?.length) continue;
    const created = Date.parse(set.createdAt) || now;
    decks.push({
      id: set.id,
      title: fallbackTitle(set.sourceText ?? '') || '플래시카드',
      emoji: '🗂️',
      color: nextColor(),
      sourceText: set.sourceText ?? '',
      createdAt: created,
      updatedAt: created,
    });
    set.flashcards.forEach((f, i) => {
      if (!f.term?.trim() || !f.definition?.trim()) return;
      cards.push({ ...baseCard(set.id, `${set.id}:f${i}`, created + i), type: 'flashcard', question: f.term.trim(), answer: f.definition.trim() });
    });
  }

  // Replay graded attempts oldest-first so matched cards end up with a real schedule.
  const byQuestion = new Map<string, Card>();
  cards.forEach(c => byQuestion.set(normalizeLoose(c.question), c));
  const logs: ReviewLog[] = [];
  const attempts = [...bundle.attempts].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  for (const a of attempts) {
    const at = Date.parse(a.createdAt) || now;
    a.items.forEach((item, i) => {
      const card = byQuestion.get(normalizeLoose(item.question));
      const type = (QUIZ_TYPES as string[]).includes(item.type) ? (item.type as CardType) : 'multiple_choice';
      const t = at + i;
      if (card) Object.assign(card, schedule(card, item.isCorrect ? 'good' : 'again', t), { updatedAt: Math.max(card.updatedAt, t) });
      logs.push({
        id: `${a.id}:${i}`,
        cardId: card?.id ?? '',
        deckId: card?.deckId ?? '',
        at: t,
        correct: item.isCorrect,
        grade: item.isCorrect ? 'good' : 'again',
        type,
        concept: item.concept ?? '',
        question: item.question,
        userAnswer: item.userAnswer,
        correctAnswer: item.correctAnswer,
        mode: 'exam',
        xp: item.isCorrect ? XP.correct : XP.wrong,
        updatedAt: t,
      });
    });
  }

  return { decks, cards, logs };
}

// ---------- v1 guest data in localStorage ----------

const LEGACY_KEYS = { sessions: 'quizme-saved-sessions', flashcards: 'quizme-saved-flashcards', attempts: 'quizme-attempts' };

function readLocal<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function readLocalLegacy(): LegacyBundle {
  return {
    sessions: readLocal<LegacySession>(LEGACY_KEYS.sessions),
    flashcardSets: readLocal<LegacyFlashcardSet>(LEGACY_KEYS.flashcards),
    attempts: readLocal<LegacyAttempt>(LEGACY_KEYS.attempts),
  };
}

export function hasLegacyData(bundle: LegacyBundle) {
  return bundle.sessions.length + bundle.flashcardSets.length + bundle.attempts.length > 0;
}
