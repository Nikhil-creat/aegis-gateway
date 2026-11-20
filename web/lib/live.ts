import { ProviderError, estimateTokens } from './engine.js';
import type { CallFn, Completion } from './engine.js';

function fail(status: number): never {
  throw new ProviderError(status === 429 ? 'rate_limit' : status >= 500 ? 'server' : 'client', status);
}

async function post(url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  let r: Response;
  try {
    r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    const name = (e as Error)?.name;
    throw new ProviderError(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'server', 0);
  }
  if (!r.ok) fail(r.status);
  return r.json();
}

/** Real Groq (OpenAI-compatible) and Gemini callers. Errors carry a kind so the gateway can fail over. */
export function makeLiveCaller(env: Record<string, string | undefined>): CallFn {
  return async (model, prompt): Promise<Completion> => {
    if (model.provider === 'groq' && env.GROQ_API_KEY) {
      const j = (await post(
        'https://api.groq.com/openai/v1/chat/completions',
        { Authorization: `Bearer ${env.GROQ_API_KEY}` },
        { model: model.id, messages: [{ role: 'user', content: prompt }], max_tokens: 400, temperature: 0.2 },
      )) as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      const text = (j.choices?.[0]?.message?.content ?? '').trim();
      return {
        text,
        prompt_tokens: j.usage?.prompt_tokens ?? estimateTokens(prompt),
        completion_tokens: j.usage?.completion_tokens ?? estimateTokens(text),
        simulated_latency_ms: 0,
      };
    }
    if (model.provider === 'gemini' && env.GEMINI_API_KEY) {
      const j = (await post(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model.id)}:generateContent`,
        { 'x-goog-api-key': env.GEMINI_API_KEY },
        { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 400, temperature: 0.2 } },
      )) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      };
      const text = (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim();
      return {
        text,
        prompt_tokens: j.usageMetadata?.promptTokenCount ?? estimateTokens(prompt),
        completion_tokens: j.usageMetadata?.candidatesTokenCount ?? estimateTokens(text),
        simulated_latency_ms: 0,
      };
    }
    throw new ProviderError('client', 401);
  };
}
