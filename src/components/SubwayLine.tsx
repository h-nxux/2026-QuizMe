import { Icon } from './Icon';

type Props = {
  stops: number;
  done: number;
  // Answers into the current stop (0–4), so the train moves between stations.
  partial?: number;
  compact?: boolean;
  highlight?: number;
};

// Today's goal drawn as a subway line: one station per 5 answers, the train sits where you are.
export function SubwayLine({ stops, done, partial = 0, compact, highlight }: Props) {
  const clampedDone = Math.min(done, stops);
  const position = clampedDone >= stops ? stops : clampedDone + Math.min(partial, 4.5) / 5;
  const pct = stops ? (position / stops) * 100 : 0;
  return (
    <div className={`line ${compact ? 'line-compact' : ''}`} role="img" aria-label={`오늘의 노선 ${stops}정거장 중 ${clampedDone}정거장 완료`}>
      <div className="line-track">
        <div className="line-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="line-stations">
        {Array.from({ length: stops + 1 }, (_, i) => (
          <span
            key={i}
            className={`station ${i <= clampedDone ? 'lit' : ''} ${i === stops ? 'terminal' : ''} ${highlight === i ? 'pop' : ''}`}
            style={{ left: `${(i / stops) * 100}%` }}
          />
        ))}
      </div>
      <div className="line-train" style={{ left: `${pct}%` }}>
        <Icon name="train" size={compact ? 16 : 20} />
      </div>
    </div>
  );
}
