// Generation runs outside any screen so the user can go review while the AI works.
import { useSyncExternalStore } from 'react';
import { addCards, addDeck, getDeck, getSnapshot, updateSettings } from '../data/store';
import { createCards, createDeck } from '../domain/factory';
import { generateDeck, generateMore } from '../lib/api';
import type { GenerationOptions } from '../shared/generation';
import { toast } from '../components/Toast';
import { navigate } from '../lib/router';
import { cue } from '../lib/feedback';

export type Job = {
  kind: 'deck' | 'more';
  status: 'running' | 'done' | 'error';
  progress: { done: number; total: number };
  startedAt: number;
  deckId?: string;
  added?: number;
  error?: string;
};

let job: Job | null = null;
// Whether the create screen is showing the job; if not, finishing announces itself with a toast.
let watched = false;
const listeners = new Set<() => void>();

function set(next: Job | null) {
  job = next;
  listeners.forEach(l => l());
}

export function useJob() {
  return useSyncExternalStore(
    l => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => job,
  );
}

export function setWatched(value: boolean) {
  watched = value;
}

export function clearJob() {
  if (job?.status !== 'running') set(null);
}

function message(error: unknown) {
  return error instanceof Error ? error.message : '알 수 없는 오류가 났어요.';
}

export async function runCreateDeck(sourceText: string, options: GenerationOptions) {
  if (job?.status === 'running') return;
  updateSettings({ lastGeneration: options });
  set({ kind: 'deck', status: 'running', progress: { done: 0, total: 1 }, startedAt: Date.now() });
  try {
    const res = await generateDeck(sourceText, options, (done, total) => job && set({ ...job, progress: { done, total } }));
    const deck = createDeck({ title: res.title, emoji: res.emoji, sourceText, options, existing: getSnapshot().decks });
    addDeck(deck, createCards(deck.id, res.cards, 'ai'));
    set({ ...job!, status: 'done', deckId: deck.id, added: res.cards.length });
    cue('finish');
    if (!watched) {
      toast(`${deck.emoji} '${deck.title}' 덱이 준비됐어요 (${res.cards.length}장)`, {
        tone: 'good',
        action: { label: '보기', run: () => navigate({ name: 'deck', id: deck.id }) },
        ms: 6000,
      });
      set(null);
    }
  } catch (error) {
    set({ ...job!, status: 'error', error: message(error) });
    if (!watched) toast(`덱을 만들지 못했어요: ${message(error)}`, { tone: 'error', ms: 5000 });
  }
}

export async function runMore(deckId: string, options: GenerationOptions) {
  const deck = getDeck(deckId);
  if (!deck || job?.status === 'running') return;
  set({ kind: 'more', status: 'running', progress: { done: 0, total: 1 }, startedAt: Date.now(), deckId });
  try {
    const existing = getSnapshot().cards.filter(c => c.deckId === deckId).map(c => c.question);
    const res = await generateMore(deck.sourceText, options, existing, (done, total) => job && set({ ...job, progress: { done, total } }));
    addCards(createCards(deckId, res.cards, 'ai'));
    toast(`새 카드 ${res.cards.length}장을 더했어요`, { tone: 'good' });
    cue('correct');
    set(null);
  } catch (error) {
    toast(`더 만들지 못했어요: ${message(error)}`, { tone: 'error', ms: 5000 });
    set(null);
  }
}
