// Holds the active study session (persisted, so "하차하기" and app restarts resume it) and the
// last finished session's result. Bridges the pure engine to the data store.
import { useSyncExternalStore } from 'react';
import {
  answer,
  currentItem,
  firstTryAccuracy,
  isExam,
  isFinished,
  missedFirstTry,
  next,
  recordExamAnswer,
  skipCard,
  startSession,
  type AnswerInput,
  type AnswerOutcome,
  type Ctx,
  type Session,
  type SessionConfig,
} from '../domain/session';
import type { Card } from '../domain/types';
import { STOP_SIZE } from '../domain/types';
import { todayCount } from '../domain/stats';
import { addLogs, getCard, getSnapshot, updateCard } from '../data/store';
import { cue } from '../lib/feedback';

const ACTIVE_KEY = 'quizme-active-session';
const RESULT_KEY = 'quizme-last-result';
// A paused session older than this is stale (cards were likely reviewed elsewhere since).
const RESUME_MAX_AGE_MS = 18 * 60 * 60 * 1000;

export type MissedItem = { cardId: string; question: string; answer: string; userAnswer: string; explanation?: string; type: Card['type'] };

export type SessionResult = {
  id: string;
  title: string;
  config: SessionConfig;
  xp: number;
  bestCombo: number;
  accuracy: number;
  firstTotal: number;
  firstCorrect: number;
  missed: MissedItem[];
  todayBefore: number;
  todayAfter: number;
  goalStops: number;
  durationMs: number;
  finishedAt: number;
};

function load<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function save(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or blocked: the session still works in memory
  }
}

let active: Session | null = load<Session>(ACTIVE_KEY);
let result: SessionResult | null = load<SessionResult>(RESULT_KEY);
let todayAtStart = 0;
// For "맞은 걸로 처리": the state right before the last answer.
let undo: { session: Session; card: Card; logId: string } | null = null;
const listeners = new Set<() => void>();
let snapshot = { active, result };

function emit() {
  snapshot = { active, result };
  listeners.forEach(l => l());
}

function setActive(s: Session | null) {
  active = s;
  save(ACTIVE_KEY, s);
  emit();
}

export function useSessionState() {
  return useSyncExternalStore(
    l => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snapshot,
  );
}

function ctx(): Ctx {
  const s = getSnapshot();
  return { cards: s.cards, logs: s.logs, settings: s.settings, now: Date.now() };
}

export function resumable(): Session | null {
  if (!active || isFinished(active)) return null;
  if (Date.now() - active.updatedAt > RESUME_MAX_AGE_MS) return null;
  return active;
}

export function begin(config: SessionConfig): boolean {
  const c = ctx();
  const s = startSession(config, c);
  if (!s.queue.length) return false;
  todayAtStart = todayCount(c.logs, c.now);
  undo = null;
  setActive(s);
  return true;
}

export function resume() {
  if (active) todayAtStart = todayCount(getSnapshot().logs) - active.answers.length;
}

export function abandon() {
  undo = null;
  setActive(null);
}

export function updateSession(s: Session) {
  setActive(s);
}

export function submitAnswer(card: Card, input: AnswerInput, opts: { ms?: number } = {}): AnswerOutcome | null {
  if (!active) return null;
  const now = Date.now();
  const before = todayCount(getSnapshot().logs, now);
  const outcome = answer(active, card, input, now, opts);
  undo = { session: active, card, logId: outcome.log.id };
  updateCard(card.id, outcome.cardPatch);
  addLogs([outcome.log]);
  setActive(outcome.session);
  const after = before + 1;
  const goal = getSnapshot().settings.dailyGoalStops * STOP_SIZE;
  if (after === goal) cue('finish');
  else if (after % STOP_SIZE === 0) cue('stop');
  else cue(outcome.correct ? 'correct' : 'wrong');
  return outcome;
}

// The grader was too strict: replace the last wrong answer with a correct one.
export function overrideLast(): AnswerOutcome | null {
  if (!undo || !active) return null;
  const { session, card, logId } = undo;
  const log = getSnapshot().logs.find(l => l.id === logId);
  if (log) addLogs([{ ...log, deletedAt: Date.now(), updatedAt: Date.now() }]);
  const now = Date.now();
  const outcome = answer(session, card, { userAnswer: log?.userAnswer ?? '' }, now, { override: true });
  updateCard(card.id, { ...outcome.cardPatch, lapses: card.lapses, lastWrongAt: card.lastWrongAt });
  addLogs([outcome.log]);
  undo = null;
  setActive(outcome.session);
  cue('correct');
  return outcome;
}

function finalize(s: Session) {
  const snap = getSnapshot();
  const first = s.answers.filter(a => !a.retry);
  const missed: MissedItem[] = missedFirstTry(s)
    .map(id => {
      const card = getCard(id);
      const a = s.answers.find(x => x.cardId === id && !x.retry);
      if (!card || !a) return null;
      const item: MissedItem = { cardId: id, question: card.question, answer: card.answer, userAnswer: a.userAnswer, explanation: card.explanation, type: card.type };
      return item;
    })
    .filter((m): m is MissedItem => m !== null);
  result = {
    id: s.id,
    title: s.config.title,
    config: s.config,
    xp: s.xp,
    bestCombo: s.bestCombo,
    accuracy: firstTryAccuracy(s),
    firstTotal: first.length,
    firstCorrect: first.filter(a => a.correct).length,
    missed,
    todayBefore: todayAtStart,
    todayAfter: todayCount(snap.logs),
    goalStops: snap.settings.dailyGoalStops,
    durationMs: Date.now() - s.startedAt,
    finishedAt: Date.now(),
  };
  save(RESULT_KEY, result);
  undo = null;
  setActive(null);
}

// After the feedback sheet: next card, or wrap up. Returns true when the session ended.
export function proceed(): boolean {
  if (!active) return true;
  const s = next(active, ctx());
  undo = null;
  if (isFinished(s)) {
    finalize(s);
    return true;
  }
  setActive(s);
  return false;
}

// Ends an infinite session (or any session early) and shows its result.
export function finishNow(): boolean {
  if (!active) return false;
  if (!active.answers.length) {
    abandon();
    return false;
  }
  finalize(active);
  return true;
}

export function answerExam(cardId: string, value: string): boolean {
  if (!active) return true;
  const s = recordExamAnswer(active, cardId, value, Date.now());
  cue('tap');
  if (isFinished(s)) {
    gradeExam(s);
    return true;
  }
  setActive(s);
  return false;
}

function gradeExam(s: Session) {
  let session = s;
  const logs = [];
  const now = Date.now();
  for (const [cardId, value] of Object.entries(s.examAnswers)) {
    const card = getCard(cardId);
    if (!card) continue;
    const outcome = answer(session, card, { userAnswer: value }, now + logs.length);
    session = outcome.session;
    updateCard(card.id, outcome.cardPatch);
    logs.push(outcome.log);
  }
  addLogs(logs);
  cue('finish');
  finalize(session);
}

export function dropCurrent(): boolean {
  if (!active) return true;
  const item = currentItem(active);
  if (!item) return true;
  const s = skipCard(active, item.id, Date.now());
  if (isFinished(s)) {
    if (s.answers.length || Object.keys(s.examAnswers).length) {
      if (isExam(s)) gradeExam(s);
      else finalize(s);
      return true;
    }
    abandon();
    return true;
  }
  setActive(s);
  return false;
}

export function clearResult() {
  result = null;
  save(RESULT_KEY, null);
  emit();
}
