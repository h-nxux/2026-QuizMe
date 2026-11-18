import { useEffect, useState } from 'react';
import type { Card } from '../domain/types';
import { CARD_TYPE_LABELS, normalizeOx } from '../shared/generation';
import { Sheet } from './Sheet';
import { toast } from './Toast';
import { deleteCard, updateCard } from '../data/store';

type Props = { card: Card | null; onClose: () => void; onRemoved?: () => void };

export function CardEditor({ card, onClose, onRemoved }: Props) {
  const [draft, setDraft] = useState<Card | null>(card);
  useEffect(() => setDraft(card), [card]);

  if (!card || !draft) return <Sheet open={false} onClose={onClose}>{null}</Sheet>;

  const set = (patch: Partial<Card>) => setDraft({ ...draft, ...patch });
  const options = draft.options ?? [];

  const save = () => {
    const question = draft.question.trim();
    let answer = draft.answer.trim();
    if (!question || !answer) return toast('문제와 정답을 채워주세요.', { tone: 'error' });
    let opts = draft.options;
    if (draft.type === 'multiple_choice') {
      opts = options.map(o => o.trim()).filter(Boolean);
      if (opts.length < 2) return toast('보기를 2개 이상 넣어주세요.', { tone: 'error' });
      if (!opts.includes(answer)) return toast('정답은 보기 중 하나와 같아야 해요.', { tone: 'error' });
    }
    if (draft.type === 'ox') {
      const ox = normalizeOx(answer);
      if (!ox) return toast('OX 정답은 O 또는 X로 넣어주세요.', { tone: 'error' });
      answer = ox;
    }
    updateCard(card.id, {
      question,
      answer,
      options: opts,
      explanation: draft.explanation?.trim() || undefined,
      concept: draft.concept?.trim() || undefined,
      acceptedAnswers: draft.acceptedAnswers?.map(a => a.trim()).filter(Boolean),
    });
    toast('저장됨', { tone: 'good' });
    onClose();
  };

  const hide = () => {
    updateCard(card.id, { suspended: !card.suspended });
    toast(card.suspended ? '숨김 해제' : '카드를 숨겼어요', card.suspended ? {} : { action: { label: '되돌리기', run: () => updateCard(card.id, { suspended: false }) } });
    onClose();
    if (!card.suspended) onRemoved?.();
  };

  const remove = () => {
    deleteCard(card.id);
    toast('카드를 삭제했어요', { action: { label: '되돌리기', run: () => updateCard(card.id, { deletedAt: undefined }) } });
    onClose();
    onRemoved?.();
  };

  return (
    <Sheet open onClose={onClose} title={`${CARD_TYPE_LABELS[card.type]} 카드 고치기`}>
      <div className="form">
        <label className="field">
          <span>{card.type === 'flashcard' ? '앞면 (용어)' : '문제'}</span>
          <textarea rows={3} value={draft.question} onChange={e => set({ question: e.target.value })} />
        </label>

        {draft.type === 'multiple_choice' && (
          <fieldset className="field">
            <legend>보기 (정답을 눌러 고르세요)</legend>
            {options.map((o, i) => (
              <div key={i} className="option-edit">
                <button
                  type="button"
                  className={`radio ${draft.answer === o && o ? 'on' : ''}`}
                  aria-label={`${i + 1}번을 정답으로`}
                  aria-pressed={draft.answer === o}
                  onClick={() => set({ answer: o })}
                />
                <input
                  value={o}
                  onChange={e => {
                    const next = [...options];
                    const wasAnswer = draft.answer === o;
                    next[i] = e.target.value;
                    set({ options: next, ...(wasAnswer ? { answer: e.target.value } : {}) });
                  }}
                />
              </div>
            ))}
          </fieldset>
        )}

        {draft.type === 'ox' && (
          <div className="field">
            <span>정답</span>
            <div className="seg">
              {['O', 'X'].map(v => (
                <button key={v} type="button" className={draft.answer === v ? 'on' : ''} onClick={() => set({ answer: v })}>{v}</button>
              ))}
            </div>
          </div>
        )}

        {(draft.type === 'short_answer' || draft.type === 'flashcard') && (
          <label className="field">
            <span>{draft.type === 'flashcard' ? '뒷면 (설명)' : '정답'}</span>
            <textarea rows={draft.type === 'flashcard' ? 3 : 1} value={draft.answer} onChange={e => set({ answer: e.target.value })} />
          </label>
        )}

        {draft.type === 'short_answer' && (
          <label className="field">
            <span>다른 정답도 인정 (쉼표로 구분)</span>
            <input
              value={(draft.acceptedAnswers ?? []).join(', ')}
              onChange={e => set({ acceptedAnswers: e.target.value.split(',') })}
            />
          </label>
        )}

        {draft.type !== 'flashcard' && (
          <label className="field">
            <span>해설</span>
            <textarea rows={2} value={draft.explanation ?? ''} onChange={e => set({ explanation: e.target.value })} />
          </label>
        )}

        <label className="field">
          <span>개념</span>
          <input value={draft.concept ?? ''} onChange={e => set({ concept: e.target.value })} placeholder="예: 광합성" />
        </label>

        <button className="btn btn-primary btn-block" onClick={save}>저장</button>
        <div className="row-2">
          <button className="btn btn-ghost" onClick={hide}>{card.suspended ? '다시 나오게' : '안 나오게 숨기기'}</button>
          <button className="btn btn-ghost danger" onClick={remove}>삭제</button>
        </div>
      </div>
    </Sheet>
  );
}
