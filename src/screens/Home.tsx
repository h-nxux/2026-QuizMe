import { useStore } from '../data/store';
import { Icon } from '../components/Icon';
import { Mascot, type Mood } from '../components/Mascot';
import { SubwayLine } from '../components/SubwayLine';
import { DeckCardMini } from '../components/DeckBits';
import { EmptyState } from '../components/Chrome';
import { startStudy, useDeckSummaries, useToday, useWeakConcepts } from '../state/derived';
import { abandon, resumable, resume, useSessionState } from '../state/sessionStore';
import { progressOf } from '../domain/session';
import { STOP_SIZE } from '../domain/types';
import { navigate } from '../lib/router';
import { useAuthContext } from '../state/auth';
import { useOnline } from '../hooks/useOnline';

export function Home() {
  const snap = useStore();
  const t = useToday();
  const decks = useDeckSummaries();
  const weak = useWeakConcepts();
  const auth = useAuthContext();
  const online = useOnline();
  useSessionState();
  const paused = resumable();

  const hasCards = t.activeCards > 0;
  const stopsToGo = Math.max(0, t.goalStops - t.stopsDone);
  const mood: Mood = !hasCards ? 'sleep' : t.goalMet ? 'cheer' : t.count > 0 ? 'happy' : 'wow';
  const message = !hasCards ? '첫 덱을 만들어보세요' : t.goalMet ? '오늘 노선 완주' : `종점까지 ${stopsToGo}정거장`;

  const sessionStops = snap.settings.sessionStops;
  const startReview = () =>
    startStudy({ mode: 'review', title: t.due > 0 ? '오늘의 복습' : '한 정거장', stops: sessionStops }, '풀 카드가 없어요');

  return (
    <div className="screen home">
      <header className="home-head">
        <span className="brand">퀴즈미<span className="brand-bang">!</span></span>
        <div className="head-chips">
          {!online && (
            <span className="chip chip-muted" title="오프라인">
              <Icon name="cloudOff" size={16} /> 오프라인
            </span>
          )}
          <button className={`chip chip-streak ${t.streak.todayDone ? 'on' : ''}`} onClick={() => navigate({ name: 'stats' })} aria-label={`연속 운행 ${t.streak.days}일`}>
            <Icon name="flame" size={16} filled={t.streak.todayDone} /> {t.streak.days}
          </button>
          <span className="chip chip-xp" aria-label={`레벨 ${t.level.level}`}>
            <Icon name="bolt" size={15} filled /> Lv.{t.level.level}
          </span>
        </div>
      </header>

      <section className="hero card">
        <div className="hero-top">
          <Mascot mood={mood} size={72} />
          <p className="hero-msg">{message}</p>
        </div>
        {hasCards && (
          <>
            <div className="hero-line-head">
              <span className="eyebrow">오늘의 노선</span>
              <span className="hero-line-count">
                <b>{Math.min(t.stopsDone, t.goalStops)}</b> / {t.goalStops} 정거장
              </span>
            </div>
            <SubwayLine stops={t.goalStops} done={t.stopsDone} partial={t.partial} />
            <p className="hero-sub">
              <b>복습 {t.due}</b> · 새 카드 {t.fresh}
            </p>
          </>
        )}
        {hasCards ? (
          <button className="btn btn-primary btn-block btn-lg" onClick={startReview}>
            <Icon name="train" /> 출발하기 <span className="btn-sub">{sessionStops}정거장 · {sessionStops * STOP_SIZE}문제</span>
          </button>
        ) : (
          <button className="btn btn-primary btn-block btn-lg" onClick={() => navigate({ name: 'create' })}>
            <Icon name="plus" /> 첫 덱 만들기
          </button>
        )}
      </section>

      {paused && (
        <section className="resume card" aria-label="이어서 풀기">
          <div>
            <span className="eyebrow">하차한 열차</span>
            <p className="resume-title">{paused.config.title}</p>
            <p className="muted small">
              {(() => {
                const p = progressOf(paused);
                return p.total === null ? `${p.done}문제 풀었어요` : `${p.done} / ${p.total}문제 진행`;
              })()}
            </p>
          </div>
          <div className="resume-actions">
            <button className="btn btn-ghost btn-sm" onClick={abandon}>그만두기</button>
            <button
              className="btn btn-choco btn-sm"
              onClick={() => {
                resume();
                navigate({ name: 'play' });
              }}
            >
              이어 타기
            </button>
          </div>
        </section>
      )}

      {hasCards && (
        <section className="modes">
          <button className="mode-tile c-mint" onClick={() => startStudy({ mode: 'infinite', title: '무한 복습', stops: null })}>
            <Icon name="infinity" size={26} />
            <span className="mode-title">무한 복습</span>
            <span className="mode-sub">카드 {t.activeCards}장</span>
          </button>
          <button className="mode-tile c-blueberry" onClick={() => navigate({ name: 'listen' })}>
            <Icon name="headphones" size={26} />
            <span className="mode-title">듣기 모드</span>
            <span className="mode-sub">자동 재생</span>
          </button>
          {snap.cards.some(c => c.starred && !c.deletedAt) && (
            <button className="mode-tile c-banana" onClick={() => startStudy({ mode: 'starred', title: '별표 카드', stops: null })}>
              <Icon name="star" size={26} />
              <span className="mode-title">별표 카드</span>
              <span className="mode-sub">{snap.cards.filter(c => c.starred && !c.deletedAt).length}장</span>
            </button>
          )}
        </section>
      )}

      {weak.length > 0 && (
        <section className="section">
          <h2 className="section-title">약한 개념</h2>
          <div className="chips-scroll">
            {weak.map(c => (
              <button
                key={c.key}
                className="concept-chip"
                onClick={() => startStudy({ mode: 'concept', title: `${c.name} 집중`, concept: c.name, stops: 1 }, '이 개념의 카드가 없어요.')}
              >
                <Icon name="target" size={16} /> {c.name}
                <span className="concept-pct">{Math.round((c.correct / c.total) * 100)}%</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">내 덱</h2>
          {decks.length > 0 && (
            <button className="link-btn" onClick={() => navigate({ name: 'library' }, { replace: true })}>
              전체 보기
            </button>
          )}
        </div>
        {decks.length ? (
          <div className="decks-scroll">
            {decks.slice(0, 8).map(s => <DeckCardMini key={s.deck.id} summary={s} />)}
            <button className="deck-mini deck-mini-add" onClick={() => navigate({ name: 'create' })}>
              <Icon name="plus" size={26} />
              <span className="deck-mini-title">새 덱</span>
            </button>
          </div>
        ) : (
          <EmptyState
            mascot={<Mascot mood="think" size={64} />}
            title="덱이 없어요"
          />
        )}
      </section>

      {auth.enabled && auth.ready && !auth.user && hasCards && (
        <section className="card soft-banner">
          <Icon name="cloud" />
          <p className="small">로그인하면 다른 기기와 동기화돼요</p>
          <button className="btn btn-sm btn-choco" onClick={auth.signIn}>로그인</button>
        </section>
      )}
    </div>
  );
}
