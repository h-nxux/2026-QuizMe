import { useState } from 'react';
import { Mascot } from '../components/Mascot';
import { SubwayLine } from '../components/SubwayLine';
import { addSampleDeck, setMeta, updateSettings, useStore } from '../data/store';
import { startStudy } from '../state/derived';
import { navigate } from '../lib/router';

const SLIDES = [
  {
    mood: 'wow' as const,
    title: '내 자료로\n퀴즈 만들기',
    body: '필기 사진, PDF, 텍스트를 넣으면 문제와 플래시카드가 만들어져요.',
  },
  {
    mood: 'happy' as const,
    title: '한 정거장,\n다섯 문제',
    body: '2분 단위로 끊어서 풀어요.',
    line: true,
  },
  {
    mood: 'cheer' as const,
    title: '잊을 때쯤\n다시',
    body: '맞힌 문제는 1·3·7·14일 뒤, 틀린 문제는 다음 날 다시 나와요.',
  },
];

const GOALS = [
  { stops: 2, label: '가볍게', sub: '하루 10문제 · 약 4분' },
  { stops: 4, label: '꾸준히', sub: '하루 20문제 · 약 8분' },
  { stops: 6, label: '열심히', sub: '하루 30문제 · 약 12분' },
  { stops: 10, label: '시험 기간', sub: '하루 50문제 · 약 20분' },
];

export function Onboarding() {
  const snap = useStore();
  const [i, setI] = useState(0);
  const [goal, setGoal] = useState(snap.settings.dailyGoalStops);
  const atGoal = i === SLIDES.length;

  const finish = (then: 'sample' | 'create' | 'home') => {
    updateSettings({ dailyGoalStops: goal });
    setMeta({ onboarded: true });
    if (then === 'sample') {
      const deck = snap.decks.find(d => d.title.includes('샘플')) ?? addSampleDeck();
      navigate({ name: 'home' }, { replace: true });
      startStudy({ mode: 'deck', title: deck.title, deckId: deck.id, stops: 1 });
    } else {
      navigate(then === 'create' ? { name: 'create' } : { name: 'home' }, { replace: true });
    }
  };

  return (
    <div className="screen onboarding">
      <button className="link-btn skip" onClick={() => finish('home')}>건너뛰기</button>
      {!atGoal ? (
        <div className="slide" key={i}>
          <Mascot mood={SLIDES[i].mood} size={150} />
          <h1>{SLIDES[i].title}</h1>
          <p className="muted">{SLIDES[i].body}</p>
          {SLIDES[i].line && (
            <div className="slide-line">
              <SubwayLine stops={4} done={2} partial={3} />
            </div>
          )}
        </div>
      ) : (
        <div className="slide">
          <Mascot mood="happy" size={110} />
          <h1>하루 목표</h1>
          <div className="goal-list" role="radiogroup" aria-label="하루 목표">
            {GOALS.map(g => (
              <button key={g.stops} role="radio" aria-checked={goal === g.stops} className={`goal ${goal === g.stops ? 'on' : ''}`} onClick={() => setGoal(g.stops)}>
                <span className="goal-stops">{g.stops}<small>정거장</small></span>
                <span className="goal-text">
                  <strong>{g.label}</strong>
                  <span className="muted small">{g.sub}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="onboarding-foot">
        {!atGoal ? (
          <>
            <div className="dots" aria-hidden="true">
              {[...SLIDES, null].map((_, k) => <i key={k} className={k === i ? 'on' : ''} />)}
            </div>
            <button className="btn btn-primary btn-block btn-lg" onClick={() => setI(i + 1)}>다음</button>
          </>
        ) : (
          <>
            <button className="btn btn-primary btn-block btn-lg" onClick={() => finish('sample')}>샘플 덱으로 시작</button>
            <button className="btn btn-ghost btn-block" onClick={() => finish('create')}>내 자료로 바로 시작</button>
          </>
        )}
      </div>
    </div>
  );
}
