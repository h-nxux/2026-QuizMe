import { useMemo, useState } from 'react';
import { useDeckSummaries } from '../state/derived';
import { DeckRow } from '../components/DeckBits';
import { EmptyState } from '../components/Chrome';
import { Mascot } from '../components/Mascot';
import { Icon } from '../components/Icon';
import { navigate } from '../lib/router';

type Sort = 'recent' | 'due' | 'name';
const SORT_LABELS: Record<Sort, string> = { recent: '최근', due: '복습 많은 순', name: '이름순' };

export function Library() {
  const all = useDeckSummaries();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('recent');

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? all.filter(s => s.deck.title.toLowerCase().includes(q) || s.cards.some(c => c.question.toLowerCase().includes(q) || (c.concept ?? '').toLowerCase().includes(q)))
      : all;
    return [...filtered].sort((a, b) => {
      if (sort === 'name') return a.deck.title.localeCompare(b.deck.title, 'ko');
      if (sort === 'due') return b.due - a.due || b.fresh - a.fresh;
      return Math.max(b.lastStudied ?? 0, b.deck.createdAt) - Math.max(a.lastStudied ?? 0, a.deck.createdAt);
    });
  }, [all, query, sort]);

  const totalCards = all.reduce((n, s) => n + s.cards.length, 0);

  return (
    <div className="screen library">
      <header className="page-head">
        <h1>서재</h1>
        <p className="muted small">덱 {all.length}개 · 카드 {totalCards}장</p>
      </header>

      {all.length > 0 && (
        <>
          <label className="search">
            <Icon name="search" size={18} />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="덱, 문제, 개념 검색" aria-label="검색" />
          </label>
          <div className="seg seg-sm" role="group" aria-label="정렬">
            {(Object.keys(SORT_LABELS) as Sort[]).map(k => (
              <button key={k} className={sort === k ? 'on' : ''} aria-pressed={sort === k} onClick={() => setSort(k)}>
                {SORT_LABELS[k]}
              </button>
            ))}
          </div>
        </>
      )}

      {list.length ? (
        <div className="deck-list">
          {list.map(s => <DeckRow key={s.deck.id} summary={s} />)}
        </div>
      ) : all.length ? (
        <p className="muted center">‘{query}’에 맞는 덱이 없어요.</p>
      ) : (
        <EmptyState
          mascot={<Mascot mood="sleep" size={96} />}
          title="덱이 없어요"
          action={<button className="btn btn-primary" onClick={() => navigate({ name: 'create' })}><Icon name="plus" /> 덱 만들기</button>}
        />
      )}
    </div>
  );
}
