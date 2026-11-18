import type { Deck } from '../domain/types';
import { MASTERY_LABELS, type Mastery } from '../domain/srs';
import type { DeckSummary } from '../state/derived';
import { navigate } from '../lib/router';
import { Icon } from './Icon';

export function DeckBadge({ deck, size = 44 }: { deck: Pick<Deck, 'emoji' | 'color'>; size?: number }) {
  return (
    <span className={`deck-badge c-${deck.color}`} style={{ width: size, height: size, fontSize: size * 0.5 }} aria-hidden="true">
      {deck.emoji}
    </span>
  );
}

const ORDER: Mastery[] = ['mastered', 'familiar', 'learning', 'new'];

export function MasteryBar({ mastery, showLegend }: { mastery: Record<Mastery, number>; showLegend?: boolean }) {
  const total = ORDER.reduce((s, k) => s + mastery[k], 0);
  const label = ORDER.map(k => `${MASTERY_LABELS[k]} ${mastery[k]}장`).join(', ');
  return (
    <div className="mastery">
      <div className="mastery-bar" role="img" aria-label={`숙련도: ${label}`}>
        {total > 0 && ORDER.map(k => mastery[k] > 0 && <span key={k} className={`m-${k}`} style={{ flexGrow: mastery[k] }} />)}
      </div>
      {showLegend && (
        <ul className="mastery-legend">
          {ORDER.map(k => (
            <li key={k}>
              <span className={`dot m-${k}`} />
              {MASTERY_LABELS[k]} <b>{mastery[k]}</b>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function DeckRow({ summary }: { summary: DeckSummary }) {
  const { deck, cards, due, fresh, mastery } = summary;
  return (
    <button className={`deck-row c-${deck.color}`} onClick={() => navigate({ name: 'deck', id: deck.id })}>
      <DeckBadge deck={deck} />
      <span className="deck-row-body">
        <span className="deck-row-title">{deck.title}</span>
        <span className="deck-row-meta">
          {cards.length}장
          {due > 0 && <span className="pill pill-mint">복습 {due}</span>}
          {fresh > 0 && <span className="pill">새 카드 {fresh}</span>}
        </span>
        <MasteryBar mastery={mastery} />
      </span>
      <Icon name="chevron" size={18} className="muted" />
    </button>
  );
}

export function DeckCardMini({ summary }: { summary: DeckSummary }) {
  const { deck, cards, due } = summary;
  return (
    <button className={`deck-mini c-${deck.color}`} onClick={() => navigate({ name: 'deck', id: deck.id })}>
      <span className="deck-mini-emoji" aria-hidden="true">{deck.emoji}</span>
      <span className="deck-mini-title">{deck.title}</span>
      <span className="deck-mini-meta">{due > 0 ? `복습 ${due}장` : `${cards.length}장`}</span>
    </button>
  );
}
