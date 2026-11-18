// Tried in order; the next model is used when the previous one is overloaded or too slow.
// Pinned fallbacks get retired by Google over time — check the model list if they start returning 404.
const GEMINI_MODELS = ['gemini-flash-latest', 'gemini-3.5-flash', 'gemini-flash-lite-latest', 'gemini-3.5-flash-lite'];
const RETRY_NEXT_STATUS = new Set([404, 429, 500, 503, 504]);
// Vercel functions are capped at 60s (vercel.json); leave room to answer.
const TOTAL_BUDGET_MS = 55_000;
const MIN_ATTEMPT_MS = 6_000;
// Per-attempt caps: slow-but-better models first, then the lite models get the rest of the budget.
const ATTEMPT_CAPS_MS = [20_000, 15_000];

export type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
};

export async function fetchGemini(apiKey: string, body: unknown) {
  const payload = JSON.stringify(body);
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  let last: Response | undefined;

  for (const [i, model] of GEMINI_MODELS.entries()) {
    const remaining = deadline - Date.now();
    if (remaining < MIN_ATTEMPT_MS) break;
    // Don't let a hanging model eat the whole budget.
    const timeout = Math.min(remaining, ATTEMPT_CAPS_MS[i] ?? remaining);
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        signal: AbortSignal.timeout(timeout),
      });
      if (!RETRY_NEXT_STATUS.has(res.status)) return res;
      console.warn(`[gemini] ${model} returned ${res.status}, trying next model`);
      last = res;
    } catch (error) {
      console.warn(`[gemini] ${model} failed (${error instanceof Error ? error.name : 'error'}), trying next model`);
    }
  }

  return last ?? new Response(JSON.stringify({ error: 'AI 응답이 너무 오래 걸려요. 잠시 후 다시 시도해주세요.' }), { status: 504 });
}

export async function readGeminiText(res: Response) {
  const data = (await res.json()) as GeminiResponse;
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const text = parts.filter(p => !p.thought).map(p => p.text ?? '').join('');
  return text || undefined;
}

// A short, user-facing message for a failed upstream call (never the raw provider payload).
export async function upstreamError(res: Response) {
  if (res.status === 429 || res.status === 503 || res.status === 504) return 'AI가 지금 붐벼요. 잠시 후 다시 시도해주세요.';
  try {
    const body = (await res.json()) as { error?: { message?: string } | string };
    const message = typeof body.error === 'string' ? body.error : body.error?.message;
    if (message) return `AI 응답 오류: ${message.slice(0, 160)}`;
  } catch {
    // fall through
  }
  return `AI 응답 오류 (${res.status})`;
}
