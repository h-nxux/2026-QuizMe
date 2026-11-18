import { CARD_TYPES, type CardType } from '../shared/generation';
import type { Card, ReviewLog } from './types';
import { STOP_SIZE } from './types';
import { masteryOf, type Mastery } from './srs';
import { conceptKey, isActive } from './queue';
import { DAY_MS, addDays, dayKey, startOfDay, startOfWeek } from './time';

export type RangeKey = '7d' | '30d' | 'all';
export const RANGE_LABELS: Record<RangeKey, string> = { '7d': '최근 7일', '30d': '최근 30일', all: '전체' };
const RANGE_DAYS = { '7d': 7, '30d': 30 } as const;
const MAX_WEEKS = 26;

export const WEAK_MIN_ATTEMPTS = 2;
export const WEAK_ACCURACY_BELOW = 0.8;

export type Tally = { total: number; correct: number };
export type TimelinePoint = Tally & { key: string; label: string; tooltipLabel: string };
export type ConceptStat = Tally & { name: string; key: string; lastWrong?: ReviewLog };

export function accuracyOf(t: Tally) {
  return t.total ? t.correct / t.total : 0;
}

// Retries (second tries after seeing the answer) would inflate accuracy, so stats skip them.
function scored(logs: ReviewLog[]) {
  return logs.filter(l => !l.retry && !l.deletedAt);
}

function tally(logs: ReviewLog[]): Tally {
  return { total: logs.length, correct: logs.filter(l => l.correct).length };
}

function rangeStart(range: Exclude<RangeKey, 'all'>, now: number) {
  return startOfDay(now) - (RANGE_DAYS[range] - 1) * DAY_MS;
}

export function filterByRange(logs: ReviewLog[], range: RangeKey, now = Date.now()) {
  if (range === 'all') return logs;
  const start = rangeStart(range, now);
  return logs.filter(l => l.at >= start);
}

// The equally long window right before the selected one, for the delta on the stat tile.
export function previousPeriod(logs: ReviewLog[], range: RangeKey, now = Date.now()) {
  if (range === 'all') return null;
  const end = rangeStart(range, now);
  const start = end - RANGE_DAYS[range] * DAY_MS;
  return logs.filter(l => l.at >= start && l.at < end);
}

export function buildTimeline(allLogs: ReviewLog[], range: RangeKey, now = Date.now()): TimelinePoint[] {
  const logs = scored(allLogs);
  const bucketOf = range === 'all' ? startOfWeek : startOfDay;
  const byBucket = new Map<number, ReviewLog[]>();
  for (const l of logs) {
    const key = bucketOf(l.at);
    const bucket = byBucket.get(key) ?? [];
    bucket.push(l);
    byBucket.set(key, bucket);
  }

  const buckets: number[] = [];
  if (range === 'all') {
    if (logs.length === 0) return [];
    let cursor = startOfWeek(Math.min(...logs.map(l => l.at)));
    const last = startOfWeek(now);
    while (cursor <= last) {
      buckets.push(cursor);
      cursor = addDays(cursor, 7);
    }
  } else {
    for (let i = RANGE_DAYS[range] - 1; i >= 0; i -= 1) buckets.push(addDays(startOfDay(now), -i));
  }

  return (range === 'all' ? buckets.slice(-MAX_WEEKS) : buckets).map(t => {
    const d = new Date(t);
    const label = `${d.getMonth() + 1}/${d.getDate()}`;
    return { key: String(t), label, tooltipLabel: range === 'all' ? `${label} 주` : label, ...tally(byBucket.get(t) ?? []) };
  });
}

export function computeStats(allLogs: ReviewLog[]) {
  const logs = scored(allLogs).sort((a, b) => a.at - b.at);

  const byType: (Tally & { type: CardType })[] = CARD_TYPES
    .map(type => ({ type, ...tally(logs.filter(l => l.type === type)) }))
    .filter(t => t.total > 0);

  const concepts = new Map<string, ConceptStat>();
  for (const log of logs) {
    const key = conceptKey(log.concept);
    if (!key) continue;
    const stat = concepts.get(key) ?? { name: log.concept.trim(), key, total: 0, correct: 0 };
    stat.name = log.concept.trim();
    stat.total += 1;
    if (log.correct) stat.correct += 1;
    else stat.lastWrong = log;
    concepts.set(key, stat);
  }

  const weakConcepts = [...concepts.values()]
    .filter(c => c.total >= WEAK_MIN_ATTEMPTS && accuracyOf(c) < WEAK_ACCURACY_BELOW)
    .sort((a, b) => accuracyOf(a) - accuracyOf(b) || b.total - a.total)
    .slice(0, 6);

  return {
    overall: tally(logs),
    sessionDays: new Set(logs.map(l => dayKey(l.at))).size,
    byType,
    weakConcepts,
    conceptCount: concepts.size,
  };
}

// ---------- daily goal, streak, xp ----------

export function countByDay(logs: ReviewLog[]) {
  const counts = new Map<string, number>();
  for (const l of logs) {
    if (l.deletedAt) continue;
    const k = dayKey(l.at);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

export function todayCount(logs: ReviewLog[], now = Date.now()) {
  const start = startOfDay(now);
  return logs.filter(l => !l.deletedAt && l.at >= start).length;
}

export function newIntroducedToday(logs: ReviewLog[], now = Date.now()) {
  const start = startOfDay(now);
  return logs.filter(l => !l.deletedAt && l.wasNew && l.at >= start).length;
}

export function stopsDone(count: number) {
  return Math.floor(count / STOP_SIZE);
}

// A day counts once at least one stop (5 answers) was completed. Today not being done yet
// doesn't break the streak until the day is over.
export function streakOf(logs: ReviewLog[], now = Date.now()) {
  const counts = countByDay(logs);
  const qualifies = (t: number) => (counts.get(dayKey(t)) ?? 0) >= STOP_SIZE;
  let cursor = startOfDay(now);
  const todayDone = qualifies(cursor);
  if (!todayDone) cursor = addDays(cursor, -1);
  let days = 0;
  while (qualifies(cursor)) {
    days += 1;
    cursor = addDays(cursor, -1);
  }
  return { days, todayDone };
}

export function bestStreak(logs: ReviewLog[]) {
  const days = [...countByDay(logs).entries()].filter(([, n]) => n >= STOP_SIZE).map(([k]) => k).sort();
  let best = 0;
  let run = 0;
  let prev: number | null = null;
  for (const k of days) {
    const [y, m, d] = k.split('-').map(Number);
    const t = new Date(y, m - 1, d).getTime();
    run = prev !== null && dayKey(addDays(prev, 1)) === k ? run + 1 : 1;
    best = Math.max(best, run);
    prev = t;
  }
  return best;
}

export const XP = { correct: 10, wrong: 2, comboEvery: 5, comboBonus: 5 } as const;

export function totalXp(logs: ReviewLog[]) {
  return logs.reduce((sum, l) => sum + (l.deletedAt ? 0 : l.xp), 0);
}

// Level n starts at 50·n·(n−1) XP: 0, 100, 300, 600, 1000 …
export function levelOf(xp: number) {
  const level = Math.floor((1 + Math.sqrt(1 + (8 * xp) / 100)) / 2);
  const start = 50 * level * (level - 1);
  const next = 50 * (level + 1) * level;
  return { level, into: xp - start, span: next - start };
}

export type HeatCell = { key: string; date: number; count: number; future: boolean };

export function heatmap(logs: ReviewLog[], weeks: number, now = Date.now()): HeatCell[][] {
  const counts = countByDay(logs);
  const first = addDays(startOfWeek(now), -(weeks - 1) * 7);
  const today = startOfDay(now);
  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const date = addDays(first, w * 7 + d);
      const key = dayKey(date);
      return { key, date, count: counts.get(key) ?? 0, future: date > today };
    }),
  );
}

export function masteryCounts(cards: Card[]) {
  const out: Record<Mastery, number> = { new: 0, learning: 0, familiar: 0, mastered: 0 };
  for (const c of cards) if (isActive(c)) out[masteryOf(c)] += 1;
  return out;
}
