import { useEffect, useState } from 'react';
import { useSessionState } from '../state/sessionStore';
import { retryMissed, startStudy } from '../state/derived';
import { useStore } from '../data/store';
import { navigate } from '../lib/router';
import { Mascot } from '../components/Mascot';
import { SubwayLine } from '../components/SubwayLine';
import { Confetti } from '../components/Confetti';
import { Icon } from '../components/Icon';
import { STOP_SIZE } from '../domain/types';
import { CARD_TYPE_LABELS } from '../shared/generation';

function duration(ms: number) {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? `${s}초` : `${Math.floor(s / 60)}분 ${s % 60}초`;
}

export function Result() {
  const { result } = useSessionState();
  const snap = useStore();
  const [showLine, setShowLine] = useState(false);

  useEffect(() => {
    if (!result) navigate({ name: 'home' }, { replace: true });
    const t = setTimeout(() => setShowLine(true), 500);
    return () => clearTimeout(t);
  }, [result]);

  if (!result) return null;
  const pct = Math.round(result.accuracy * 100);
  const stopsBefore = Math.floor(result.todayBefore / STOP_SIZE);
  const stopsAfter = Math.floor(result.todayAfter / STOP_SIZE);
  const goalReachedNow = result.todayBefore < result.goalStops * STOP_SIZE && result.todayAfter >= result.goalStops * STOP_SIZE;
  const mood = pct >= 80 ? 'cheer' : pct >= 50 ? 'happy' : 'think';
  const headline = goalReachedNow ? '오늘 노선 완주' : pct === 100 ? '전부 맞혔어요' : pct >= 80 ? '잘했어요' : '수고했어요';
  const exam = result.config.mode === 'exam';
  const nextStops = snap.settings.sessionStops;

  return (
    <div className="screen result">
      {(pct >= 80 || goalReachedNow) && <Confetti />}
      <div className="result-hero">
        <Mascot mood={mood} size={120} />
        <h1>{headline}</h1>
        <p className="muted">{result.title}</p>
      </div>

      <div className="result-stats">
        <div className="rstat">
          <span className="rstat-label">정답률</span>
          <span className="rstat-value c-mint-text">{pct}%</span>
          <span className="rstat-sub">{result.firstCorrect}/{result.firstTotal}</span>
        </div>
        <div className="rstat">
          <span className="rstat-label">XP</span>
          <span className="rstat-value c-banana-text">+{result.xp}</span>
          <span className="rstat-sub">{duration(result.durationMs)}</span>
        </div>
        <div className="rstat">
          <span className="rstat-label">최고 콤보</span>
          <span className="rstat-value c-berry-text">{result.bestCombo}</span>
          <span className="rstat-sub">연속 정답</span>
        </div>
      </div>

      <section className="card result-line">
        <div className="hero-line-head">
          <span className="eyebrow">오늘의 노선</span>
          <span className="hero-line-count"><b>{Math.min(stopsAfter, result.goalStops)}</b> / {result.goalStops} 정거장</span>
        </div>
        <SubwayLine
          stops={result.goalStops}
          done={showLine ? stopsAfter : stopsBefore}
          partial={showLine ? result.todayAfter % STOP_SIZE : result.todayBefore % STOP_SIZE}
          highlight={showLine && stopsAfter > stopsBefore ? Math.min(stopsAfter, result.goalStops) : undefined}
        />
      </section>

      {result.missed.length > 0 && (
        <section className="section">
          <h2 className="section-title">틀린 문제 {result.missed.length}개</h2>
          <ul className="missed">
            {result.missed.map(m => (
              <li key={m.cardId} className="missed-item">
                <span className="type-badge">{CARD_TYPE_LABELS[m.type]}</span>
                <p className="missed-q">{m.question}</p>
                {m.type !== 'flashcard' && <p className="missed-mine">내 답: {m.userAnswer || '(모름)'}</p>}
                <p className="missed-a">정답: {m.answer}</p>
                {m.explanation && <p className="missed-ex">{m.explanation}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="result-actions">
        {result.missed.length > 0 && (
          <button className="btn btn-berry btn-block" onClick={() => retryMissed(result)}>
            <Icon name="refresh" /> 틀린 문제만 다시
          </button>
        )}
        {!exam && (
          <button
            className="btn btn-primary btn-block btn-lg"
            onClick={() =>
              startStudy(
                result.config.deckId
                  ? { ...result.config, cardIds: undefined, mode: result.config.mode === 'retry' ? 'deck' : result.config.mode, stops: result.config.stops ?? nextStops }
                  : { mode: 'review', title: '한 정거장 더', stops: nextStops },
              )
            }
          >
            <Icon name="train" /> 한 정거장 더
          </button>
        )}
        <button className="btn btn-ghost btn-block" onClick={() => navigate({ name: 'home' }, { replace: true })}>홈으로</button>
      </div>
    </div>
  );
}
