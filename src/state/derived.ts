import { useMemo } from 'react';
import { useStore, type Snapshot } from '../data/store';
import { dueCards, newCards, isActive } from '../domain/queue';
import { computeStats, levelOf, newIntroducedToday, streakOf, todayCount, totalXp } from '../domain/stats';
import { masteryCounts } from '../domain/stats';
import type { Card, Deck } from '../domain/types';
import { STOP_SIZE } from '../domain/types';
import { begin, type SessionResult } from './sessionStore';
import type { SessionConfig } from '../domain/session';
import { navigate } from '../lib/router';
import { toast } from '../components/Toast';

export function useToday() {
  const snap = useStore();
  return useMemo(() => today(snap), [snap]);
}

export function today(snap: Snapshot, now = Date.now()) {
  const count = todayCount(snap.logs, now);
  const goalStops = snap.settings.dailyGoalStops;
  const due = dueCards(snap.cards, now).length;
  const newLeft = Math.max(0, snap.settings.newPerDay - newIntroducedToday(snap.logs, now));
  const fresh = Math.min(newCards(snap.cards).length, newLeft);
  const streak = streakOf(snap.logs, now);
  const xp = totalXp(snap.logs);
  return {
    count,
    stopsDone: Math.floor(count / STOP_SIZE),
    partial: count % STOP_SIZE,
    goalStops,
    goalMet: count >= goalStops * STOP_SIZE,
    due,
    fresh,
    activeCards: snap.cards.filter(isActive).length,
    streak,
    xp,
    level: levelOf(xp),
  };
}

export function useWeakConcepts() {
  const snap = useStore();
  return useMemo(() => computeStats(snap.logs.filter(l => l.at > Date.now() - 30 * 86400000)).weakConcepts, [snap.logs]);
}

export type DeckSummary = { deck: Deck; cards: Card[]; due: number; fresh: number; mastery: ReturnType<typeof masteryCounts>; lastStudied?: number };

export function useDeckSummaries(): DeckSummary[] {
  const snap = useStore();
  return useMemo(() => {
    const now = Date.now();
    const byDeck = new Map<string, Card[]>();
    snap.cards.filter(isActive).forEach(c => byDeck.set(c.deckId, [...(byDeck.get(c.deckId) ?? []), c]));
    return snap.decks.map(deck => {
      const cards = byDeck.get(deck.id) ?? [];
      const last = Math.max(0, ...cards.map(c => c.lastReviewedAt ?? 0));
      return {
        deck,
        cards,
        due: dueCards(cards, now).length,
        fresh: newCards(cards).length,
        mastery: masteryCounts(cards),
        lastStudied: last || undefined,
      };
    });
  }, [snap.decks, snap.cards]);
}

export function startStudy(config: SessionConfig, emptyMessage = '지금 풀 카드가 없어요.') {
  if (begin(config)) {
    navigate({ name: 'play' });
    return true;
  }
  toast(emptyMessage);
  return false;
}

export function retryMissed(result: SessionResult) {
  // A fixed card list: the session length is the list itself (stops only marks it as finite).
  return startStudy({ mode: 'retry', title: '틀린 문제 다시', cardIds: result.missed.map(m => m.cardId), stops: 1 }, '다시 풀 카드가 없어요.');
}
