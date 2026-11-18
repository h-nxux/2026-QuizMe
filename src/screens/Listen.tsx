import { useEffect, useMemo, useRef, useState } from 'react';
import { getCard, updateCard, updateSettings, useStore } from '../data/store';
import { pickBatch, isActive } from '../domain/queue';
import type { Card } from '../domain/types';
import { keepAwake, speak, speechSupported, stopSpeaking } from '../lib/speech';
import { TopBar } from '../components/Chrome';
import { Icon } from '../components/Icon';
import { Mascot } from '../components/Mascot';
import { CARD_TYPE_LABELS } from '../shared/generation';

type Phase = 'question' | 'thinking' | 'answer' | 'idle';

const RATES = [0.8, 1, 1.2, 1.5];
const DELAYS = [2, 4, 6, 10];

function questionScript(card: Card) {
  if (card.type === 'flashcard') return `${card.question}. 무슨 뜻일까요?`;
  if (card.type === 'ox') return `오엑스 문제. ${card.question}. 맞을까요, 틀릴까요?`;
  if (card.type === 'multiple_choice' && card.options) {
    return `${card.question}. ${card.options.map((o, i) => `${i + 1}번, ${o}.`).join(' ')}`;
  }
  return card.question;
}

function answerScript(card: Card) {
  const answer = card.type === 'ox' ? (card.answer === 'O' ? '오, 맞아요.' : '엑스, 틀려요.') : `${card.answer}.`;
  return `정답은, ${answer} ${card.explanation ?? ''}`;
}

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

// Passive listening doesn't touch the review schedule: hearing an answer isn't recalling it.
export function Listen({ deckId }: { deckId?: string }) {
  const snap = useStore();
  const deck = deckId ? snap.decks.find(d => d.id === deckId) : undefined;
  const pool = useMemo(() => snap.cards.filter(c => isActive(c) && (!deckId || c.deckId === deckId)), [snap.cards, deckId]);
  const [queue, setQueue] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [heard, setHeard] = useState(0);
  const run = useRef(0);
  const queueRef = useRef<string[]>([]);
  queueRef.current = queue;
  const { ttsRate, listenDelaySec } = snap.settings;
  const settingsRef = useRef({ ttsRate, listenDelaySec });
  settingsRef.current = { ttsRate, listenDelaySec };

  useEffect(() => {
    if (!queue.length && pool.length) {
      setQueue(pickBatch({ cards: pool, now: Date.now(), size: 30, newAllowance: Infinity }).map(p => p.id));
    }
  }, [pool, queue.length]);

  useEffect(() => () => {
    run.current += 1;
    stopSpeaking();
  }, []);

  useEffect(() => {
    if (!playing) return;
    let release: (() => void) | null = null;
    void keepAwake().then(r => (release = r));
    return () => release?.();
  }, [playing]);

  const card = queue.length ? getCard(queue[index % queue.length]) : undefined;

  const loop = async (start: number) => {
    const mine = (run.current += 1);
    let i = start;
    const alive = () => mine === run.current;
    while (alive()) {
      const q = queueRef.current;
      const id = q[i % q.length];
      const c = id ? getCard(id) : undefined;
      if (!c) break;
      setIndex(i % q.length);
      setPhase('question');
      await speak(questionScript(c), settingsRef.current.ttsRate);
      if (!alive()) return;
      setPhase('thinking');
      await wait(settingsRef.current.listenDelaySec * 1000);
      if (!alive()) return;
      setPhase('answer');
      await speak(answerScript(c), settingsRef.current.ttsRate);
      if (!alive()) return;
      setHeard(h => h + 1);
      await wait(1200);
      i += 1;
      // Reshuffle after a full lap so the order doesn't become a memorized sequence.
      if (i % q.length === 0) {
        i = 0;
        const fresh = pickBatch({ cards: pool, now: Date.now(), size: 30, newAllowance: Infinity }).map(p => p.id);
        queueRef.current = fresh;
        setQueue(fresh);
      }
    }
  };

  const play = () => {
    setPlaying(true);
    void loop(index);
  };
  const pause = () => {
    run.current += 1;
    stopSpeaking();
    setPlaying(false);
    setPhase('idle');
  };
  const skip = () => {
    run.current += 1;
    stopSpeaking();
    const nextIndex = (index + 1) % Math.max(queue.length, 1);
    setIndex(nextIndex);
    if (playing) void loop(nextIndex);
  };

  const title = deck ? `${deck.emoji} ${deck.title}` : '모든 덱';

  if (!speechSupported()) {
    return (
      <div className="screen">
        <TopBar back title="듣기 모드" />
        <div className="empty">
          <Mascot mood="sad" size={90} />
          <h3>이 브라우저는 음성 읽기를 지원하지 않아요</h3>
          <p className="muted">크롬이나 사파리 최신 버전에서 열어주세요.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="screen listen">
      <TopBar back title="듣기 모드" />
      <p className="listen-scope muted small">{title} · {pool.length}장 · 들은 카드 {heard}</p>

      {card ? (
        <section className={`listen-card phase-${phase}`} aria-live="polite">
          <span className="type-badge">{CARD_TYPE_LABELS[card.type]}</span>
          <p className="listen-q">{card.question}</p>
          {card.type === 'multiple_choice' && card.options && (
            <ol className="listen-opts">
              {card.options.map(o => <li key={o}>{o}</li>)}
            </ol>
          )}
          <div className="listen-a" aria-hidden={phase !== 'answer'}>
            {phase === 'answer' ? (
              <>
                <strong>{card.type === 'ox' ? (card.answer === 'O' ? 'O · 맞다' : 'X · 틀리다') : card.answer}</strong>
                {card.explanation && <p className="small">{card.explanation}</p>}
              </>
            ) : phase === 'thinking' ? (
              <span className="thinking">생각할 시간<span className="gen-dots"><i /><i /><i /></span></span>
            ) : null}
          </div>
        </section>
      ) : (
        <div className="empty">
          <Mascot mood="sleep" size={90} />
          <h3>들을 카드가 없어요</h3>
        </div>
      )}

      <div className="listen-controls">
        <button
          className={`icon-btn big ${card?.starred ? 'starred' : ''}`}
          aria-label="별표"
          aria-pressed={!!card?.starred}
          onClick={() => card && updateCard(card.id, { starred: !card.starred })}
          disabled={!card}
        >
          <Icon name="star" filled={card?.starred} size={26} />
        </button>
        <button className="play-btn" onClick={playing ? pause : play} disabled={!card} aria-label={playing ? '일시정지' : '재생'}>
          <Icon name={playing ? 'pause' : 'play'} size={34} filled />
        </button>
        <button className="icon-btn big" onClick={skip} disabled={!card} aria-label="다음 카드">
          <Icon name="skip" size={26} />
        </button>
      </div>

      <div className="listen-settings">
        <div className="field-inline">
          <span>속도</span>
          <div className="seg seg-sm">
            {RATES.map(r => (
              <button key={r} className={ttsRate === r ? 'on' : ''} aria-pressed={ttsRate === r} onClick={() => updateSettings({ ttsRate: r })}>
                {r}x
              </button>
            ))}
          </div>
        </div>
        <div className="field-inline">
          <span>생각할 시간</span>
          <div className="seg seg-sm">
            {DELAYS.map(d => (
              <button key={d} className={listenDelaySec === d ? 'on' : ''} aria-pressed={listenDelaySec === d} onClick={() => updateSettings({ listenDelaySec: d })}>
                {d}초
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
