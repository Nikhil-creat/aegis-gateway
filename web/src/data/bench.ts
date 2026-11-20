import report from './benchmark.json';

export interface PolicyResult {
  policy: string;
  pass_rate: number;
  correctness: number;
  trajectory: number;
  compliance: number;
  cost_usd: number;
  latency_p50_ms: number;
  latency_p95_ms: number;
  by_category: Record<string, string>;
  failed: string[];
}
export const BENCH = report as unknown as {
  live: boolean;
  gate: { ok: boolean; pass_rate_drop: number; cost_savings: number; max_drop: number; min_savings: number };
  results: Record<'always-cheap' | 'always-strong' | 'smart-router', PolicyResult>;
};
export const pct = (n: number, d = 1) => `${(n * 100).toFixed(d)}%`;
export const usd = (n: number) => `$${n.toFixed(6)}`;
export const CATEGORIES = ['math', 'rag', 'multi-hop', 'security', 'grounding', 'resilience'] as const;
