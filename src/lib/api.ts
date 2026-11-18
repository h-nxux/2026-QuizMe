import {
  MAX_CARDS_PER_REQUEST,
  MAX_SOURCE_CHARS_PER_REQUEST,
  MIN_SOURCE_CHARS,
  type GenerateRequest,
  type GenerateResponse,
  type GeneratedCard,
  type GenerationOptions,
  type RemixSeed,
} from '../shared/generation';
import { authHeaders } from './supabase';
import { compressImage, fileToBase64 } from './image';

// The server already falls back across models; one client retry covers transient blips.
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503]);
const RETRY_DELAYS_MS = [2000];

export const MAX_PDF_SIZE_BYTES = 3 * 1024 * 1024;

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function errorFrom(res: Response) {
  if (res.status === 401) return new ApiError('로그인이 필요해요. 다시 로그인해주세요.', 401);
  if (res.status === 413) return new ApiError('파일이 너무 커요.', 413);
  if (res.status === 429 || res.status === 503) return new ApiError('AI가 잠시 바빠요. 조금 뒤에 다시 시도해주세요.', res.status);
  const body = await res.text();
  let message = body.slice(0, 200) || `서버 오류 (${res.status})`;
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed.error === 'string') message = parsed.error;
  } catch {
    // non-JSON body: show it raw
  }
  return new ApiError(message, res.status);
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  let attempt = 0;
  for (;;) {
    let res: Response;
    try {
      res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify(body),
      });
    } catch {
      throw new ApiError('인터넷 연결을 확인해주세요.', 0);
    }
    if (res.ok) return res.json() as Promise<T>;
    if (!RETRYABLE_STATUS_CODES.has(res.status) || attempt >= RETRY_DELAYS_MS.length) throw await errorFrom(res);
    await delay(RETRY_DELAYS_MS[attempt]);
    attempt += 1;
  }
}

export function validateSourceText(sourceText: string) {
  const trimmed = sourceText.trim();
  if (!trimmed) return '학습 자료를 먼저 넣어주세요.';
  if (trimmed.length < MIN_SOURCE_CHARS) return '자료가 너무 짧아요. 한두 문단 이상 넣어주세요.';
  return '';
}

export function splitIntoChunks(text: string, maxChars = MAX_SOURCE_CHARS_PER_REQUEST) {
  const paragraphs = text
    .split(/\n{2,}/)
    .flatMap(p => (p.length > maxChars ? p.match(new RegExp(`[\\s\\S]{1,${maxChars}}`, 'g')) ?? [] : [p]));
  const chunks: string[] = [];
  let current = '';
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 2 > maxChars) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }
  if (current) chunks.push(current);
  return chunks.filter(c => c.trim().length >= MIN_SOURCE_CHARS);
}

export function distributeCount(total: number, parts: number) {
  const base = Math.floor(total / parts);
  const remainder = total % parts;
  return Array.from({ length: parts }, (_, i) => Math.max(base + (i < remainder ? 1 : 0), 1));
}

type Progress = (done: number, total: number) => void;

async function generateFromSource(
  mode: 'deck' | 'more',
  sourceText: string,
  options: GenerationOptions,
  avoid: string[],
  onProgress?: Progress,
): Promise<GenerateResponse> {
  const chunks = splitIntoChunks(sourceText.trim());
  if (!chunks.length) throw new ApiError(validateSourceText(sourceText) || '자료가 너무 짧아요.', 400);
  // Spread the requested count over chunks, but never more chunks than cards.
  const used = chunks.slice(0, Math.max(1, Math.min(chunks.length, options.count)));
  const counts = distributeCount(options.count, used.length);
  let done = 0;
  onProgress?.(0, used.length);
  const results = await Promise.allSettled(
    used.map(async (chunk, i) => {
      const req: GenerateRequest = {
        mode,
        sourceText: chunk,
        options: { ...options, count: Math.min(counts[i], MAX_CARDS_PER_REQUEST) },
        avoid: avoid.slice(-80),
      };
      const res = await postJson<GenerateResponse>('/api/generate', req);
      done += 1;
      onProgress?.(done, used.length);
      return res;
    }),
  );
  const ok = results.filter((r): r is PromiseFulfilledResult<GenerateResponse> => r.status === 'fulfilled').map(r => r.value);
  if (!ok.length) throw (results[0] as PromiseRejectedResult).reason;
  const first = ok[0];
  return { title: first.title, emoji: first.emoji, cards: ok.flatMap(r => r.cards).slice(0, options.count) };
}

export function generateDeck(sourceText: string, options: GenerationOptions, onProgress?: Progress) {
  return generateFromSource('deck', sourceText, options, [], onProgress);
}

export function generateMore(sourceText: string, options: GenerationOptions, existingQuestions: string[], onProgress?: Progress) {
  return generateFromSource('more', sourceText, options, existingQuestions, onProgress);
}

export async function generateRemix(seeds: RemixSeed[], options: GenerationOptions, sourceText: string, avoid: string[]): Promise<GeneratedCard[]> {
  const res = await postJson<GenerateResponse>('/api/generate', {
    mode: 'remix',
    // A slice of the original material keeps variants grounded without blowing the request size.
    sourceText: sourceText.slice(0, 6000),
    options,
    seeds,
    avoid: avoid.slice(-80),
  } satisfies GenerateRequest);
  return res.cards;
}

export type ExtractResult = { text: string; source: 'text-layer' | 'ocr' | 'image-ocr' | 'local' };

export async function extractFile(file: File): Promise<ExtractResult> {
  const name = file.name.toLowerCase();
  if (file.type.startsWith('text/') || /\.(txt|md|markdown|csv)$/.test(name)) {
    return { text: await file.text(), source: 'local' };
  }
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) {
    if (file.size > MAX_PDF_SIZE_BYTES) throw new ApiError('PDF는 3MB까지 올릴 수 있어요. 필요한 페이지만 나눠서 올려주세요.', 413);
    return postJson<ExtractResult>('/api/extract', { fileBase64: await fileToBase64(file), mimeType: 'application/pdf' });
  }
  if (file.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/.test(name)) {
    const image = await compressImage(file);
    return postJson<ExtractResult>('/api/extract', image);
  }
  throw new ApiError('PDF, 사진, 텍스트 파일만 올릴 수 있어요.', 400);
}
