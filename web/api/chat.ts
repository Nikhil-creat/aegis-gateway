import type { VercelRequest, VercelResponse } from '@vercel/node';
import { BudgetExceeded, CHAOS_MODES, InvalidRequest, POLICIES, rateLimit } from '../lib/engine.js';
import { clientIp, getState } from './_state.js';

/** POST /api/chat  { prompt, policy?, mode?: 'chat' | 'agent' | 'assistant', chaos? } -> same shape as the Python /v1/chat and /v1/agent/run. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  const rl = rateLimit(`chat:${clientIp(req)}`, Number(process.env.RATE_LIMIT_RPM ?? 20));
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfter));
    return res.status(429).json({ error: 'rate_limited', retryAfter: rl.retryAfter });
  }

  let body: unknown = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'invalid_json' }); }
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const prompt = typeof b.prompt === 'string' ? b.prompt : '';
  if (b.policy !== undefined && !(POLICIES as readonly string[]).includes(String(b.policy))) return res.status(422).json({ error: 'invalid_request', detail: `unknown policy '${String(b.policy)}'` });
  const policy = b.policy === undefined ? 'smart-router' : String(b.policy);
  const chaos = (CHAOS_MODES as readonly string[]).includes(String(b.chaos)) ? String(b.chaos) : null;

  try {
    const { gateway, agent, assistant } = await getState();
    const out = b.mode === 'assistant' ? await assistant.run(prompt, policy, null)
      : b.mode === 'agent' ? await agent.run(prompt, policy, chaos)
      : await gateway.chat(prompt, policy, chaos);
    res.setHeader('X-Request-ID', out.request_id);
    if (out.status === 'error') return res.status(502).json({ error: 'all_models_failed', detail: out.answer });
    return res.status(200).json(out);
  } catch (e) {
    if (e instanceof BudgetExceeded) return res.status(503).json({ error: 'budget_circuit_open' });
    if (e instanceof InvalidRequest) return res.status(422).json({ error: 'invalid_request', detail: e.message });
    return res.status(500).json({ error: 'gateway_error' });
  }
}
