import type { Card } from './types';
import { isDue, isNew, weakness } from './srs';

export type PickReason = 'due' | 'new' | 'practice';
export type Pick = { id: string; reason: PickReason };

export function isActive(card: Card) {
  return !card.deletedAt && !card.suspended;
}

export function conceptKey(concept = '') {
  return concept.trim().toLowerCase().replace(/\s+/g, '');
}

export function dueCards(cards: Card[], now: number) {
  return cards.filter(c => isActive(c) && isDue(c, now)).sort((a, b) => a.due - b.due);
}

export function newCards(cards: Card[]) {
  return cards.filter(c => isActive(c) && isNew(c)).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

function practiceCards(cards: Card[], now: number, random: () => number) {
  return cards
    .filter(c => isActive(c) && !isNew(c))
    .map(c => ({ c, score: weakness(c, now) + random() * 1.5 }))
    .sort((a, b) => b.score - a.score)
    .map(x => x.c);
}

export type BatchInput = {
  cards: Card[];
  now: number;
  size: number;
  // How many never-seen cards may still be introduced today (Infinity for deck study).
  newAllowance: number;
  exclude?: Set<string>;
  // Keep going past due/new into practice so the feed never runs dry.
  fillWithPractice?: boolean;
  random?: () => number;
};

/**
 * Order: overdue first (most overdue on top) → new cards within today's allowance → weakest
 * already-seen cards. A batch never repeats a card; the infinite feed handles running dry by
 * clearing its own exclusion list.
 */
export function pickBatch(input: BatchInput): Pick[] {
  const { cards, now, size, newAllowance, exclude = new Set(), fillWithPractice = true, random = Math.random } = input;
  const out: Pick[] = [];
  const taken = new Set<string>();
  const add = (card: Card, reason: PickReason) => {
    if (out.length >= size || taken.has(card.id) || exclude.has(card.id)) return;
    taken.add(card.id);
    out.push({ id: card.id, reason });
  };

  dueCards(cards, now).forEach(c => add(c, 'due'));
  newCards(cards).slice(0, Math.max(0, newAllowance)).forEach(c => add(c, 'new'));
  if (fillWithPractice && out.length < size) {
    practiceCards(cards, now, random).forEach(c => add(c, 'practice'));
    // Nothing reviewed yet and the allowance is spent: introduce more new cards rather than stall.
    newCards(cards).forEach(c => add(c, 'new'));
  }
  return out;
}

export function conceptCards(cards: Card[], concept: string, now: number) {
  const key = conceptKey(concept);
  return cards
    .filter(c => isActive(c) && conceptKey(c.concept) === key)
    .sort((a, b) => weakness(b, now) - weakness(a, now));
}

export function shuffle<T>(items: T[], random = Math.random) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function examCards(cards: Card[], limit: number, random = Math.random) {
  const active = cards.filter(isActive);
  const quiz = active.filter(c => c.type !== 'flashcard');
  return shuffle(quiz.length ? quiz : active, random).slice(0, limit);
}
