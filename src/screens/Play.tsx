import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCard, getSnapshot, updateCard, useStore } from '../data/store';
import { currentItem, isExam, optionsFor, progressOf, type AnswerOutcome } from '../domain/session';
import type { Card, Grade } from '../domain/types';
import { STOP_SIZE } from '../domain/types';
import { CARD_TYPE_LABELS } from '../shared/generation';
import { relativeDue } from '../domain/time';
import { todayCount } from '../domain/stats';
import {
  answerExam,
  dropCurrent,
  finishNow,
  overrideLast,
  proceed,
  submitAnswer,
  updateSession,
  useSessionState,
} from '../state/sessionStore';
import { maybeAutoRemix } from '../state/remix';
import { useAuthContext } from '../state/auth';
import { navigate } from '../lib/router';
import { cue } from '../lib/feedback';
import { Icon } from '../components/Icon';
import { Mascot } from '../components/Mascot';
import { CardEditor } from '../components/CardEditor';
import { toast } from '../components/Toast';


export function Play() {
  const { active } = useSessionState();
  useStore();

  useEffect(() => {
    if (!active) navigate({ name: 'home' }, { replace: true });
  }, [active]);

  if (!active) return null;
  const item = currentItem(active);
  const card = item ? getCard(item.id) : undefined;
  return <PlayInner key={active.id} cardKey={`${active.step ?? 0}:${item?.id}`} card={card} />;
}

function PlayInner({ card, cardKey }: { card: Card | undefined; cardKey: string }) {
  const { active } = useSessionState();
  const [editing, setEditing] = useState<Card | null>(null);
  const [quitOpen, setQuitOpen] = useState(false);

  // A card deleted on another device (or just now) mid-session: skip it.
  useEffect(() => {
    if (active && !card) {
      if (dropCurrent()) navigate({ name: 'result' }, { replace: true });
    }
  }, [active, card]);

  if (!active || !card) return null;
  const progress = progressOf(active);
  const exam = isExam(active);
  const infinite = progress.total === null;

  const leave = () => {
    // Progress is saved; home shows "이어 타기".
    navigate({ name: 'home' }, { replace: true });
    toast('하차했어요');
  };

  return (
    <div className={`screen play ${exam ? 'play-exam' : ''}`}>
      <header className="play-head">
        <button className="icon-btn" aria-label="하차하기" onClick={() => (active.answers.length || Object.keys(active.examAnswers).length ? setQuitOpen(true) : leave())}>
          <Icon name="close" />
        </button>
        {infinite ? (
          <div className="play-infinite">
            <Icon name="infinity" size={18} />
            <span>{progress.done}문제</span>
          </div>
        ) : (
          <div className="play-progress" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total ?? 0} aria-valuenow={progress.done} aria-label="진행">
            <div className="play-progress-fill" style={{ width: `${((progress.done) / (progress.total || 1)) * 100}%` }} />
            {Array.from({ length: Math.floor(((progress.total ?? 0) - 1) / STOP_SIZE) }, (_, i) => (
              <span key={i} className="play-progress-stop" style={{ left: `${(((i + 1) * STOP_SIZE) / (progress.total || 1)) * 100}%` }} />
            ))}
          </div>
        )}
        {infinite ? (
          <button className="btn btn-sm btn-ghost" onClick={() => finishNow() && navigate({ name: 'result' }, { replace: true })}>
            끝내기
          </button>
        ) : (
          <span className={`combo ${active.combo >= 3 ? 'hot' : ''}`} aria-label={`연속 정답 ${active.combo}`}>
            {active.combo >= 2 ? <><Icon name="flame" size={16} filled /> {active.combo}</> : null}
          </span>
        )}
      </header>

      <CardStage key={cardKey} card={card} exam={exam} onEdit={setEditing} />

      <CardEditor
        card={editing}
        onClose={() => setEditing(null)}
        onRemoved={() => {
          if (dropCurrent()) navigate({ name: 'result' }, { replace: true });
        }}
      />

      {quitOpen && (
        <div className="sheet-root">
          <div className="sheet-backdrop" onClick={() => setQuitOpen(false)} />
          <div className="sheet" role="dialog" aria-modal="true" aria-label="하차할까요?">
            <div className="sheet-grip" aria-hidden="true" />
            <div className="quit">
              <Mascot mood="sad" size={80} />
              <h2 className="sheet-title">하차할까요?</h2>
              <p className="muted">진행 상황은 저장돼요.</p>
              <button className="btn btn-primary btn-block" data-autofocus onClick={() => setQuitOpen(false)}>계속 풀기</button>
              <button className="btn btn-ghost btn-block" onClick={leave}>하차</button>
              {!exam && active.answers.length > 0 && (
                <button className="btn btn-ghost btn-block" onClick={() => finishNow() && navigate({ name: 'result' }, { replace: true })}>
                  끝내고 결과 보기
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type Feedback = { outcome: AnswerOutcome; userAnswer: string; line: string };

function CardStage({ card, exam, onEdit }: { card: Card; exam: boolean; onEdit: (c: Card) => void }) {
  const { active } = useSessionState();
  const auth = useAuthContext();
  const shownAt = useRef(performance.now());
  const [selected, setSelected] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [flipped, setFlipped] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [drag, setDrag] = useState(0);
  const dragStart = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Shuffle multiple-choice options once per card per session (kept across resume).
  const options = useMemo(() => {
    if (!active) return card.options ?? [];
    const r = optionsFor(active, card);
    if (r.session !== active) queueMicrotask(() => updateSession(r.session));
    return r.options;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id]);

  const isRetry = active ? currentItem(active)?.retry : false;
  const reason = active ? currentItem(active)?.reason : undefined;
  const answered = feedback !== null;

  const finishStep = useCallback(() => {
    if (proceed()) navigate({ name: 'result' }, { replace: true });
  }, []);

  const submit = useCallback(
    (input: { userAnswer: string } | { grade: Grade }) => {
      if (answered) return;
      if (exam) {
        const value = 'grade' in input ? input.grade : input.userAnswer;
        if ('userAnswer' in input) setSelected(input.userAnswer);
        // Brief highlight so the tap registers, then move on without revealing the answer.
        setTimeout(() => {
          if (answerExam(card.id, value)) navigate({ name: 'result' }, { replace: true });
        }, 160);
        return;
      }
      const outcome = submitAnswer(card, input, { ms: performance.now() - shownAt.current });
      if (!outcome) return;
      const userAnswer = 'userAnswer' in input ? input.userAnswer : '';
      setFeedback({ outcome, userAnswer, line: outcome.correct ? '정답' : '오답' });
      const count = todayCount(getSnapshot().logs);
      if (count % STOP_SIZE === 0) {
        const goal = getSnapshot().settings.dailyGoalStops * STOP_SIZE;
        toast(count === goal ? '오늘 노선 완주' : `${count / STOP_SIZE}번째 정거장 도착`, { tone: 'good', ms: 1800 });
      }
      if (!outcome.correct) maybeAutoRemix(card, outcome.cardPatch.lapses ?? 0, auth.canGenerate);
    },
    [answered, exam, card, auth.canGenerate],
  );

  const override = () => {
    const outcome = overrideLast();
    if (outcome && feedback) setFeedback({ ...feedback, outcome, line: '정답 처리' });
  };

  // Keyboard: 1–4 options, O/X, Enter submit/continue, Space flip, ←/↓/→ flashcard grades.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        if (e.key === 'Enter' && answered) {
          e.preventDefault();
          finishStep();
        }
        return;
      }
      if (document.body.classList.contains('sheet-open')) return;
      if (answered) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          finishStep();
        }
        return;
      }
      if (card.type === 'multiple_choice') {
        const n = Number(e.key);
        if (n >= 1 && n <= options.length) submit({ userAnswer: options[n - 1] });
      } else if (card.type === 'ox') {
        if (e.key.toLowerCase() === 'o') submit({ userAnswer: 'O' });
        if (e.key.toLowerCase() === 'x') submit({ userAnswer: 'X' });
      } else if (card.type === 'flashcard') {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          setFlipped(f => !f);
        } else if (flipped && e.key === 'ArrowLeft') submit({ grade: 'again' });
        else if (flipped && e.key === 'ArrowDown') submit({ grade: 'hard' });
        else if (flipped && e.key === 'ArrowRight') submit({ grade: 'good' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [answered, card.type, options, flipped, submit, finishStep]);

  // Flashcard swipe: right = 알아요, left = 몰라요 (after flipping).
  const onPointerDown = (e: React.PointerEvent) => {
    if (card.type !== 'flashcard' || answered) return;
    dragStart.current = e.clientX;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (dragStart.current === null || !flipped) return;
    setDrag(e.clientX - dragStart.current);
  };
  const onPointerUp = () => {
    if (dragStart.current === null) return;
    const dx = drag;
    dragStart.current = null;
    setDrag(0);
    if (!flipped) {
      setFlipped(true);
      cue('tap');
      return;
    }
    if (dx > 90) submit({ grade: 'good' });
    else if (dx < -90) submit({ grade: 'again' });
    else if (Math.abs(dx) < 6) setFlipped(f => !f);
  };

  const optionClass = (o: string) => {
    if (exam) return selected === o ? 'opt picked' : 'opt';
    if (!answered) return 'opt';
    if (o === card.answer) return 'opt right';
    if (o === feedback.userAnswer) return 'opt wrong';
    return 'opt dim';
  };

  const toggleStar = () => {
    const now = getCard(card.id);
    updateCard(card.id, { starred: !now?.starred });
    cue('tap');
  };
  const starred = getCard(card.id)?.starred;

  return (
    <>
      <main className={`stage ${answered ? 'stage-answered' : ''}`}>
        <div className="stage-meta">
          {/* One status at most; the answer controls already show the card type. */}
          {isRetry ? (
            <span className="type-badge badge-berry">다시 도전</span>
          ) : card.origin === 'remix' ? (
            <span className="type-badge badge-grape"><Icon name="transfer" size={13} /> 환승 문제</span>
          ) : reason === 'new' ? (
            <span className="type-badge badge-banana">새 카드</span>
          ) : null}
          {card.concept && <span className="concept-tag">{card.concept}</span>}
          <span className="sr-only">{CARD_TYPE_LABELS[card.type]}</span>
        </div>

        {card.type === 'flashcard' ? (
          <div
            className={`flash ${flipped ? 'flipped' : ''}`}
            style={drag ? { transform: `translateX(${drag}px) rotate(${drag / 18}deg)` } : undefined}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => {
              dragStart.current = null;
              setDrag(0);
            }}
            role="button"
            tabIndex={0}
            aria-label={flipped ? `뒷면: ${card.answer}` : `앞면: ${card.question}. 눌러서 뒤집기`}
          >
            <div className="flash-inner">
              <div className="flash-face flash-front">
                <p className="flash-text">{card.question}</p>
                <span className="flash-hint">탭해서 뒤집기</span>
              </div>
              <div className="flash-face flash-back">
                <p className="flash-text small-text">{card.answer}</p>
                {!answered && <span className="flash-hint">← 몰라요 · 알아요 →</span>}
              </div>
            </div>
            {drag > 30 && <span className="swipe-label good">알아요</span>}
            {drag < -30 && <span className="swipe-label bad">몰라요</span>}
          </div>
        ) : (
          <h1 className="question">{card.question}</h1>
        )}
      </main>

      {!answered && (
        <div className="answer-zone">
          {card.type === 'multiple_choice' && (
            <div className="opts">
              {options.map((o, i) => (
                <button key={o} className={optionClass(o)} onClick={() => submit({ userAnswer: o })} disabled={exam && selected !== null}>
                  <span className="opt-key" aria-hidden="true">{i + 1}</span>
                  <span className="opt-text">{o}</span>
                </button>
              ))}
            </div>
          )}

          {card.type === 'ox' && (
            <div className="ox">
              <button className={`ox-btn ox-o ${selected === 'O' ? 'picked' : ''}`} onClick={() => submit({ userAnswer: 'O' })} aria-label="O, 맞다">
                <svg viewBox="0 0 48 48" width="56" height="56" aria-hidden="true"><circle cx="24" cy="24" r="15" fill="none" stroke="currentColor" strokeWidth="6" /></svg>
              </button>
              <button className={`ox-btn ox-x ${selected === 'X' ? 'picked' : ''}`} onClick={() => submit({ userAnswer: 'X' })} aria-label="X, 틀리다">
                <svg viewBox="0 0 48 48" width="56" height="56" aria-hidden="true"><path d="M12 12l24 24M36 12 12 36" stroke="currentColor" strokeWidth="6" strokeLinecap="round" /></svg>
              </button>
            </div>
          )}

          {card.type === 'short_answer' && (
            <form
              className="short"
              onSubmit={e => {
                e.preventDefault();
                if (typed.trim()) submit({ userAnswer: typed });
              }}
            >
              <input
                ref={inputRef}
                autoFocus
                className="short-input"
                value={typed}
                onChange={e => setTyped(e.target.value)}
                placeholder="정답 입력"
                enterKeyHint="done"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                aria-label="정답"
              />
              <div className="row-2">
                <button type="button" className="btn btn-ghost" onClick={() => submit({ userAnswer: '' })}>모르겠어요</button>
                <button type="submit" className="btn btn-primary" disabled={!typed.trim()}>확인</button>
              </div>
            </form>
          )}

          {card.type === 'flashcard' && (
            flipped ? (
              <div className="grades">
                <button className="grade grade-again" onClick={() => submit({ grade: 'again' })}>몰라요</button>
                {!exam && <button className="grade grade-hard" onClick={() => submit({ grade: 'hard' })}>헷갈려요</button>}
                <button className="grade grade-good" onClick={() => submit({ grade: 'good' })}>알아요</button>
              </div>
            ) : (
              <button className="btn btn-choco btn-block btn-lg" onClick={() => setFlipped(true)}>뒤집어서 확인</button>
            )
          )}
        </div>
      )}

      {/* Exam MC/OX show the selection while answers are still on screen */}
      {answered && card.type === 'multiple_choice' && (
        <div className="opts opts-review" aria-hidden="true">
          {options.map((o, i) => (
            <div key={o} className={optionClass(o)}>
              <span className="opt-key">{i + 1}</span>
              <span className="opt-text">{o}</span>
            </div>
          ))}
        </div>
      )}

      {feedback && (
        <section className={`feedback ${feedback.outcome.correct ? 'good' : 'bad'}`} role="status" aria-live="assertive">
          <div className="feedback-head">
            <Mascot mood={feedback.outcome.correct ? (feedback.outcome.comboBonus ? 'cheer' : 'happy') : 'sad'} size={52} />
            <div className="feedback-titles">
              <strong className="feedback-title">{feedback.line}</strong>
              <span className="feedback-xp">
                +{feedback.outcome.xp} XP{feedback.outcome.comboBonus && ` · ${active?.combo ?? 5}연속 정답 보너스`}
                {feedback.outcome.typo && ' · 오타는 정답 처리'}
              </span>
            </div>
            <div className="feedback-tools">
              <button className={`icon-btn ${starred ? 'starred' : ''}`} onClick={toggleStar} aria-pressed={!!starred} aria-label="별표">
                <Icon name="star" filled={starred} />
              </button>
              <button className="icon-btn" onClick={() => onEdit(getCard(card.id) ?? card)} aria-label="이 문제 고치기·숨기기">
                <Icon name="flag" />
              </button>
            </div>
          </div>

          {!feedback.outcome.correct && card.type !== 'flashcard' && (
            <p className="feedback-answer">
              정답 <b>{card.type === 'ox' ? (card.answer === 'O' ? 'O · 맞다' : 'X · 틀리다') : card.answer}</b>
              {feedback.userAnswer && card.type === 'short_answer' && <span className="muted"> · 내 답 {feedback.userAnswer}</span>}
            </p>
          )}
          {card.type === 'flashcard' && !feedback.outcome.correct && <p className="feedback-answer small">{card.answer}</p>}
          {card.explanation && <p className="feedback-explain">{card.explanation}</p>}
          <p className="feedback-next muted small">
            {feedback.outcome.correct
              ? `다음 복습: ${relativeDue(feedback.outcome.cardPatch.due ?? Date.now())}`
              : isRetry
                ? '다음 복습: 내일'
                : '3문제 뒤 다시 출제'}
          </p>

          <div className="feedback-actions">
            {!feedback.outcome.correct && card.type === 'short_answer' && feedback.userAnswer.trim() && (
              <button className="btn btn-ghost" onClick={override}>맞은 걸로 처리</button>
            )}
            <button className={`btn btn-block ${feedback.outcome.correct ? 'btn-primary' : 'btn-berry'}`} data-autofocus autoFocus onClick={finishStep}>
              계속
            </button>
          </div>
        </section>
      )}
    </>
  );
}
