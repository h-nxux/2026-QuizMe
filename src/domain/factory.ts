import type { GeneratedCard, GenerationOptions } from '../shared/generation';
import { DECK_COLORS, type Card, type CardOrigin, type Deck, type DeckColor } from './types';

export function newId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Older Safari (and non-secure contexts): RFC4122 v4 from getRandomValues.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const FALLBACK_EMOJI = ['📘', '🧠', '✏️', '🔬', '📐', '🌱', '💡', '🧪', '📚', '🗂️'];

export function pickColor(existing: Deck[]): DeckColor {
  const used = new Map<DeckColor, number>(DECK_COLORS.map(c => [c, 0]));
  existing.filter(d => !d.deletedAt).forEach(d => used.set(d.color, (used.get(d.color) ?? 0) + 1));
  return [...used.entries()].sort((a, b) => a[1] - b[1])[0][0];
}

export function fallbackTitle(sourceText: string) {
  const firstLine = sourceText.split('\n').map(s => s.trim()).find(s => s.length >= 2) ?? '';
  const clean = firstLine.replace(/^[#>*\-\d.\s]+/, '').slice(0, 18);
  if (clean) return clean;
  const d = new Date();
  return `${d.getMonth() + 1}월 ${d.getDate()}일 자료`;
}

export function createDeck(input: {
  title?: string;
  emoji?: string;
  sourceText: string;
  options?: GenerationOptions;
  existing: Deck[];
  now?: number;
}): Deck {
  const now = input.now ?? Date.now();
  return {
    id: newId(),
    title: input.title?.trim() || fallbackTitle(input.sourceText),
    emoji: input.emoji || FALLBACK_EMOJI[Math.floor(Math.random() * FALLBACK_EMOJI.length)],
    color: pickColor(input.existing),
    sourceText: input.sourceText,
    options: input.options,
    createdAt: now,
    updatedAt: now,
  };
}

export function createCard(deckId: string, g: GeneratedCard, origin: CardOrigin, now = Date.now(), extra: Partial<Card> = {}): Card {
  return {
    id: newId(),
    deckId,
    type: g.type,
    question: g.question,
    answer: g.answer,
    ...(g.options ? { options: g.options } : {}),
    ...(g.acceptedAnswers ? { acceptedAnswers: g.acceptedAnswers } : {}),
    ...(g.explanation ? { explanation: g.explanation } : {}),
    ...(g.concept ? { concept: g.concept } : {}),
    origin,
    box: 0,
    due: now,
    reps: 0,
    lapses: 0,
    correctCount: 0,
    // Keeps generation order stable when sorting new cards by creation time.
    createdAt: now,
    updatedAt: now,
    ...extra,
  };
}

export function createCards(deckId: string, generated: GeneratedCard[], origin: CardOrigin, now = Date.now(), extra: Partial<Card> = {}) {
  return generated.map((g, i) => createCard(deckId, g, origin, now + i, extra));
}
