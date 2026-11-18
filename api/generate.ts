import { authenticate } from './_auth.js';
import { fetchGemini, readGeminiText, upstreamError } from './_gemini.js';
import { buildPrompt, parseGenerateRequest, responseSchema } from './_prompts.js';
import { sanitizeCards, sanitizeEmoji, sanitizeTitle, type GenerateResponse } from '../src/shared/generation.js';

type Req = { method?: string; headers?: Record<string, string | string[] | undefined>; body?: unknown };
type Res = { status: (code: number) => Res; json: (body: unknown) => void };

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

  const parsed = parseGenerateRequest(req.body);
  if (typeof parsed === 'string') {
    res.status(400).json({ error: parsed });
    return;
  }

  const upstream = await fetchGemini(apiKey, {
    contents: [{ role: 'user', parts: [{ text: buildPrompt(parsed) }] }],
    generationConfig: {
      temperature: parsed.mode === 'remix' ? 0.9 : 0.7,
      responseMimeType: 'application/json',
      responseSchema: responseSchema(parsed),
    },
  });

  if (!upstream.ok) {
    res.status(upstream.status).json({ error: await upstreamError(upstream) });
    return;
  }

  const text = await readGeminiText(upstream);
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text ?? '');
  } catch {
    res.status(502).json({ error: 'AI 응답을 해석하지 못했습니다. 다시 시도해주세요.' });
    return;
  }

  const cards = sanitizeCards(raw.cards, parsed.options.types, parsed.avoid);
  if (cards.length === 0) {
    res.status(502).json({ error: '쓸 만한 문제를 만들지 못했습니다. 자료를 조금 더 길게 넣거나 다시 시도해주세요.' });
    return;
  }

  const body: GenerateResponse = {
    cards: cards.slice(0, parsed.options.count),
    ...(parsed.mode === 'deck' ? { title: sanitizeTitle(raw.title), emoji: sanitizeEmoji(raw.emoji) } : {}),
  };
  res.status(200).json(body);
}
