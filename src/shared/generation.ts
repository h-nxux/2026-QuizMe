// Shared between the browser bundle and the Vercel functions (api/). Keep it dependency-free.

export const CARD_TYPES = ['multiple_choice', 'ox', 'short_answer', 'flashcard'] as const;
export type CardType = (typeof CARD_TYPES)[number];

export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const CARD_COUNTS = [10, 20, 30] as const;
export const MAX_CARDS_PER_REQUEST = 30;
export const MAX_AVOID_ITEMS = 80;
export const MAX_REMIX_SEEDS = 10;

export const MIN_SOURCE_CHARS = 20;
export const MAX_SOURCE_CHARS_PER_REQUEST = 12000;
// Client-side cap on what one deck can hold as its source; longer input is split into chunks up to this size.
export const MAX_SOURCE_CHARS_TOTAL = 120000;

export type GenerateMode = 'deck' | 'more' | 'remix';

export type GenerationOptions = {
  difficulty: Difficulty;
  types: CardType[];
  count: number;
};

export const DEFAULT_GENERATION_OPTIONS: GenerationOptions = {
  difficulty: 'medium',
  // Typing on a phone is a chore, so short answer is opt-in.
  types: ['multiple_choice', 'ox', 'flashcard'],
  count: 10,
};

export const CARD_TYPE_LABELS: Record<CardType, string> = {
  multiple_choice: '객관식',
  ox: 'OX',
  short_answer: '주관식',
  flashcard: '플래시카드',
};

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: '쉬움',
  medium: '보통',
  hard: '어려움',
};

export type GeneratedCard = {
  type: CardType;
  question: string;
  answer: string;
  options?: string[];
  acceptedAnswers?: string[];
  explanation?: string;
  concept?: string;
};

export type RemixSeed = { question: string; answer: string; concept?: string };

export type GenerateRequest = {
  mode: GenerateMode;
  sourceText: string;
  options: GenerationOptions;
  avoid?: string[];
  seeds?: RemixSeed[];
};

export type GenerateResponse = {
  title?: string;
  emoji?: string;
  cards: GeneratedCard[];
};

// ---------- sanitizing model output ----------

const MAX_QUESTION_CHARS = 600;
const MAX_ANSWER_CHARS = 600;
const MAX_OPTION_CHARS = 200;
const MAX_CONCEPT_CHARS = 30;
const MAX_OPTIONS = 5;
const MAX_ACCEPTED = 5;

function str(value: unknown, max: number) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function strList(value: unknown, max: number, limit: number) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const s = str(item, max);
    const key = s.toLowerCase();
    if (!s || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

export function normalizeLoose(value: string) {
  return value.trim().toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

const O_VALUES = new Set(['o', '○', 'true', '참', '맞음', '예', 'yes', '⭕']);
const X_VALUES = new Set(['x', '×', '✕', 'false', '거짓', '틀림', '아니오', 'no', '❌']);

export function normalizeOx(value: string): 'O' | 'X' | null {
  const v = value.trim().toLowerCase();
  if (O_VALUES.has(v)) return 'O';
  if (X_VALUES.has(v)) return 'X';
  return null;
}

export function sanitizeCard(raw: unknown, allowed: readonly CardType[]): GeneratedCard | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const type = r.type as CardType;
  if (!allowed.includes(type)) return null;

  const question = str(r.question, MAX_QUESTION_CHARS);
  let answer = str(r.answer, MAX_ANSWER_CHARS);
  if (!question || !answer) return null;

  const card: GeneratedCard = { type, question, answer };
  const explanation = str(r.explanation, MAX_ANSWER_CHARS);
  const concept = str(r.concept, MAX_CONCEPT_CHARS);
  if (explanation) card.explanation = explanation;
  if (concept) card.concept = concept;

  if (type === 'multiple_choice') {
    const options = strList(r.options, MAX_OPTION_CHARS, MAX_OPTIONS);
    const match = options.find(o => o === answer) ?? options.find(o => normalizeLoose(o) === normalizeLoose(answer));
    if (!match || options.length < 2) return null;
    card.answer = match;
    card.options = options;
  } else if (type === 'ox') {
    const ox = normalizeOx(answer);
    if (!ox) return null;
    card.answer = ox;
  } else if (type === 'short_answer') {
    const accepted = strList(r.accepted_answers ?? r.acceptedAnswers, MAX_OPTION_CHARS, MAX_ACCEPTED)
      .filter(a => normalizeLoose(a) !== normalizeLoose(answer));
    if (accepted.length) card.acceptedAnswers = accepted;
  } else {
    answer = str(r.answer, MAX_ANSWER_CHARS);
    card.answer = answer;
  }
  return card;
}

export function sanitizeCards(raw: unknown, allowed: readonly CardType[], avoid: string[] = []): GeneratedCard[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set(avoid.map(normalizeLoose));
  const out: GeneratedCard[] = [];
  for (const item of raw) {
    const card = sanitizeCard(item, allowed);
    if (!card) continue;
    const key = normalizeLoose(card.question);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(card);
  }
  return out;
}

export function sanitizeTitle(value: unknown) {
  return str(value, 40);
}

export function sanitizeEmoji(value: unknown) {
  const s = str(value, 16);
  // Keep the first grapheme only; models sometimes return several emoji or words.
  const first = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)][0]?.segment ?? '';
  return /\p{Extended_Pictographic}/u.test(first) ? first : '';
}
