// Local-first store. Everything lives in memory and is mirrored to IndexedDB; when signed in,
// sync.ts pushes local changes and pulls remote ones. Components read through useStore().
import { useSyncExternalStore } from 'react';
import {
  DEFAULT_SETTINGS,
  type Card,
  type Collection,
  type Deck,
  type Doc,
  type ReviewLog,
  type Settings,
} from '../domain/types';
import { convertLegacy, hasLegacyData, readLocalLegacy } from '../domain/legacy';
import { createSampleDeck } from '../domain/sample';
import { clearStores, getAll, idbAvailable, putMany } from './idb';

export type SyncStatus = 'disabled' | 'idle' | 'syncing' | 'offline' | 'error';

export type Meta = {
  id: 'meta';
  // Account whose data is on this device; null = guest data.
  ownerId: string | null;
  lastPushAt: number;
  lastPullSeq: number;
  legacyLocalImported: boolean;
  onboarded: boolean;
};

const DEFAULT_META: Meta = { id: 'meta', ownerId: null, lastPushAt: 0, lastPullSeq: 0, legacyLocalImported: false, onboarded: false };

export type Snapshot = {
  version: number;
  ready: boolean;
  persistent: boolean;
  decks: Deck[];
  cards: Card[];
  logs: ReviewLog[];
  settings: Settings;
  meta: Meta;
  sync: { status: SyncStatus; error?: string; lastSyncedAt?: number };
};

const maps = {
  decks: new Map<string, Deck>(),
  cards: new Map<string, Card>(),
  logs: new Map<string, ReviewLog>(),
};
let settings: Settings = { ...DEFAULT_SETTINGS };
let meta: Meta = { ...DEFAULT_META };
let ready = false;
let persistent = true;
let sync: Snapshot['sync'] = { status: 'disabled' };

let version = 0;
let cache: Snapshot | null = null;
const listeners = new Set<() => void>();
const changeListeners = new Set<() => void>();

function emit(localChange = false) {
  version += 1;
  cache = null;
  listeners.forEach(l => l());
  if (localChange) changeListeners.forEach(l => l());
}

export function getSnapshot(): Snapshot {
  if (!cache) {
    cache = {
      version,
      ready,
      persistent,
      decks: [...maps.decks.values()].filter(d => !d.deletedAt).sort((a, b) => b.createdAt - a.createdAt),
      cards: [...maps.cards.values()].filter(c => !c.deletedAt),
      logs: [...maps.logs.values()].filter(l => !l.deletedAt).sort((a, b) => a.at - b.at),
      settings,
      meta,
      sync,
    };
  }
  return cache;
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Fires after any local (not remote) write; sync.ts uses it to schedule a push.
export function onLocalChange(listener: () => void) {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

export function useStore() {
  return useSyncExternalStore(subscribe, getSnapshot);
}

// ---------- persistence (batched) ----------

const pending = new Map<string, unknown[]>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function persist(store: string, items: unknown[]) {
  pending.set(store, [...(pending.get(store) ?? []), ...items]);
  if (!flushTimer) flushTimer = setTimeout(() => void flush(), 50);
}

export async function flush() {
  flushTimer = null;
  const batches = [...pending.entries()];
  pending.clear();
  for (const [store, items] of batches) {
    try {
      await putMany(store, items);
    } catch (error) {
      console.error('[store] persist failed', store, error);
    }
  }
}

// ---------- writes ----------

type DocMap = { decks: Deck; cards: Card; logs: ReviewLog };

function writeDocs<K extends keyof DocMap>(collection: K, docs: DocMap[K][], local = true) {
  if (!docs.length) return;
  const map = maps[collection] as Map<string, DocMap[K]>;
  docs.forEach(d => map.set(d.id, d));
  persist(collection, docs);
  emit(local);
}

function stamp<T extends Doc>(doc: T, now = Date.now()): T {
  return { ...doc, updatedAt: Math.max(now, doc.updatedAt + 1) };
}

export function addDeck(deck: Deck, cards: Card[]) {
  writeDocs('decks', [deck]);
  writeDocs('cards', cards);
}

export function addCards(cards: Card[]) {
  writeDocs('cards', cards);
}

export function updateDeck(id: string, patch: Partial<Deck>) {
  const deck = maps.decks.get(id);
  if (deck) writeDocs('decks', [stamp({ ...deck, ...patch })]);
}

export function updateCard(id: string, patch: Partial<Card>) {
  const card = maps.cards.get(id);
  if (card) writeDocs('cards', [stamp({ ...card, ...patch })]);
}

export function updateCards(patches: { id: string; patch: Partial<Card> }[]) {
  const docs = patches
    .map(({ id, patch }) => {
      const card = maps.cards.get(id);
      return card ? stamp({ ...card, ...patch }) : null;
    })
    .filter((c): c is Card => c !== null);
  writeDocs('cards', docs);
}

export function deleteDeck(id: string) {
  const now = Date.now();
  const deck = maps.decks.get(id);
  if (!deck) return;
  writeDocs('decks', [stamp({ ...deck, deletedAt: now }, now)]);
  writeDocs('cards', [...maps.cards.values()].filter(c => c.deckId === id && !c.deletedAt).map(c => stamp({ ...c, deletedAt: now }, now)));
}

export function restoreDeck(id: string, deletedAt: number) {
  const deck = maps.decks.get(id);
  if (!deck) return;
  writeDocs('decks', [stamp({ ...deck, deletedAt: undefined })]);
  writeDocs('cards', [...maps.cards.values()].filter(c => c.deckId === id && c.deletedAt === deletedAt).map(c => stamp({ ...c, deletedAt: undefined })));
}

export function deleteCard(id: string) {
  updateCard(id, { deletedAt: Date.now() });
}

export function addLogs(logs: ReviewLog[]) {
  writeDocs('logs', logs);
}

export function updateSettings(patch: Partial<Settings>) {
  settings = stamp({ ...settings, ...patch });
  persist('settings', [settings]);
  emit(true);
}

export function setMeta(patch: Partial<Meta>) {
  meta = { ...meta, ...patch };
  persist('meta', [meta]);
  emit();
}

export function setSyncState(next: Snapshot['sync']) {
  sync = next;
  emit();
}

export function getDeck(id: string) {
  return maps.decks.get(id);
}

export function getCard(id: string) {
  return maps.cards.get(id);
}

// ---------- sync support ----------

export function changedSince(t: number) {
  const out: { collection: Collection; doc: Doc }[] = [];
  (['decks', 'cards', 'logs'] as const).forEach(collection => {
    maps[collection].forEach(doc => {
      if (doc.updatedAt > t) out.push({ collection, doc });
    });
  });
  if (settings.updatedAt > t) out.push({ collection: 'settings', doc: settings });
  return out;
}

// Last write wins per document, by the client timestamp of the edit.
export function applyRemote(docs: { collection: Collection; doc: Doc }[]) {
  const accepted: Record<string, Doc[]> = {};
  for (const { collection, doc } of docs) {
    if (collection === 'settings') {
      if (doc.updatedAt > settings.updatedAt) {
        settings = { ...DEFAULT_SETTINGS, ...(doc as Settings), id: 'settings' };
        (accepted.settings ??= []).push(settings);
      }
      continue;
    }
    const map = maps[collection] as Map<string, Doc>;
    const local = map.get(doc.id);
    if (!local || doc.updatedAt > local.updatedAt) {
      map.set(doc.id, doc);
      (accepted[collection] ??= []).push(doc);
    }
  }
  Object.entries(accepted).forEach(([store, items]) => persist(store, items));
  if (Object.keys(accepted).length) emit();
}

export async function wipeLocal() {
  maps.decks.clear();
  maps.cards.clear();
  maps.logs.clear();
  settings = { ...DEFAULT_SETTINGS };
  meta = { ...DEFAULT_META, onboarded: meta.onboarded, legacyLocalImported: true };
  pending.clear();
  await clearStores(['decks', 'cards', 'logs', 'settings', 'meta']);
  await putMany('meta', [meta]);
  emit();
}

// ---------- boot ----------

export function addSampleDeck() {
  const { deck, cards } = createSampleDeck();
  addDeck(deck, cards);
  return deck;
}

function importLocalLegacy() {
  const bundle = readLocalLegacy();
  if (hasLegacyData(bundle)) {
    const { decks, cards, logs } = convertLegacy(bundle);
    writeDocs('decks', decks.filter(d => !maps.decks.has(d.id)));
    writeDocs('cards', cards.filter(c => !maps.cards.has(c.id)));
    writeDocs('logs', logs.filter(l => !maps.logs.has(l.id)));
  }
  setMeta({ legacyLocalImported: true });
}

let initPromise: Promise<void> | null = null;

export function initStore() {
  initPromise ??= (async () => {
    persistent = await idbAvailable();
    const [decks, cards, logs, settingsRows, metaRows] = await Promise.all([
      getAll<Deck>('decks'),
      getAll<Card>('cards'),
      getAll<ReviewLog>('logs'),
      getAll<Settings>('settings'),
      getAll<Meta>('meta'),
    ]);
    decks.forEach(d => maps.decks.set(d.id, d));
    cards.forEach(c => maps.cards.set(c.id, c));
    logs.forEach(l => maps.logs.set(l.id, l));
    if (settingsRows[0]) settings = { ...DEFAULT_SETTINGS, ...settingsRows[0] };
    if (metaRows[0]) meta = { ...DEFAULT_META, ...metaRows[0] };
    if (!meta.legacyLocalImported) importLocalLegacy();
    ready = true;
    emit();
  })();
  return initPromise;
}

if (typeof window !== 'undefined') {
  // Don't lose the last answers when the tab is closed mid-batch.
  window.addEventListener('pagehide', () => void flush());
}
