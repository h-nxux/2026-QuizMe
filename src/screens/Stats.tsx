import { useMemo, useState } from 'react';
import { useStore } from '../data/store';
import {
  accuracyOf,
  bestStreak,
  buildTimeline,
  computeStats,
  filterByRange,
  heatmap,
  masteryCounts,
  previousPeriod,
  RANGE_LABELS,
  WEAK_ACCURACY_BELOW,
  WEAK_MIN_ATTEMPTS,
  type RangeKey,
} from '../domain/stats';
import { STOP_SIZE } from '../domain/types';
import { CARD_TYPE_LABELS } from '../shared/generation';
import { AccuracyColumns, Heatmap, MeterRow, TimelineTable, pct } from '../components/Charts';
import { MasteryBar } from '../components/DeckBits';
import { Icon } from '../components/Icon';
import { Mascot } from '../components/Mascot';
import { EmptyState } from '../components/Chrome';
import { startStudy, useToday } from '../state/derived';

export function Stats() {
  const snap = useStore();
  const t = useToday();
  const [range, setRange] = useState<RangeKey>('30d');
  const [showTable, setShowTable] = useState(false);

  const data = useMemo(() => {
    const now = Date.now();
    const inRange = filterByRange(snap.logs, range, now);
    const stats = computeStats(inRange);
    const prev = previousPeriod(snap.logs, range, now);
    const prevStats = prev && prev.length ? computeStats(prev) : null;
    return {
      stats,
      timeline: buildTimeline(inRange, range, now),
      delta: prevStats && stats.overall.total && prevStats.overall.total ? accuracyOf(stats.overall) - accuracyOf(prevStats.overall) : null,
      heat: heatmap(snap.logs, 15, now),
      best: bestStreak(snap.logs),
      mastery: masteryCounts(snap.cards),
    };
  }, [snap.logs, snap.cards, range]);

  const { stats } = data;
  const lv = t.level;

  return (
    <div className="screen stats">
      <header className="page-head">
        <h1>기록</h1>
      </header>

      <div className="stat-tiles">
        <div className="stat-tile tile-streak">
          <Icon name="flame" filled={t.streak.todayDone} />
          <span className="stat-value">{t.streak.days}일</span>
          <span className="stat-label">연속 운행 · 최고 {Math.max(data.best, t.streak.days)}일</span>
        </div>
        <div className="stat-tile tile-xp">
          <Icon name="bolt" filled />
          <span className="stat-value">Lv.{lv.level}</span>
          <span className="stat-label">{t.xp.toLocaleString()} XP</span>
          <span className="lv-bar" role="img" aria-label={`다음 레벨까지 ${lv.span - lv.into} XP`}>
            <span style={{ width: `${(lv.into / lv.span) * 100}%` }} />
          </span>
        </div>
      </div>

      <section className="card stats-card">
        <div className="stats-card-head">
          <h3>운행 기록</h3>
          <span className="muted tiny">하루 {snap.settings.dailyGoalStops}정거장 목표</span>
        </div>
        <Heatmap weeks={data.heat} goal={snap.settings.dailyGoalStops * STOP_SIZE} />
      </section>

      <section className="card stats-card">
        <div className="stats-card-head">
          <h3>카드 숙련도</h3>
          <span className="muted tiny">전체 {snap.cards.filter(c => !c.suspended).length}장</span>
        </div>
        <MasteryBar mastery={data.mastery} showLegend />
      </section>

      <div className="seg seg-sm range-seg" role="group" aria-label="기간">
        {(Object.keys(RANGE_LABELS) as RangeKey[]).map(key => (
          <button key={key} className={range === key ? 'on' : ''} aria-pressed={range === key} onClick={() => setRange(key)}>
            {RANGE_LABELS[key]}
          </button>
        ))}
      </div>

      {stats.overall.total === 0 ? (
        <EmptyState
          mascot={<Mascot mood="sleep" size={80} />}
          title={snap.logs.length ? `${RANGE_LABELS[range]} 기록 없음` : '풀이 기록 없음'}
        />
      ) : (
        <>
          <div className="stat-tiles three">
            <div className="stat-tile">
              <span className="stat-label">정답률</span>
              <span className="stat-value">{pct(accuracyOf(stats.overall))}</span>
              {data.delta !== null && (
                <span className={`stat-delta ${data.delta >= 0 ? 'up' : 'down'}`}>
                  {data.delta >= 0 ? '▲' : '▼'} {Math.abs(Math.round(data.delta * 100))}%p
                </span>
              )}
            </div>
            <div className="stat-tile">
              <span className="stat-label">푼 문제</span>
              <span className="stat-value">{stats.overall.total.toLocaleString()}</span>
            </div>
            <div className="stat-tile">
              <span className="stat-label">공부한 날</span>
              <span className="stat-value">{stats.sessionDays}일</span>
            </div>
          </div>

          <section className="card stats-card">
            <div className="stats-card-head">
              <h3>{range === 'all' ? '주별 정답률' : '일별 정답률'}</h3>
              <button type="button" className="link-btn" onClick={() => setShowTable(v => !v)}>
                {showTable ? '차트로 보기' : '표로 보기'}
              </button>
            </div>
            {showTable ? <TimelineTable points={data.timeline} /> : <AccuracyColumns points={data.timeline} />}
          </section>

          <section className="card stats-card">
            <div className="stats-card-head">
              <h3>약점 개념</h3>
            </div>
            <p className="stats-note">{WEAK_MIN_ATTEMPTS}회 이상 출제 · 정답률 {pct(WEAK_ACCURACY_BELOW)} 미만</p>
            {stats.weakConcepts.length ? (
              <ul className="meter-list">
                {stats.weakConcepts.map(c => (
                  <li key={c.key}>
                    <button
                      className="meter-btn"
                      onClick={() => startStudy({ mode: 'concept', title: `${c.name} 집중`, concept: c.name, stops: 1 }, '이 개념의 카드가 지금은 없어요.')}
                    >
                      <MeterRow label={c.name} tally={c} />
                      {c.lastWrong && <span className="meter-detail">최근 오답: {c.lastWrong.question}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small">{stats.conceptCount === 0 ? '기록 없음' : '없음'}</p>
            )}
          </section>

          <section className="card stats-card">
            <div className="stats-card-head">
              <h3>유형별 정답률</h3>
            </div>
            <ul className="meter-list">
              {stats.byType.map(x => (
                <li key={x.type}>
                  <MeterRow label={CARD_TYPE_LABELS[x.type]} tally={x} />
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
