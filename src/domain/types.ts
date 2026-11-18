import type { CardType, GenerationOptions } from '../shared/generation';

export const DECK_COLORS = ['mint', 'choco', 'berry', 'banana', 'blueberry', 'grape'] as const;
export type DeckColor = (typeof DECK_COLORS)[number];

// Every synced document carries these. Times are epoch milliseconds.
export type Doc = {
  id: string;
  updatedAt: number;
  deletedAt?: number;
};

export type Deck = Doc & {
  title: string;
  emoji: string;
  color: DeckColor;
  sourceText: string;
  options?: GenerationOptions;
  createdAt: number;
};

export type CardOrigin = 'ai' | 'remix' | 'manual' | 'legacy' | 'sample';

export type Card = Doc & {
  deckId: string;
  type: CardType;
  question: string;
  answer: string;
  options?: string[];
  acceptedAnswers?: string[];
  explanation?: string;
  concept?: string;
  origin: CardOrigin;
  parentId?: string;
  starred?: boolean;
  suspended?: boolean;
  // spaced repetition
  box: number;
  due: number;
  reps: number;
  lapses: number;
  correctCount: number;
  lastReviewedAt?: number;
  lastWrongAt?: number;
  createdAt: number;
};

// again = 틀림/몰라요, hard = 헷갈려요(플래시카드), good = 맞음/알아요
export type Grade = 'again' | 'hard' | 'good';

export type StudyMode = 'review' | 'infinite' | 'deck' | 'exam' | 'concept' | 'retry' | 'listen' | 'starred';

export type ReviewLog = Doc & {
  cardId: string;
  deckId: string;
  at: number;
  correct: boolean;
  grade: Grade;
  type: CardType;
  concept: string;
  question: string;
  userAnswer: string;
  correctAnswer: string;
  mode: StudyMode;
  // A second try at a card already missed in the same session: counts as effort, not accuracy.
  retry?: boolean;
  // First time this card was ever answered; counts against the daily new-card allowance.
  wasNew?: boolean;
  xp: number;
  ms?: number;
};

export type ThemePref = 'system' | 'light' | 'dark';

export type Settings = Doc & {
  dailyGoalStops: number;
  sessionStops: number;
  newPerDay: number;
  haptics: boolean;
  sound: boolean;
  theme: ThemePref;
  ttsRate: number;
  listenDelaySec: number;
  lastGeneration?: GenerationOptions;
  legacyRemoteImported?: boolean;
};

export const STOP_SIZE = 5;

export const DEFAULT_SETTINGS: Settings = {
  id: 'settings',
  updatedAt: 0,
  dailyGoalStops: 4,
  sessionStops: 1,
  newPerDay: 20,
  haptics: true,
  sound: false,
  theme: 'system',
  ttsRate: 1,
  listenDelaySec: 4,
};

export type Collection = 'decks' | 'cards' | 'logs' | 'settings';
