// JSON export/import of everything on this device.
import type { Card, Deck, ReviewLog } from '../domain/types';
import { addCards, addDeck, addLogs, getSnapshot } from './store';

const FORMAT = 'quizme-backup';

export function exportBackup() {
  const { decks, cards, logs, settings } = getSnapshot();
  const blob = new Blob([JSON.stringify({ format: FORMAT, version: 2, exportedAt: new Date().toISOString(), decks, cards, logs, settings }, null, 0)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const d = new Date();
  a.href = url;
  a.download = `quizme-backup-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Adds what isn't already here (by id). Imported docs are re-stamped so they sync to the account.
export async function importBackup(file: File) {
  const parsed = JSON.parse(await file.text());
  if (parsed?.format !== FORMAT || !Array.isArray(parsed.decks)) throw new Error('퀴즈미 백업 파일이 아니에요.');
  const snap = getSnapshot();
  const now = Date.now();
  const haveDecks = new Set(snap.decks.map(d => d.id));
  const haveCards = new Set(snap.cards.map(c => c.id));
  const haveLogs = new Set(snap.logs.map(l => l.id));
  const decks = (parsed.decks as Deck[]).filter(d => d?.id && !d.deletedAt && !haveDecks.has(d.id));
  const cards = ((parsed.cards ?? []) as Card[]).filter(c => c?.id && !c.deletedAt && !haveCards.has(c.id));
  const logs = ((parsed.logs ?? []) as ReviewLog[]).filter(l => l?.id && !haveLogs.has(l.id));
  decks.forEach(d => addDeck({ ...d, updatedAt: now }, []));
  addCards(cards.map(c => ({ ...c, updatedAt: now })));
  addLogs(logs.map(l => ({ ...l, updatedAt: now })));
  return { decks: decks.length, cards: cards.length, logs: logs.length };
}
