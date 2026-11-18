import { useMemo, useState } from 'react';
import { deleteDeck, restoreDeck, updateDeck, updateCard, useStore } from '../data/store';
import { TopBar } from '../components/Chrome';
import { Icon } from '../components/Icon';
import { Mascot } from '../components/Mascot';
import { DeckBadge, MasteryBar } from '../components/DeckBits';
import { CardEditor } from '../components/CardEditor';
import { Sheet } from '../components/Sheet';
import { toast } from '../components/Toast';
import { startStudy } from '../state/derived';
import { runMore, useJob } from '../state/generation';
import { remixDeck, weakCardsOf } from '../state/remix';
import { useAuthContext } from '../state/auth';
import { navigate } from '../lib/router';
import { dueCards, newCards, isActive } from '../domain/queue';
import { masteryCounts } from '../domain/stats';
import { masteryOf, MASTERY_LABELS, type Mastery } from '../domain/srs';
import { relativeDue } from '../domain/time';
import { DECK_COLORS, type Card, type Deck } from '../domain/types';
import { CARD_TYPE_LABELS, DEFAULT_GENERATION_OPTIONS } from '../shared/generation';
import { EXAM_LIMIT } from '../domain/session';
import { useOnline } from '../hooks/useOnline';

type Filter = 'all' | Mastery | 'starred' | 'hidden';
const FILTER_LABELS: Record<Filter, string> = { all: '전체', new: '새 카드', learning: '학습 중', familiar: '익숙함', mastered: '마스터', starred: '별표', hidden: '숨김' };
const EMOJI_CHOICES = ['📘', '📗', '📕', '🧠', '🔬', '🧪', '📐', '🌍', '💻', '🎨', '🎵', '⚖️', '💊', '📈', '🏛️', '✏️', '🌱', '🗂️'];

export function DeckScreen({ id }: { id: string }) {
  const snap = useStore();
  const auth = useAuthContext();
  const job = useJob();
  const online = useOnline();
  const deck = snap.decks.find(d => d.id === id);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Card | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [remixing, setRemixing] = useState(false);

  const allCards = useMemo(() => snap.cards.filter(c => c.deckId === id), [snap.cards, id]);
  const active = useMemo(() => allCards.filter(isActive), [allCards]);
  const now = Date.now();

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allCards
      .filter(c => {
        if (filter === 'hidden') return c.suspended;
        if (c.suspended) return false;
        if (filter === 'starred') return c.starred;
        if (filter !== 'all') return masteryOf(c) === filter;
        return true;
      })
      .filter(c => !q || c.question.toLowerCase().includes(q) || c.answer.toLowerCase().includes(q) || (c.concept ?? '').toLowerCase().includes(q))
      .sort((a, b) => a.createdAt - b.createdAt);
  }, [allCards, filter, query]);

  if (!deck) {
    return (
      <div className="screen">
        <TopBar back={{ name: 'library' }} />
        <div className="empty">
          <Mascot mood="sad" size={90} />
          <h3>덱을 찾을 수 없어요</h3>
          <button className="btn btn-primary" onClick={() => navigate({ name: 'library' }, { replace: true })}>서재로</button>
        </div>
      </div>
    );
  }

  const due = dueCards(active, now).length;
  const fresh = newCards(active).length;
  const mastery = masteryCounts(active);
  const weakCount = weakCardsOf(id).length;
  const generatingHere = job?.status === 'running' && job.kind === 'more' && job.deckId === id;
  const stops = snap.settings.sessionStops;
  const hasStarred = active.some(c => c.starred);

  const needOnlineAndLogin = (reason: string) => {
    if (!auth.canGenerate) {
      auth.requireLogin(reason);
      return false;
    }
    if (!online) {
      toast('오프라인에서는 할 수 없어요');
      return false;
    }
    return true;
  };

  const doRemix = async () => {
    if (!needOnlineAndLogin('환승 문제는 로그인 후 만들 수 있어요.')) return;
    setRemixing(true);
    try {
      const created = await remixDeck(id);
      toast(`환승 문제 ${created.length}개가 생겼어요`, { tone: 'good', action: { label: '풀기', run: () => startStudy({ mode: 'deck', title: `${deck.title} 환승`, cardIds: created.map(c => c.id), stops: 1 }) } });
    } catch (error) {
      toast(error instanceof Error ? error.message : '환승 문제를 만들지 못했어요.', { tone: 'error' });
    } finally {
      setRemixing(false);
    }
  };

  const remove = () => {
    const at = Date.now();
    deleteDeck(id);
    navigate({ name: 'library' }, { replace: true });
    toast(`'${deck.title}' 덱을 지웠어요`, { action: { label: '되돌리기', run: () => restoreDeck(id, at) } });
  };

  return (
    <div className="screen deck">
      <TopBar
        back={{ name: 'library' }}
        actions={
          <button className="icon-btn" aria-label="덱 설정" onClick={() => setSettingsOpen(true)}>
            <Icon name="more" />
          </button>
        }
      />

      <section className={`deck-hero c-${deck.color}`}>
        <DeckBadge deck={deck} size={64} />
        <h1>{deck.title}</h1>
        <p className="small">{active.length}장 · 복습 {due} · 새 카드 {fresh}</p>
        <MasteryBar mastery={mastery} showLegend />
      </section>

      <div className="deck-actions">
        <button
          className="btn btn-primary btn-block btn-lg"
          onClick={() => startStudy({ mode: 'deck', title: deck.title, deckId: id, stops }, '이 덱에 카드가 없어요.')}
        >
          <Icon name="train" /> 학습하기 <span className="btn-sub">{stops}정거장</span>
        </button>
        <div className="action-grid">
          <button className="action" onClick={() => startStudy({ mode: 'deck', title: `${deck.title} 무한`, deckId: id, stops: null }, '이 덱에 카드가 없어요.')}>
            <Icon name="infinity" /> 무한
          </button>
          <button className="action" onClick={() => startStudy({ mode: 'exam', title: `${deck.title} 시험`, deckId: id, stops: 1 }, '시험 볼 카드가 없어요.')}>
            <Icon name="exam" /> 시험 <small>최대 {EXAM_LIMIT}문제</small>
          </button>
          <button className="action" onClick={() => navigate({ name: 'listen', deckId: id })}>
            <Icon name="headphones" /> 듣기
          </button>
          {hasStarred && (
            <button className="action" onClick={() => startStudy({ mode: 'deck', title: `${deck.title} 별표`, cardIds: active.filter(c => c.starred).map(c => c.id), stops: 1 })}>
              <Icon name="star" /> 별표
            </button>
          )}
          <button className="action" onClick={() => needOnlineAndLogin('카드를 더 만들려면 로그인이 필요해요.') && setMoreOpen(true)} disabled={generatingHere || !deck.sourceText.trim()}>
            {generatingHere ? <span className="spinner" /> : <Icon name="plus" />} {generatingHere ? '만드는 중' : '더 만들기'}
          </button>
          <button className="action" onClick={() => void doRemix()} disabled={remixing || weakCount === 0} title={weakCount === 0 ? '틀린 카드가 없어요' : undefined}>
            {remixing ? <span className="spinner" /> : <Icon name="transfer" />} 환승 문제
          </button>
        </div>
      </div>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">카드</h2>
          {deck.sourceText && <button className="link-btn" onClick={() => setSourceOpen(true)}>원본 자료</button>}
        </div>
        <label className="search">
          <Icon name="search" size={18} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="카드 검색" aria-label="카드 검색" />
        </label>
        <div className="chips-scroll filter-chips" role="group" aria-label="필터">
          {(Object.keys(FILTER_LABELS) as Filter[])
            .filter(f => f === 'all' || (f === 'hidden' ? allCards.some(c => c.suspended) : f === 'starred' ? hasStarred : mastery[f as Mastery] > 0))
            .map(f => (
              <button key={f} className={`filter-chip ${filter === f ? 'on' : ''}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {FILTER_LABELS[f]}
              </button>
            ))}
        </div>
        <ul className="card-list">
          {shown.map(c => (
            <li key={c.id} className="card-item">
              <button className="card-item-main" onClick={() => setEditing(c)}>
                <span className="card-item-top">
                  <span className="type-badge">{CARD_TYPE_LABELS[c.type]}</span>
                  {c.origin === 'remix' && <span className="type-badge badge-grape">환승</span>}
                  <span className={`mastery-dot m-${masteryOf(c)}`} title={MASTERY_LABELS[masteryOf(c)]} />
                  <span className="muted tiny">{c.reps ? `다음 ${relativeDue(c.due, now)}` : '아직 안 풂'}</span>
                </span>
                <span className="card-item-q">{c.question}</span>
                <span className="card-item-a">{c.type === 'ox' ? (c.answer === 'O' ? 'O · 맞다' : 'X · 틀리다') : c.answer}</span>
              </button>
              <button
                className={`icon-btn ${c.starred ? 'starred' : ''}`}
                aria-label={c.starred ? '별표 해제' : '별표'}
                aria-pressed={!!c.starred}
                onClick={() => updateCard(c.id, { starred: !c.starred })}
              >
                <Icon name="star" filled={c.starred} size={20} />
              </button>
            </li>
          ))}
          {!shown.length && <li className="muted center small">카드 없음</li>}
        </ul>
      </section>

      <CardEditor card={editing} onClose={() => setEditing(null)} />

      <DeckSettings deck={deck} open={settingsOpen} onClose={() => setSettingsOpen(false)} onDelete={remove} />

      <Sheet open={sourceOpen} onClose={() => setSourceOpen(false)} title="원본 자료">
        <pre className="source-view">{deck.sourceText}</pre>
      </Sheet>

      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="카드 추가">
        <div className="row-3">
          {[5, 10, 20].map(n => (
            <button
              key={n}
              className="btn btn-choco"
              onClick={() => {
                setMoreOpen(false);
                void runMore(id, { ...(deck.options ?? snap.settings.lastGeneration ?? DEFAULT_GENERATION_OPTIONS), count: n });
                toast('카드 추가 중');
              }}
            >
              +{n}장
            </button>
          ))}
        </div>
      </Sheet>
    </div>
  );
}

function DeckSettings({ deck, open, onClose, onDelete }: { deck: Deck; open: boolean; onClose: () => void; onDelete: () => void }) {
  const [title, setTitle] = useState(deck.title);
  const [confirm, setConfirm] = useState(false);
  return (
    <Sheet
      open={open}
      onClose={() => {
        if (title.trim() && title.trim() !== deck.title) updateDeck(deck.id, { title: title.trim() });
        setConfirm(false);
        onClose();
      }}
      title="덱 설정"
    >
      <div className="form">
        <label className="field">
          <span>이름</span>
          <input value={title} onChange={e => setTitle(e.target.value)} onBlur={() => title.trim() && updateDeck(deck.id, { title: title.trim() })} maxLength={40} />
        </label>
        <div className="field">
          <span>이모지</span>
          <div className="emoji-grid">
            {EMOJI_CHOICES.map(e => (
              <button key={e} className={deck.emoji === e ? 'on' : ''} onClick={() => updateDeck(deck.id, { emoji: e })} aria-label={e} aria-pressed={deck.emoji === e}>
                {e}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span>색</span>
          <div className="color-row">
            {DECK_COLORS.map(c => (
              <button key={c} className={`color-dot c-${c} ${deck.color === c ? 'on' : ''}`} onClick={() => updateDeck(deck.id, { color: c })} aria-label={c} aria-pressed={deck.color === c} />
            ))}
          </div>
        </div>
        {confirm ? (
          <div className="confirm-box">
            <p>덱과 카드를 모두 삭제할까요? 풀이 기록은 남아요.</p>
            <div className="row-2">
              <button className="btn btn-ghost" onClick={() => setConfirm(false)}>취소</button>
              <button className="btn btn-berry" onClick={onDelete}>지우기</button>
            </div>
          </div>
        ) : (
          <button className="btn btn-ghost danger btn-block" onClick={() => setConfirm(true)}>
            <Icon name="trash" /> 덱 삭제
          </button>
        )}
      </div>
    </Sheet>
  );
}
