import { useEffect, useRef, useState } from 'react';
import { TopBar } from '../components/Chrome';
import { Icon } from '../components/Icon';
import { Mascot } from '../components/Mascot';
import { DeckBadge } from '../components/DeckBits';
import { toast } from '../components/Toast';
import { useStore, getDeck } from '../data/store';
import { useAuthContext } from '../state/auth';
import { clearJob, runCreateDeck, setWatched, useJob } from '../state/generation';
import { startStudy } from '../state/derived';
import { extractFile, validateSourceText } from '../lib/api';
import { navigate } from '../lib/router';
import { useOnline } from '../hooks/useOnline';
import {
  CARD_COUNTS,
  CARD_TYPES,
  CARD_TYPE_LABELS,
  DEFAULT_GENERATION_OPTIONS,
  DIFFICULTIES,
  DIFFICULTY_LABELS,
  MAX_SOURCE_CHARS_TOTAL,
  type CardType,
  type GenerationOptions,
} from '../shared/generation';

const DRAFT_KEY = 'quizme-create-draft';

const TYPE_HINTS: Record<CardType, string> = {
  multiple_choice: '보기 넷 중 고르기',
  ox: '맞다 · 틀리다',
  short_answer: '직접 입력 (타이핑)',
  flashcard: '뒤집어서 확인',
};

type Attachment = { id: number; name: string; status: 'loading' | 'done' | 'error'; note?: string };

function readDraft() {
  try {
    return localStorage.getItem(DRAFT_KEY) ?? '';
  } catch {
    return '';
  }
}

export function Create({ sharedText }: { sharedText?: string }) {
  const snap = useStore();
  const auth = useAuthContext();
  const job = useJob();
  const online = useOnline();
  const [step, setStep] = useState<'source' | 'options'>('source');
  const [text, setText] = useState(() => sharedText ?? readDraft());
  const [files, setFiles] = useState<Attachment[]>([]);
  const [options, setOptions] = useState<GenerationOptions>(snap.settings.lastGeneration ?? DEFAULT_GENERATION_OPTIONS);
  const photoInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    setWatched(true);
    return () => {
      setWatched(false);
      clearJob();
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, text);
    } catch {
      // drafts are a convenience
    }
  }, [text]);

  const busy = files.some(f => f.status === 'loading');
  const gate = (reason: string) => {
    if (!auth.canGenerate) {
      auth.requireLogin(reason);
      return false;
    }
    if (!online) {
      toast('오프라인에서는 만들 수 없어요');
      return false;
    }
    return true;
  };

  const addFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    if (!gate('사진·PDF에서 글자를 읽으려면 로그인이 필요해요.')) return;
    const items = [...list].map(file => ({ file, id: (seq.current += 1) }));
    setFiles(prev => [...prev, ...items.map(({ file, id }) => ({ id, name: file.name || '사진', status: 'loading' as const }))]);
    // One at a time keeps each request under the upload limit and preserves page order.
    for (const { file, id } of items) {
      try {
        const res = await extractFile(file);
        setText(prev => (prev.trim() ? `${prev.trim()}\n\n${res.text.trim()}` : res.text.trim()));
        const note = res.source === 'image-ocr' ? '사진 글자 인식' : res.source === 'ocr' ? '스캔 PDF 인식' : res.source === 'local' ? '텍스트' : 'PDF 텍스트';
        setFiles(prev => prev.map(f => (f.id === id ? { ...f, status: 'done', note } : f)));
      } catch (error) {
        setFiles(prev => prev.map(f => (f.id === id ? { ...f, status: 'error', note: error instanceof Error ? error.message : '실패' } : f)));
      }
    }
  };

  const pasteClipboard = async () => {
    try {
      const clip = await navigator.clipboard.readText();
      if (!clip.trim()) return toast('클립보드가 비어 있어요');
      setText(prev => (prev.trim() ? `${prev.trim()}\n\n${clip.trim()}` : clip.trim()));
      toast('붙여넣음', { tone: 'good' });
    } catch {
      toast('클립보드에 접근할 수 없어요. 입력창에 직접 붙여넣어 주세요.');
    }
  };

  const toggleType = (type: CardType) => {
    const on = options.types.includes(type);
    if (on && options.types.length === 1) return;
    setOptions({ ...options, types: on ? options.types.filter(t => t !== type) : CARD_TYPES.filter(t => t === type || options.types.includes(t)) });
  };

  const goOptions = () => {
    const problem = validateSourceText(text);
    if (problem) return toast(problem, { tone: 'error' });
    setStep('options');
  };

  const create = () => {
    if (!gate('AI로 문제를 만들려면 로그인이 필요해요.')) return;
    void runCreateDeck(text.trim().slice(0, MAX_SOURCE_CHARS_TOTAL), options);
  };

  // ---------- generating / done / error ----------
  if (job?.kind === 'deck' && job.status !== 'error') {
    if (job.status === 'done' && job.deckId) {
      const deck = getDeck(job.deckId);
      return (
        <div className="screen create-done">
          <Mascot mood="cheer" size={120} />
          <h1>덱 완성</h1>
          {deck && (
            <div className="done-deck">
              <DeckBadge deck={deck} size={52} />
              <div>
                <strong>{deck.title}</strong>
                <p className="muted small">{job.added}장</p>
              </div>
            </div>
          )}
          <button
            className="btn btn-primary btn-block btn-lg"
            onClick={() => {
              try {
                localStorage.removeItem(DRAFT_KEY);
              } catch {
                // ignore
              }
              startStudy({ mode: 'deck', title: deck?.title ?? '새 덱', deckId: job.deckId, stops: snap.settings.sessionStops });
            }}
          >
            <Icon name="train" /> 바로 출발
          </button>
          <button className="btn btn-ghost btn-block" onClick={() => navigate({ name: 'deck', id: job.deckId! }, { replace: true })}>덱 보기</button>
        </div>
      );
    }
    return <Generating progress={job.progress} startedAt={job.startedAt} />;
  }

  return (
    <div className="screen create">
      <TopBar
        back
        title={step === 'source' ? '자료 넣기' : '문제 설정'}
        actions={<span className="step-dots" aria-label={`2단계 중 ${step === 'source' ? 1 : 2}단계`}><i className="on" /><i className={step === 'options' ? 'on' : ''} /></span>}
      />

      {job?.status === 'error' && (
        <div className="alert alert-error" role="alert">
          <Mascot mood="sad" size={40} />
          <span>{job.error}</span>
          <button className="btn btn-sm btn-ghost" onClick={() => { clearJob(); create(); }}>다시 시도</button>
        </div>
      )}

      {step === 'source' ? (
        <>
          <div className="source-grid">
            <button className="source-btn" onClick={() => photoInput.current?.click()} disabled={busy}>
              <Icon name="camera" size={26} />
              <span>사진 찍기</span>
            </button>
            <button className="source-btn" onClick={() => fileInput.current?.click()} disabled={busy}>
              <Icon name="file" size={26} />
              <span>PDF·파일</span>
            </button>
            <button className="source-btn" onClick={() => void pasteClipboard()}>
              <Icon name="clipboard" size={26} />
              <span>붙여넣기</span>
            </button>
          </div>
          <input ref={photoInput} type="file" accept="image/*" capture="environment" multiple hidden onChange={e => { void addFiles(e.target.files); e.target.value = ''; }} />
          <input ref={fileInput} type="file" accept="application/pdf,image/*,.txt,.md,text/plain" multiple hidden onChange={e => { void addFiles(e.target.files); e.target.value = ''; }} />

          {files.length > 0 && (
            <ul className="attachments">
              {files.map(f => (
                <li key={f.id} className={`attachment ${f.status}`}>
                  <span className="attachment-icon" aria-hidden="true">{f.status === 'loading' ? <span className="spinner" /> : f.status === 'done' ? '✓' : '!'}</span>
                  <span className="attachment-name">{f.name}</span>
                  <span className="attachment-note">{f.status === 'loading' ? '읽는 중…' : f.note}</span>
                </li>
              ))}
            </ul>
          )}

          <label className="source-text">
            <span className="sr-only">학습 자료</span>
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="학습 자료를 붙여넣거나 입력하세요"
            />
          </label>
          <div className="source-foot">
            <span className={`muted small ${text.length > MAX_SOURCE_CHARS_TOTAL ? 'danger-text' : ''}`}>
              {text.trim().length.toLocaleString()}자{text.length > MAX_SOURCE_CHARS_TOTAL && ` · ${MAX_SOURCE_CHARS_TOTAL.toLocaleString()}자까지만 사용돼요`}
            </span>
            {text && <button className="link-btn" onClick={() => { setText(''); setFiles([]); }}>지우기</button>}
          </div>

          <div className="bottom-cta">
            <button className="btn btn-primary btn-block btn-lg" onClick={goOptions} disabled={busy || !text.trim()}>
              {busy ? '읽는 중…' : '다음'}
            </button>
          </div>
        </>
      ) : (
        <>
          <section className="opt-section">
            <h2 className="opt-title">문제 유형</h2>
            <div className="type-grid">
              {CARD_TYPES.map(t => (
                <button key={t} className={`type-chip ${options.types.includes(t) ? 'on' : ''}`} aria-pressed={options.types.includes(t)} onClick={() => toggleType(t)}>
                  <span className="type-chip-check" aria-hidden="true">{options.types.includes(t) && <Icon name="check" size={14} />}</span>
                  <span className="type-chip-text">
                    {CARD_TYPE_LABELS[t]}
                    <small>{TYPE_HINTS[t]}</small>
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="opt-section">
            <h2 className="opt-title">카드 수</h2>
            <div className="seg seg-lg">
              {CARD_COUNTS.map(n => (
                <button key={n} className={options.count === n ? 'on' : ''} aria-pressed={options.count === n} onClick={() => setOptions({ ...options, count: n })}>
                  {n}장 <small>{n / 5}정거장</small>
                </button>
              ))}
            </div>
          </section>

          <section className="opt-section">
            <h2 className="opt-title">난이도</h2>
            <div className="seg seg-lg">
              {DIFFICULTIES.map(d => (
                <button key={d} className={options.difficulty === d ? 'on' : ''} aria-pressed={options.difficulty === d} onClick={() => setOptions({ ...options, difficulty: d })}>
                  {DIFFICULTY_LABELS[d]}
                </button>
              ))}
            </div>
          </section>

          <div className="bottom-cta">
            <button className="btn btn-ghost" onClick={() => setStep('source')}>이전</button>
            <button className="btn btn-primary btn-lg grow" onClick={create}>
              덱 만들기
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Generating({ progress, startedAt }: { progress: { done: number; total: number }; startedAt: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const s = setInterval(() => tick(x => x + 1), 500);
    return () => clearInterval(s);
  }, []);
  const elapsed = (Date.now() - startedAt) / 1000;
  // Each chunk takes ~10–20s; ease toward 95% while waiting so the bar never looks stuck.
  const pct = Math.min(95, ((progress.done + 1 - Math.exp(-elapsed / 12)) / Math.max(progress.total, 1)) * 100);
  const hasCards = useStore().cards.length > 0;

  return (
    <div className="screen generating">
      <div className="gen-mascot">
        <Mascot mood="think" size={130} />
        <span className="gen-dots" aria-hidden="true"><i /><i /><i /></span>
      </div>
      <h1>문제 만드는 중</h1>
      <p className="muted">{progress.total > 1 ? `${progress.done} / ${progress.total} 구간` : '약 10~30초'}</p>
      <div className="gen-bar" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${pct}%` }} />
      </div>
      {hasCards && (
        <button className="btn btn-ghost btn-block" onClick={() => startStudy({ mode: 'review', title: '기다리는 동안 한 정거장', stops: 1 })}>
          기다리는 동안 복습
        </button>
      )}
    </div>
  );
}
