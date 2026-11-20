import type { VercelRequest } from '@vercel/node';
import { Agent, Gateway, MOCK_MODELS, Registry, defaultIndex, discoverCached } from '../lib/engine.js';
import { makeLiveCaller } from '../lib/live.js';

const registry = new Registry([...MOCK_MODELS]);
const gateway = new Gateway(registry);
const agent = new Agent(gateway, defaultIndex());

/** Per-instance singletons. Warm Vercel instances reuse them; cold starts begin empty (documented limitation). */
export async function getState(env: Record<string, string | undefined> = process.env) {
  const d = await discoverCached(env);
  if (registry.models !== d.models) registry.models = d.models; // keeps cooldown state across refreshes
  gateway.opts = {
    call: d.source === 'live' ? makeLiveCaller(env) : undefined,
    maxPromptChars: 2000,
    dailyBudgetUsd: Number(env.DAILY_BUDGET_USD ?? 1),
    allowChaos: env.ALLOW_CHAOS !== 'false',
    cooldownS: 30,
  };
  return { registry, gateway, agent, discovery: d };
}

export function clientIp(req: VercelRequest): string {
  const xf = req.headers['x-forwarded-for'];
  const raw = Array.isArray(xf) ? xf[0] : xf;
  return (raw ?? req.socket?.remoteAddress ?? 'unknown').split(',')[0].trim();
}
