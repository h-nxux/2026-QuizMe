// Two-way sync between the local store and Supabase `sync_docs` (see supabase/migrations/0002).
// Push: every local doc edited since the last push, via the push_docs RPC (server keeps the newer edit).
// Pull: rows whose server sequence number is past the last one seen.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Collection, Doc } from '../domain/types';
import { convertLegacy, type LegacyBundle } from '../domain/legacy';
import {
  applyRemote,
  changedSince,
  flush,
  getSnapshot,
  onLocalChange,
  addDeck,
  addCards,
  addLogs,
  setMeta,
  setSyncState,
  updateSettings,
  wipeLocal,
} from './store';

const PUSH_CHUNK = 200;
const PULL_PAGE = 1000;
const PUSH_DEBOUNCE_MS = 4000;
const PERIODIC_MS = 60_000;

let client: SupabaseClient | null = null;
let userId: string | null = null;
let running: Promise<void> | null = null;
let again = false;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let teardown: (() => void) | null = null;

function describe(error: unknown) {
  const e = error as { message?: string; code?: string };
  if (e?.code === 'PGRST202' || e?.code === 'PGRST205' || e?.code === '42P01' || e?.code === '42883') {
    return '서버에 동기화 테이블이 없어요. (관리자: supabase/migrations/0002_sync_docs.sql 실행 필요)';
  }
  return e?.message ?? '알 수 없는 오류';
}

async function push(db: SupabaseClient) {
  const startedAt = Date.now();
  const { lastPushAt } = getSnapshot().meta;
  const changed = changedSince(lastPushAt);
  for (let i = 0; i < changed.length; i += PUSH_CHUNK) {
    const docs = changed.slice(i, i + PUSH_CHUNK).map(({ collection, doc }) => ({
      collection,
      id: doc.id,
      data: doc,
      updated_at: doc.updatedAt,
      deleted: Boolean(doc.deletedAt),
    }));
    const { error } = await db.rpc('push_docs', { docs });
    if (error) throw error;
  }
  setMeta({ lastPushAt: startedAt });
}

async function pull(db: SupabaseClient) {
  let since = getSnapshot().meta.lastPullSeq;
  for (;;) {
    const { data, error } = await db
      .from('sync_docs')
      .select('collection, id, data, seq')
      .gt('seq', since)
      .order('seq', { ascending: true })
      .limit(PULL_PAGE);
    if (error) throw error;
    const rows = (data ?? []) as { collection: Collection; id: string; data: Doc; seq: number }[];
    if (!rows.length) break;
    applyRemote(rows.map(r => ({ collection: r.collection, doc: r.data })));
    since = Number(rows[rows.length - 1].seq);
    setMeta({ lastPullSeq: since });
    if (rows.length < PULL_PAGE) break;
  }
}

// ---------- v1 tables → v2 docs (once per account) ----------

type V1Question = { type: string; question: string; options: string[] | null; answer: string; accepted_answers: string[] | null; explanation: string | null; concept: string | null; position: number };

async function importRemoteLegacy(db: SupabaseClient) {
  const sets = await db.from('quiz_sets').select('id, kind, source_text, created_at, questions(*), flashcards(*)');
  if (sets.error) {
    // No v1 tables on this project: nothing to import.
    if (['42P01', 'PGRST205', 'PGRST200'].includes(sets.error.code ?? '')) return true;
    throw sets.error;
  }
  const attempts = await db.from('attempts').select('id, created_at, attempt_answers(*)');
  if (attempts.error) throw attempts.error;

  type SetRow = { id: string; kind: string; source_text: string; created_at: string; questions: V1Question[]; flashcards: { term: string; definition: string; position: number }[] };
  type AttemptRow = { id: string; created_at: string; attempt_answers: { position: number; question: string; type: string; concept: string | null; user_answer: string; correct_answer: string; is_correct: boolean }[] };
  const byPos = <T extends { position: number }>(xs: T[]) => [...(xs ?? [])].sort((a, b) => a.position - b.position);

  const rows = (sets.data ?? []) as unknown as SetRow[];
  const bundle: LegacyBundle = {
    sessions: rows.filter(r => r.kind === 'quiz').map(r => ({ id: r.id, sourceText: r.source_text, createdAt: r.created_at, questions: byPos(r.questions) })),
    flashcardSets: rows.filter(r => r.kind === 'flashcard').map(r => ({ id: r.id, sourceText: r.source_text, createdAt: r.created_at, flashcards: byPos(r.flashcards) })),
    attempts: ((attempts.data ?? []) as unknown as AttemptRow[]).map(a => ({
      id: a.id,
      createdAt: a.created_at,
      items: byPos(a.attempt_answers).map(x => ({
        question: x.question,
        type: x.type,
        concept: x.concept,
        userAnswer: x.user_answer,
        correctAnswer: x.correct_answer,
        isCorrect: x.is_correct,
      })),
    })),
  };

  const { decks, cards, logs } = convertLegacy(bundle);
  const snap = getSnapshot();
  const haveDeck = new Set(snap.decks.map(d => d.id));
  const haveCard = new Set(snap.cards.map(c => c.id));
  const haveLog = new Set(snap.logs.map(l => l.id));
  decks.filter(d => !haveDeck.has(d.id)).forEach(d => addDeck(d, []));
  addCards(cards.filter(c => !haveCard.has(c.id)));
  addLogs(logs.filter(l => !haveLog.has(l.id)));
  return true;
}

// ---------- orchestration ----------

async function runOnce() {
  const db = client;
  if (!db || !userId) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    setSyncState({ ...getSnapshot().sync, status: 'offline' });
    return;
  }
  setSyncState({ ...getSnapshot().sync, status: 'syncing' });
  try {
    await pull(db);
    if (!getSnapshot().settings.legacyRemoteImported) {
      if (await importRemoteLegacy(db)) updateSettings({ legacyRemoteImported: true });
    }
    await push(db);
    setSyncState({ status: 'idle', lastSyncedAt: Date.now() });
  } catch (error) {
    console.error('[sync]', error);
    setSyncState({ ...getSnapshot().sync, status: 'error', error: describe(error) });
  }
}

export function syncNow(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      await runOnce();
    } while (again);
  })().finally(() => {
    running = null;
  });
  return running;
}

function schedulePush() {
  if (!client) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => void syncNow(), PUSH_DEBOUNCE_MS);
}

export async function startSync(db: SupabaseClient, uid: string) {
  if (client === db && userId === uid) return;
  stopSync();
  const { meta } = getSnapshot();
  if (meta.ownerId && meta.ownerId !== uid) {
    // Another account's data is on this device; it's safe on the server, so start clean.
    await wipeLocal();
  }
  if (getSnapshot().meta.ownerId !== uid) {
    // Guest data (or a fresh device) joins this account: push everything once.
    setMeta({ ownerId: uid, lastPushAt: 0, lastPullSeq: 0 });
  }
  client = db;
  userId = uid;

  const offLocal = onLocalChange(schedulePush);
  const onOnline = () => void syncNow();
  const onHidden = () => {
    if (document.visibilityState === 'hidden') void syncNow();
  };
  const timer = setInterval(() => {
    if (document.visibilityState === 'visible') void syncNow();
  }, PERIODIC_MS);
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onHidden);
  teardown = () => {
    offLocal();
    clearInterval(timer);
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', onHidden);
  };
  await syncNow();
}

export function stopSync() {
  teardown?.();
  teardown = null;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = null;
  client = null;
  userId = null;
  setSyncState({ status: 'disabled' });
}

// Before signing out: push what's left (bounded wait), then clear this device.
export async function signOutCleanup() {
  await flush();
  await Promise.race([syncNow(), new Promise(r => setTimeout(r, 4000))]);
  stopSync();
  await wipeLocal();
}

export async function fullResync() {
  setMeta({ lastPullSeq: 0, lastPushAt: 0 });
  await syncNow();
}
