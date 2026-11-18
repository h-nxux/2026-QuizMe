import type { Card, Grade } from './types';
import { addDays, startOfDay } from './time';

// Box n means "next review INTERVAL_DAYS[n] days after the last successful review".
// 1→3→7→14 days is the curve from the original plan; 30/60/120 extend it for long-term retention.
export const INTERVAL_DAYS = [0, 1, 3, 7, 14, 30, 60, 120] as const;
export const MAX_BOX = INTERVAL_DAYS.length - 1;

export type Mastery = 'new' | 'learning' | 'familiar' | 'mastered';

export const MASTERY_LABELS: Record<Mastery, string> = {
  new: '새 카드',
  learning: '학습 중',
  familiar: '익숙함',
  mastered: '마스터',
};

export function isNew(card: Card) {
  return card.box === 0 && card.reps === 0;
}

export function isDue(card: Card, now: number) {
  return card.box > 0 && card.due <= now;
}

export function masteryOf(card: Card): Mastery {
  if (isNew(card)) return 'new';
  if (card.box <= 2) return 'learning';
  if (card.box <= 4) return 'familiar';
  return 'mastered';
}

type ScheduleFields = Pick<Card, 'box' | 'due' | 'reps' | 'lapses' | 'correctCount' | 'lastReviewedAt' | 'lastWrongAt'>;

/**
 * Applies one answer to a card's schedule.
 * - again: back to box 1, due tomorrow (the plan's "틀리면 초기화").
 * - good: one box up — but only when the card was due or new. Answering a card early (e.g. in the
 *   infinite feed) never pushes its schedule further out, so over-practice can't fake retention.
 * - hard (flashcard "헷갈려요"): same interval again.
 */
export function schedule(card: Card, grade: Grade, now: number): ScheduleFields {
  const today = startOfDay(now);
  const counts = {
    reps: card.reps + 1,
    lapses: card.lapses + (grade === 'again' ? 1 : 0),
    correctCount: card.correctCount + (grade === 'good' ? 1 : 0),
    lastReviewedAt: now,
    lastWrongAt: grade === 'again' ? now : card.lastWrongAt,
  };

  if (grade === 'again') {
    return { ...counts, box: 1, due: addDays(today, INTERVAL_DAYS[1]) };
  }

  const onSchedule = isNew(card) || card.box === 0 || card.due <= now;
  if (!onSchedule) return { ...counts, box: card.box, due: card.due };

  const box = grade === 'good' ? Math.min(card.box + 1, MAX_BOX) : Math.max(card.box, 1);
  return { ...counts, box, due: addDays(today, INTERVAL_DAYS[box]) };
}

export function accuracyOfCard(card: Card) {
  return card.reps ? card.correctCount / card.reps : 0;
}

// Higher = weaker. Recent misses weigh most; lapses and a low hit rate add up over time.
export function weakness(card: Card, now: number) {
  if (card.reps === 0) return 0;
  const sinceWrongDays = card.lastWrongAt ? (now - card.lastWrongAt) / 86400000 : Infinity;
  const recency = sinceWrongDays < 1 ? 3 : sinceWrongDays < 7 ? 1.5 : 0;
  return card.lapses * 1.2 + (1 - accuracyOfCard(card)) * 3 + recency - card.box * 0.3;
}
