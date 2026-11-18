import { normalizeLoose, normalizeOx } from '../shared/generation';
import type { Card } from './types';

export type GradeResult = {
  correct: boolean;
  // Accepted despite a small typo; the UI says so.
  typo?: boolean;
};

function candidates(card: Pick<Card, 'answer' | 'acceptedAnswers'>) {
  const out = new Set<string>();
  for (const value of [card.answer, ...(card.acceptedAnswers ?? [])]) {
    const text = String(value ?? '').trim();
    if (!text) continue;
    out.add(text);
    // "광합성 / photosynthesis" style answers list alternatives in one string.
    text.split(/[\/|·｜,]/).forEach(part => {
      const p = part.trim();
      if (p) out.add(p);
    });
    // "엽록체(chloroplast)" — accept either side of the parenthesis.
    const paren = text.match(/^(.+?)\s*[(（](.+?)[)）]\s*$/);
    if (paren) {
      out.add(paren[1].trim());
      out.add(paren[2].trim());
    }
  }
  return [...out];
}

export function editDistance(a: string, b: string) {
  const x = [...a];
  const y = [...b];
  if (!x.length) return y.length;
  if (!y.length) return x.length;
  let prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= y.length; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[y.length];
}

function typoBudget(length: number) {
  if (length < 4) return 0;
  if (length < 8) return 1;
  return 2;
}

export function gradeAnswer(card: Pick<Card, 'type' | 'answer' | 'acceptedAnswers'>, userAnswer: string): GradeResult {
  const trimmed = userAnswer.trim();
  if (!trimmed) return { correct: false };

  if (card.type === 'ox') return { correct: normalizeOx(trimmed) === normalizeOx(card.answer) };
  if (card.type === 'multiple_choice') return { correct: trimmed === card.answer.trim() };
  if (card.type === 'flashcard') return { correct: trimmed === 'good' };

  const user = normalizeLoose(trimmed);
  if (!user) return { correct: false };
  const norms = candidates(card).map(normalizeLoose).filter(Boolean);
  if (norms.includes(user)) return { correct: true };
  // Numbers (years, counts, formulas) must be exact: 1945 vs 1946 is not a typo.
  const close = norms.some(c => !/\d/.test(c + user) && editDistance(c, user) <= typoBudget(Math.min([...c].length, [...user].length)));
  return close ? { correct: true, typo: true } : { correct: false };
}
