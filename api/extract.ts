// Must load before pdf-parse: pdfjs needs DOMMatrix at import time, which this module
// polyfills from @napi-rs/canvas. The static import also makes Vercel bundle the canvas binary.
import { CanvasFactory } from 'pdf-parse/worker';
import { PDFParse } from 'pdf-parse';
import { authenticate } from './_auth.js';
import { fetchGemini, readGeminiText, upstreamError } from './_gemini.js';

type Req = {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: { fileBase64?: unknown; mimeType?: unknown };
};
type Res = { status: (code: number) => Res; json: (body: unknown) => void };

const MIN_CHARS_PER_PAGE = 20;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const PDF_OCR_PROMPT = '이 PDF에 있는 모든 텍스트를 빠짐없이 그대로 추출해줘. 설명이나 요약 없이 원문 텍스트만 출력해.';
const IMAGE_OCR_PROMPT = `이 사진은 학습 자료(강의 슬라이드, 칠판, 필기, 책 페이지 등)입니다.
사진 속 글자를 빠짐없이 읽어서 원문 그대로 텍스트로 옮겨줘. 표는 행 단위로, 도식은 화살표 관계를 "A → B"처럼 글로 풀어줘.
설명이나 요약 없이 추출한 텍스트만 출력해. 글자가 전혀 없으면 빈 문자열만 출력해.`;

async function ocr(apiKey: string, prompt: string, mimeType: string, data: string) {
  const upstream = await fetchGemini(apiKey, {
    contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType, data } }] }],
  });
  if (!upstream.ok) return { ok: false as const, status: upstream.status, error: await upstreamError(upstream) };
  return { ok: true as const, text: (await readGeminiText(upstream))?.trim() ?? '' };
}

export default async function handler(req: Req, res: Res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const auth = await authenticate(req.headers);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'GEMINI_API_KEY가 서버에 설정되지 않았습니다.' });
    return;
  }

  const fileBase64 = req.body?.fileBase64;
  const mimeType = typeof req.body?.mimeType === 'string' ? req.body.mimeType : 'application/pdf';
  if (!fileBase64 || typeof fileBase64 !== 'string') {
    res.status(400).json({ error: 'fileBase64가 필요합니다.' });
    return;
  }

  if (IMAGE_TYPES.has(mimeType)) {
    const result = await ocr(apiKey, IMAGE_OCR_PROMPT, mimeType, fileBase64);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    if (!result.text) {
      res.status(422).json({ error: '사진에서 글자를 찾지 못했어요. 더 가까이, 밝은 곳에서 찍어주세요.' });
      return;
    }
    res.status(200).json({ text: result.text, source: 'image-ocr' });
    return;
  }

  if (mimeType !== 'application/pdf') {
    res.status(400).json({ error: '지원하지 않는 파일 형식입니다.' });
    return;
  }

  const parser = new PDFParse({ data: Buffer.from(fileBase64, 'base64'), CanvasFactory });
  let textResult;
  try {
    textResult = await parser.getText();
  } catch {
    res.status(400).json({ error: 'PDF를 읽을 수 없습니다. 파일이 손상되었거나 지원되지 않는 형식입니다.' });
    return;
  } finally {
    await parser.destroy();
  }

  const avgCharsPerPage = textResult.total > 0 ? textResult.text.length / textResult.total : 0;
  if (avgCharsPerPage >= MIN_CHARS_PER_PAGE) {
    res.status(200).json({ text: textResult.text, source: 'text-layer' });
    return;
  }

  const result = await ocr(apiKey, PDF_OCR_PROMPT, 'application/pdf', fileBase64);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  if (!result.text) {
    res.status(502).json({ error: 'PDF에서 텍스트를 추출하지 못했습니다.' });
    return;
  }
  res.status(200).json({ text: result.text, source: 'ocr' });
}
