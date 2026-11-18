// AI remix ("환승 문제" in the UI): cards missed repeatedly get sibling questions on the same concept, asked from a
// different angle, so the answer can't be memorized by position or wording.
import { addCards, getDeck, getSnapshot } from '../data/store';
import { createCards } from '../domain/factory';
import type { Card } from '../domain/types';
import { generateRemix } from '../lib/api';
import { weakness } from '../domain/srs';
import { isActive } from '../domain/queue';
import type { CardType, GenerationOptions } from '../shared/generation';
import { toast } from '../components/Toast';

export const AUTO_REMIX_LAPSES = 2;
const inFlight = new Set<string>();

function hasVariants(card: Card) {
  return getSnapshot().cards.some(c => c.parentId === card.id);
}

function typesFor(cards: Card[]): CardType[] {
  const types = new Set<CardType>(['multiple_choice', 'ox']);
  if (cards.some(c => c.type === 'short_answer')) types.add('short_answer');
  return [...types];
}

async function remix(cards: Card[], count: number) {
  const deck = getDeck(cards[0].deckId);
  const deckCards = getSnapshot().cards.filter(c => c.deckId === cards[0].deckId);
  const options: GenerationOptions = { difficulty: 'medium', types: typesFor(cards), count };
  const generated = await generateRemix(
    cards.map(c => ({ question: c.question, answer: c.answer, concept: c.concept })),
    options,
    deck?.sourceText ?? '',
    deckCards.map(c => c.question),
  );
  // One parent per variant keeps "has this card been remixed" answerable.
  const created = generated.map((g, i) => {
    const parent = cards.find(c => c.concept && c.concept === g.concept) ?? cards[i % cards.length];
    return createCards(parent.deckId, [g], 'remix', Date.now() + i, { parentId: parent.id })[0];
  });
  addCards(created);
  return created;
}

// Called after a wrong answer; fire-and-forget. Silently skips when offline or signed out.
export function maybeAutoRemix(card: Card, lapsesAfter: number, canGenerate: boolean) {
  if (!canGenerate || !navigator.onLine) return;
  if (lapsesAfter < AUTO_REMIX_LAPSES || card.origin === 'remix' || hasVariants(card) || inFlight.has(card.id)) return;
  inFlight.add(card.id);
  remix([card], 2)
    .then(created => {
      if (created.length) toast(`'${card.concept || '이 개념'}' 환승 문제 ${created.length}개가 생겼어요`, { tone: 'good' });
    })
    .catch(error => console.warn('[remix]', error))
    .finally(() => inFlight.delete(card.id));
}

export function weakCardsOf(deckId: string, now = Date.now()) {
  return getSnapshot()
    .cards.filter(c => c.deckId === deckId && isActive(c) && c.reps > 0 && c.origin !== 'remix')
    .map(c => ({ c, w: weakness(c, now) }))
    .filter(x => x.c.lapses > 0 || x.c.correctCount / x.c.reps < 0.7)
    .sort((a, b) => b.w - a.w)
    .map(x => x.c);
}

export async function remixDeck(deckId: string) {
  const weak = weakCardsOf(deckId).slice(0, 6);
  if (!weak.length) throw new Error('아직 틀린 카드가 없어요');
  return remix(weak, Math.min(10, weak.length * 2));
}
