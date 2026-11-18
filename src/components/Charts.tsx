import { useState } from 'react';
import { accuracyOf, type HeatCell, type Tally, type TimelinePoint } from '../domain/stats';
import { STOP_SIZE } from '../domain/types';

export const pct = (value: number) => `${Math.round(value * 100)}%`;

export function MeterRow({ label, tally }: { label: string; tally: Tally }) {
  const accuracy = accuracyOf(tally);
  return (
    <div className="meter-row">
      <span className="meter-label">{label}</span>
      <span className="meter-track" role="img" aria-label={`${label} 정답률 ${pct(accuracy)}`}>
        <span className="meter-fill" style={{ width: pct(accuracy) }} />
      </span>
      <span className="meter-value">
        {pct(accuracy)} <span className="muted">· {tally.correct}/{tally.total}</span>
      </span>
    </div>
  );
}

export function AccuracyColumns({ points }: { points: TimelinePoint[] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const labelEvery = Math.max(1, Math.ceil(points.length / 7));
  return (
    <div className="columns-chart">
      <div className="columns-y" aria-hidden="true">
        <span>100%</span>
        <span>50%</span>
        <span>0%</span>
      </div>
      <div className="columns-plot">
        <div className="columns-grid" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="columns-row">
          {points.map((p, i) => {
            const accuracy = accuracyOf(p);
            const description = p.total ? `${p.tooltipLabel} 정답률 ${pct(accuracy)}, ${p.total}문제 중 ${p.correct}개 정답` : `${p.tooltipLabel} 기록 없음`;
            return (
              <div
                key={p.key}
                className={`column-slot ${hovered === i ? 'hovered' : ''}`}
                tabIndex={0}
                aria-label={description}
                onPointerEnter={() => setHovered(i)}
                onPointerLeave={() => setHovered(null)}
                onFocus={() => setHovered(i)}
                onBlur={() => setHovered(null)}
              >
                {p.total > 0 && <div className="column-bar" style={{ height: accuracy > 0 ? pct(accuracy) : '2px' }} />}
                {hovered === i && (
                  <div className={`chart-tooltip ${i > points.length / 2 ? 'left' : ''}`} role="presentation">
                    {p.total ? (
                      <>
                        <strong>{pct(accuracy)}</strong>
                        <span>{p.correct}/{p.total} 정답 · {p.tooltipLabel}</span>
                      </>
                    ) : (
                      <span>{p.tooltipLabel} · 기록 없음</span>
                    )}
                  </div>
                )}
                <span className="column-x">{i % labelEvery === 0 || i === points.length - 1 ? p.label : ''}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function TimelineTable({ points }: { points: TimelinePoint[] }) {
  const rows = points.filter(p => p.total > 0).reverse();
  return (
    <div className="table-scroll">
      <table className="stats-table">
        <thead>
          <tr>
            <th scope="col">기간</th>
            <th scope="col">푼 문제</th>
            <th scope="col">정답</th>
            <th scope="col">정답률</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(p => (
            <tr key={p.key}>
              <td>{p.tooltipLabel}</td>
              <td>{p.total}</td>
              <td>{p.correct}</td>
              <td>{pct(accuracyOf(p))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function level(count: number, goal: number) {
  if (count === 0) return 0;
  if (count < STOP_SIZE) return 1;
  if (count < goal / 2) return 2;
  if (count < goal) return 3;
  return 4;
}

const WEEKDAYS = ['월', '', '수', '', '금', '', '일'];

export function Heatmap({ weeks, goal }: { weeks: HeatCell[][]; goal: number }) {
  const [focus, setFocus] = useState<HeatCell | null>(null);
  const months = weeks.map((w, i) => {
    const d = new Date(w[0].date);
    const prev = i > 0 ? new Date(weeks[i - 1][0].date) : null;
    return !prev || prev.getMonth() !== d.getMonth() ? `${d.getMonth() + 1}월` : '';
  });
  return (
    <div className="heatmap-wrap">
      <div className="heatmap-months" aria-hidden="true">
        <span />
        {months.map((m, i) => <span key={i}>{m}</span>)}
      </div>
      <div className="heatmap">
        <div className="heatmap-days" aria-hidden="true">
          {WEEKDAYS.map((d, i) => <span key={i}>{d}</span>)}
        </div>
        {weeks.map((w, i) => (
          <div key={i} className="heatmap-col">
            {w.map(cell => (
              <span
                key={cell.key}
                className={`heat l${cell.future ? 'x' : level(cell.count, goal)}`}
                tabIndex={cell.future ? -1 : 0}
                aria-label={`${cell.key} ${cell.count}문제`}
                onPointerEnter={() => setFocus(cell)}
                onFocus={() => setFocus(cell)}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="heatmap-foot">
        <span className="muted tiny">{focus ? `${focus.key.slice(5).replace('-', '/')} · ${focus.count}문제` : ''}</span>
        <span className="heat-legend" aria-hidden="true">
          적음 <i className="heat l1" /><i className="heat l2" /><i className="heat l3" /><i className="heat l4" /> 목표 달성
        </span>
      </div>
    </div>
  );
}
