import { Agent, Gateway, InvalidRequest, LIMITS, MOCK_MODELS, Registry, defaultIndex } from '../../lib/engine';
import type { GatewayResult } from '../../lib/engine';

export interface ModelRow {
  id: string;
  provider: string;
  tier: string;
  context_window: number;
  capabilities: string[];
  in_per_1m: number;
  out_per_1m: number;
  source: string;
  health: string;
  cooldown_s: number;
}
export interface Metrics {
  requests: number;
  cache_hit_rate: number;
  blocked: number;
  errors: number;
  p50_ms: number;
  p95_ms: number;
  total_cost_usd: number;
}
export interface RegistryView {
  source: string;
  errors: string[];
  models: ModelRow[];
  metrics: Metrics;
  limitations: Array<{ area: string; limit: string; mitigation: string }>;
  via: 'api' | 'browser';
}
export interface RunRequest {
  prompt: string;
  policy: string;
  mode: 'chat' | 'agent';
  chaos: string | null;
}
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// Browser-side engine: the same TypeScript port the serverless functions use. Used when /api is unreachable.
let local: { gateway: Gateway; agent: Agent; registry: Registry } | null = null;
function localEngine() {
  if (!local) {
    const registry = new Registry([...MOCK_MODELS]);
    const gateway = new Gateway(registry, { maxPromptChars: 2000 });
    local = { registry, gateway, agent: new Agent(gateway, defaultIndex()) };
  }
  return local;
}

const isJson = (r: Response) => (r.headers.get('content-type') ?? '').includes('json');

export async function fetchRegistry(): Promise<RegistryView> {
  try {
    const r = await fetch('/api/models', { signal: AbortSignal.timeout(6000) });
    if (!r.ok || !isJson(r)) throw new Error('api unavailable');
    return { ...(await r.json()), via: 'api' } as RegistryView;
  } catch {
    const e = localEngine();
    return { source: 'mock', errors: [], models: e.registry.snapshot() as ModelRow[], metrics: e.gateway.summary(), limitations: LIMITS, via: 'browser' };
  }
}

export async function run(req: RunRequest): Promise<{ res: GatewayResult; via: 'api' | 'browser' }> {
  try {
    const r = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(25000),
    });
    if (isJson(r)) {
      const j = await r.json();
      if (r.ok) return { res: j as GatewayResult, via: 'api' };
      throw new ApiError(r.status, String(j.error ?? 'request failed'));
    }
    throw new Error('api unavailable');
  } catch (e) {
    if (e instanceof ApiError) throw e;
    const { gateway, agent } = localEngine();
    try {
      const res = req.mode === 'agent' ? await agent.run(req.prompt, req.policy, req.chaos) : await gateway.chat(req.prompt, req.policy, req.chaos);
      return { res, via: 'browser' };
    } catch (err) {
      if (err instanceof InvalidRequest) throw new ApiError(422, err.message);
      throw err;
    }
  }
}
