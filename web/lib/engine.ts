/**
 * Aegis gateway engine, TypeScript port of the Python reference implementation in gateway/app.
 *
 * It powers the live playground (Vercel functions, or in the browser when no API is reachable).
 * The port is held to the Python version by `npm run parity`: all 30 benchmark tasks under all
 * three policies must produce the same model, tier, tools, status and cost as the Python run.
 * Result objects use the same snake_case shape as the Python API.
 */
import { DEFAULT_CHUNKS } from './kb.js';

/* ------------------------------------------------------------------ types */
export const POLICIES = ['smart-router', 'always-cheap', 'always-strong', 'latency-optimized', 'privacy-strict'] as const;
export const CHAOS_MODES = ['rate_limit', 'timeout', 'provider_500'] as const;
export type Policy = (typeof POLICIES)[number];
export type Chaos = (typeof CHAOS_MODES)[number];
export type Tier = 'fast' | 'reasoning';

export interface ModelInfo {
  id: string;
  provider: 'groq' | 'gemini' | 'local';
  tier: Tier;
  context_window: number;
  capabilities: string[];
  in_per_1m: number;
  out_per_1m: number;
  avg_latency_ms: number;
  source: 'live' | 'mock';
}

export interface Attempt {
  model: string;
  provider: string;
  outcome: string;
  backoff_ms: number;
}
export interface TraceStep {
  node: string;
  detail: string;
  ms: number;
}

export interface GatewayResult {
  request_id: string;
  policy: string;
  provider: string;
  model: string;
  tier: Tier;
  route_reason: string;
  confidence: number;
  difficulty: number;
  signals: string[];
  security_flags: string[];
  redactions: number;
  sanitized_prompt: string;
  blocked: boolean;
  status: 'ok' | 'blocked' | 'error';
  answer: string;
  cache_hit: boolean;
  latency_ms: number;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  baseline_cost_usd: number;
  saved_usd: number;
  attempts: Attempt[];
  trace: TraceStep[];
  // agent-only
  tools_used?: string[];
  steps?: number;
  citations?: string[];
  truncated?: boolean;
}

export class ProviderError extends Error {
  constructor(
    public kind: 'rate_limit' | 'timeout' | 'server' | 'client',
    public status = 0,
  ) {
    super(`${kind} (${status})`);
  }
}
export class BudgetExceeded extends Error {}

const newId = (): string =>
  (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`).replace(/-/g, '');
export class InvalidRequest extends Error {}

/* ---------------------------------------------------------------- models */
const PROFILE: Record<string, [number, number, number]> = {
  'groq/fast': [0.06, 0.08, 150],
  'groq/reasoning': [0.59, 0.79, 450],
  'gemini/fast': [0.1, 0.4, 260],
  'gemini/reasoning': [1.25, 10.0, 900],
  'local/fast': [0, 0, 40],
  'local/reasoning': [0, 0, 40],
};

export function makeModel(
  id: string,
  provider: ModelInfo['provider'],
  tier: Tier,
  context_window: number,
  capabilities: string[],
  source: ModelInfo['source'] = 'mock',
): ModelInfo {
  const [i, o, l] = PROFILE[`${provider}/${tier}`];
  return { id, provider, tier, context_window, capabilities, in_per_1m: i, out_per_1m: o, avg_latency_ms: l, source };
}

export const MOCK_MODELS: ModelInfo[] = [
  makeModel('mock-groq-fast-8b', 'groq', 'fast', 131072, ['chat']),
  makeModel('mock-groq-reasoning-70b', 'groq', 'reasoning', 131072, ['chat']),
  makeModel('mock-gemini-flash', 'gemini', 'fast', 1048576, ['chat', 'vision']),
  makeModel('mock-gemini-pro', 'gemini', 'reasoning', 1048576, ['chat', 'vision']),
];
export const LOCAL_MODEL = makeModel('local-deterministic', 'local', 'fast', 8192, ['chat']);

const price = (m: ModelInfo) => m.in_per_1m + m.out_per_1m;
export const modelCost = (m: ModelInfo, pt: number, ct: number) => (pt * m.in_per_1m + ct * m.out_per_1m) / 1_000_000;

export class Registry {
  private cooldown = new Map<string, number>();
  constructor(
    public models: ModelInfo[],
    private clock: () => number = () => Date.now() / 1000,
  ) {}
  markDegraded(id: string, seconds: number) {
    this.cooldown.set(id, this.clock() + seconds);
  }
  cooldownRemaining(id: string) {
    return Math.max(0, Math.floor((this.cooldown.get(id) ?? 0) - this.clock() + 0.999));
  }
  isHealthy(id: string) {
    return this.cooldownRemaining(id) === 0;
  }
  candidates(): ModelInfo[] {
    const chat = this.models.filter((m) => m.capabilities.includes('chat'));
    const healthy = chat.filter((m) => this.isHealthy(m.id));
    return healthy.length ? healthy : chat;
  }
  snapshot() {
    return this.models.map((m) => ({
      ...m,
      health: this.isHealthy(m.id) ? 'healthy' : 'degraded',
      cooldown_s: this.cooldownRemaining(m.id),
    }));
  }
}

/* ------------------------------------------------------------- discovery */
const sizeB = (id: string) => {
  const m = id.toLowerCase().match(/(\d+(?:\.\d+)?)b/);
  return m ? parseFloat(m[1]) : 0;
};

export function classifyGroq(id: string): { tier: Tier; usable: boolean; vision: boolean } {
  const low = id.toLowerCase();
  const usable = !/whisper|tts|playai|orpheus|guard|embed|moderation/.test(low);
  const reasoning = /reason|r1|qwq|gpt-oss-120|maverick|kimi|deepseek|versatile|large/.test(low) || sizeB(low) >= 30;
  return { tier: reasoning ? 'reasoning' : 'fast', usable, vision: /vision|scout|maverick/.test(low) };
}

export function classifyGemini(name: string, methods: string[]) {
  const id = name.replace(/^models\//, '');
  const low = id.toLowerCase();
  const excluded = /tts|image|imagen|veo|live|robotics|audio|aqa|learnlm|gemma/.test(low);
  const chat = methods.includes('generateContent') && low.includes('gemini') && !excluded;
  const tier: Tier = /pro|thinking|ultra/.test(low) ? 'reasoning' : 'fast';
  return { id, chat, embed: methods.includes('embedContent'), tier };
}

const byIdDesc = (a: ModelInfo, b: ModelInfo) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
export function topModels(models: ModelInfo[]): ModelInfo[] {
  const chat = models.filter((m) => m.capabilities.includes('chat'));
  return [
    ...chat.filter((m) => m.tier === 'fast').sort(byIdDesc).slice(0, 3),
    ...chat.filter((m) => m.tier === 'reasoning').sort(byIdDesc).slice(0, 2),
  ];
}

export interface Discovery {
  models: ModelInfo[];
  source: 'live' | 'mock';
  errors: string[];
}

export async function discoverModels(env: Record<string, string | undefined>): Promise<Discovery> {
  const errors: string[] = [];
  const live: ModelInfo[] = [];
  if (env.MOCK_MODE !== 'true') {
    const jobs: Array<Promise<void>> = [];
    if (env.GROQ_API_KEY) {
      jobs.push(
        (async () => {
          const r = await fetch('https://api.groq.com/openai/v1/models', {
            headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` },
            signal: AbortSignal.timeout(6000),
          });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const j = (await r.json()) as { data?: Array<{ id: string; context_window?: number; active?: boolean }> };
          const out: ModelInfo[] = [];
          for (const m of j.data ?? []) {
            if (m.active === false) continue;
            const c = classifyGroq(m.id);
            if (c.usable) out.push(makeModel(m.id, 'groq', c.tier, m.context_window ?? 8192, c.vision ? ['chat', 'vision'] : ['chat'], 'live'));
          }
          live.push(...topModels(out));
        })().catch((e) => void errors.push(`groq: ${e instanceof Error ? e.message : e}`)),
      );
    }
    if (env.GEMINI_API_KEY) {
      jobs.push(
        (async () => {
          const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', {
            headers: { 'x-goog-api-key': env.GEMINI_API_KEY as string },
            signal: AbortSignal.timeout(6000),
          });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const j = (await r.json()) as { models?: Array<{ name: string; inputTokenLimit?: number; supportedGenerationMethods?: string[] }> };
          const out: ModelInfo[] = [];
          for (const m of j.models ?? []) {
            const c = classifyGemini(m.name, m.supportedGenerationMethods ?? []);
            if (c.chat) out.push(makeModel(c.id, 'gemini', c.tier, m.inputTokenLimit ?? 32768, ['chat', 'vision'], 'live'));
          }
          live.push(...topModels(out));
        })().catch((e) => void errors.push(`gemini: ${e instanceof Error ? e.message : e}`)),
      );
    }
    await Promise.all(jobs);
  }
  return live.some((m) => m.capabilities.includes('chat'))
    ? { models: live, source: 'live', errors }
    : { models: [...MOCK_MODELS], source: 'mock', errors };
}

let discoveryCache: { at: number; value: Discovery } | null = null;
export async function discoverCached(env: Record<string, string | undefined>, ttlMs = 300_000): Promise<Discovery> {
  if (discoveryCache && Date.now() - discoveryCache.at < ttlMs) return discoveryCache.value;
  const value = await discoverModels(env);
  discoveryCache = { at: Date.now(), value };
  return value;
}

/* -------------------------------------------------------------- security */
const INJECTION: Array<[RegExp, string]> = [
  [/ignore (?:all |any |the )?(?:previous|prior|above|earlier) (?:instructions?|prompts?|rules)/i, 'instruction-override'],
  [/(?:reveal|show|print|repeat|leak|output).{0,40}(?:system prompt|hidden (?:instructions|prompt)|initial instructions)/i, 'system-prompt-extraction'],
  [/you are now (?:in )?(?:dan|an? (?:unrestricted|unfiltered))|developer mode enabled|\bjailbreak(?:ed)?\b/i, 'role-override'],
  [/disregard (?:your|the|all) (?:rules|guidelines|polic(?:y|ies)|safety)/i, 'policy-bypass'],
  [/<\s*\/?\s*(?:system|assistant)\s*>|\[\s*INST\s*\]/i, 'delimiter-smuggling'],
];
const PII: Array<[RegExp, string, string]> = [
  [/\bgsk_[A-Za-z0-9]{20,}\b/g, 'api_key', '[REDACTED_KEY]'],
  [/\bAIza[0-9A-Za-z_-]{30,}\b/g, 'api_key', '[REDACTED_KEY]'],
  [/\b\d{4}\s?\d{4}\s?\d{4}\b/g, 'aadhaar', '[AADHAAR]'],
  [/\b[A-Z]{5}\d{4}[A-Z]\b/g, 'pan', '[PAN]'],
  [/\b\d{3}-\d{2}-\d{4}\b/g, 'ssn', '[SSN]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, 'email', '[EMAIL]'],
  [/(?:\+91[\s-]?|91[\s-]?)?\b[6-9]\d{9}\b/g, 'phone', '[PHONE]'],
];

export const scanInjection = (text: string) => INJECTION.filter(([re]) => re.test(text)).map(([, l]) => l);

export function redact(text: string): { text: string; flags: string[]; count: number } {
  let out = text;
  let count = 0;
  const flags: string[] = [];
  for (const [re, label, token] of PII) {
    out = out.replace(re, () => {
      count++;
      if (!flags.includes(label)) flags.push(label);
      return token;
    });
  }
  return { text: out, flags, count };
}

/** Sliding-window limiter (in-memory, per function instance). */
const hits = new Map<string, number[]>();
export function rateLimit(key: string, limit: number, windowMs = 60_000): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) {
    hits.set(key, arr);
    return { ok: false, retryAfter: Math.max(1, Math.ceil((windowMs - (now - arr[0])) / 1000)) };
  }
  arr.push(now);
  hits.set(key, arr);
  if (hits.size > 5000) hits.clear();
  return { ok: true, retryAfter: 0 };
}

/* ----------------------------------------------------------------- tools */
export class CalcError extends Error {}
const FUNCS: Record<string, (x: number) => number> = {
  sqrt: Math.sqrt, sin: Math.sin, cos: Math.cos, tan: Math.tan, log: Math.log10, ln: Math.log, abs: Math.abs,
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };
const pyMod = (a: number, b: number) => ((a % b) + b) % b;

/** Recursive-descent arithmetic parser. `^` and `**` are power (right associative). Never uses eval. */
export function safeCalculator(expression: string): number {
  const src = expression.trim();
  if (!src || src.length > 200) throw new CalcError('empty or too long');
  const tokens = src.match(/\d+\.?\d*|\.\d+|[A-Za-z_]+|\*\*|\/\/|[-+*/^%(),]|\S/g) ?? [];
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];
  const num = (n: number) => {
    if (!Number.isFinite(n)) throw new CalcError('non-finite result');
    return n;
  };
  const sum = (): number => {
    let v = term();
    while (peek() === '+' || peek() === '-') v = next() === '+' ? v + term() : v - term();
    return v;
  };
  const term = (): number => {
    let v = unary();
    while (peek() === '*' || peek() === '/' || peek() === '%' || peek() === '//') {
      const op = next();
      const r = unary();
      if ((op === '/' || op === '%' || op === '//') && r === 0) throw new CalcError('ZeroDivisionError');
      v = op === '*' ? v * r : op === '/' ? v / r : op === '%' ? pyMod(v, r) : Math.floor(v / r);
    }
    return v;
  };
  const unary = (): number => {
    if (peek() === '-') { next(); return -unary(); }
    if (peek() === '+') { next(); return unary(); }
    return power();
  };
  const power = (): number => {
    const base = atom();
    if (peek() === '^' || peek() === '**') {
      next();
      const exp = unary();
      if (Math.abs(exp) > 1000) throw new CalcError('exponent too large');
      return num(Math.pow(base, exp));
    }
    return base;
  };
  const atom = (): number => {
    const t = next();
    if (t === undefined) throw new CalcError('unexpected end');
    if (/^[\d.]/.test(t)) return parseFloat(t);
    if (t === '(') {
      const v = sum();
      if (next() !== ')') throw new CalcError('missing )');
      return v;
    }
    if (Object.hasOwn(FUNCS, t)) {
      if (next() !== '(') throw new CalcError('expected (');
      const v = sum();
      if (next() !== ')') throw new CalcError('missing )');
      return num(FUNCS[t](v));
    }
    if (Object.hasOwn(CONSTS, t)) return CONSTS[t];
    throw new CalcError(`disallowed token ${t}`);
  };
  const result = sum();
  if (i < tokens.length) throw new CalcError('trailing tokens');
  return num(result);
}

export function fmtNumber(x: number): string {
  if (x === Math.trunc(x) && Math.abs(x) < 1e15) return String(Math.trunc(x));
  return x.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

const PREFIX = /^\W*(?:first|next|then|please|calculate|compute|evaluate|what(?:'s| is))\b[\s,:]*/i;
const CANDIDATE =
  /(?:\b(?:sqrt|sin|cos|tan|log|ln|abs)\s*\(|[\d.()]|\bpi\b|\be\b|[-+*/^%])(?:[\s\d.()+\-*/^%]|\b(?:sqrt|sin|cos|tan|log|ln|abs)\b|\bpi\b)*/gi;

export function extractMath(clause: string): string | null {
  const text = clause.trim().replace(/[?.!,]+$/, '');
  let stripped = text;
  for (;;) {
    const n = stripped.replace(PREFIX, '');
    if (n === stripped) break;
    stripped = n;
  }
  const found = [...text.matchAll(CANDIDATE)].map((m) => m[0].trim());
  const cands = [...new Set([stripped, ...found].filter(Boolean))].sort((a, b) => b.length - a.length);
  for (const c of cands) {
    if (!/\d/.test(c) || !/[-+*/^%]|sqrt|sin|cos|tan|log|\bln\b|abs/i.test(c)) continue;
    try {
      safeCalculator(c);
    } catch {
      continue;
    }
    return c;
  }
  return null;
}

/* ------------------------------------------------------------- retrieval */
const STOP = new Set('the a an and or of to in is are was for on with by from at as it this that be what which who how did does do his her you your about'.split(' '));
const DIM = 256;
const RRF_K = 60;
const MIN_BM25 = 1.2;
const MIN_COSINE = 0.45;

let crcTable: Uint32Array | null = null;
function crc32(s: string): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  const bytes = new TextEncoder().encode(s);
  for (const b of bytes) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function stem(w: string): string {
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 4 && w.endsWith('sses')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9+#.-]+/g) ?? [])
    .map((w) => w.replace(/^\.+|\.+$/g, ''))
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stem);
}

function embed(text: string): number[] {
  const v = new Array<number>(DIM).fill(0);
  for (const w of tokenize(text)) {
    const p = `^${w}$`;
    for (let i = 0; i < p.length - 2; i++) v[crc32(p.slice(i, i + 3)) % DIM] += 1;
  }
  const norm = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

export interface Chunk { doc: string; id: string; text: string }
export interface Hit { chunk: Chunk; bm25: number; cosine: number; rrf: number }
export const cite = (c: Chunk) => `[${c.doc}:${c.id}]`;

export class HybridIndex {
  chunks: Chunk[] = [];
  private tokens: string[][] = [];
  private vecs: number[][] = [];
  constructor(chunks: Chunk[] = []) {
    chunks.forEach((c) => this.add(c));
  }
  add(c: Chunk) {
    this.chunks.push(c);
    this.tokens.push(tokenize(c.text));
    this.vecs.push(embed(c.text));
  }
  private bm25(query: string): number[] {
    const k1 = 1.5, b = 0.75;
    const n = this.tokens.length;
    const avg = n ? this.tokens.reduce((a, d) => a + d.length, 0) / n : 1;
    const df = new Map<string, number>();
    this.tokens.forEach((d) => new Set(d).forEach((t) => df.set(t, (df.get(t) ?? 0) + 1)));
    return this.tokens.map((d) => {
      const tf = new Map<string, number>();
      d.forEach((t) => tf.set(t, (tf.get(t) ?? 0) + 1));
      let s = 0;
      for (const t of tokenize(query)) {
        const f = tf.get(t) ?? 0;
        if (!f) continue;
        const nt = df.get(t) ?? 0;
        const idf = Math.log(1 + (n - nt + 0.5) / (nt + 0.5));
        s += (idf * (f * (k1 + 1))) / (f + k1 * (1 - b + (b * d.length) / avg));
      }
      return s;
    });
  }
  search(query: string, k = 1): { grounded: boolean; hits: Hit[] } {
    if (!this.chunks.length) return { grounded: false, hits: [] };
    const sparse = this.bm25(query);
    const qv = embed(query);
    const dense = this.vecs.map((v) => v.reduce((a, x, i) => a + x * qv[i], 0));
    const ranks = (s: number[]) => s.map((_, i) => i).sort((a, c) => s[c] - s[a] || a - c);
    const rrf = new Array<number>(this.chunks.length).fill(0);
    for (const order of [ranks(sparse), ranks(dense)]) order.forEach((idx, pos) => (rrf[idx] += 1 / (RRF_K + pos + 1)));
    const hitsOut = ranks(rrf).slice(0, k).map((i) => ({ chunk: this.chunks[i], bm25: sparse[i], cosine: dense[i], rrf: rrf[i] }));
    const grounded = hitsOut.length > 0 && (hitsOut[0].bm25 > MIN_BM25 || hitsOut[0].cosine > MIN_COSINE);
    return { grounded, hits: hitsOut };
  }
}
export const defaultIndex = () => new HybridIndex(DEFAULT_CHUNKS);

/* ---------------------------------------------------------------- router */
const CODE = /```|\b(?:def|class|function|import)\b/;
const MATH = /[∫∑√∂]|\\frac|\b(?:integral|derivative|theorem|prove)\b/i;
const CUES = /\b(?:step[- ]by[- ]step|compare|analy[sz]e|design|architecture|trade-?offs?|why|evaluate|optimi[sz]e|then|after that|first|next|combine|both|derive|explain|which is (?:larger|bigger|greater|higher|smaller))\b/gi;
const JSONC = /json schema|respond (?:only )?in json|strict json/i;

export interface Analysis { difficulty: number; tier: Tier; signals: string[] }
export function analyze(prompt: string): Analysis {
  const signals: string[] = [];
  let score = 0;
  const tokens = Math.floor((prompt.length + 3) / 4);
  if (tokens > 400) { score += 2; signals.push(`long input (~${tokens} tokens)`); }
  else if (tokens > 120) { score += 1; signals.push(`medium input (~${tokens} tokens)`); }
  if (CODE.test(prompt)) { score += 2; signals.push('code content'); }
  if (MATH.test(prompt)) { score += 1.5; signals.push('mathematical notation'); }
  const cues = [...new Set((prompt.match(CUES) ?? []).map((c) => c.toLowerCase()))].sort();
  if (cues.length) { score += Math.min(3, 1.5 * cues.length); signals.push(`${cues.length} multi-step cue(s): ${cues.join(', ')}`); }
  if (JSONC.test(prompt)) { score += 1; signals.push('structured-output constraint'); }
  if (!signals.length) signals.push('short, single-intent prompt');
  const raw = Math.min(1, score / 6);
  return { difficulty: Math.round(raw * 100) / 100, tier: raw >= 0.5 ? 'reasoning' : 'fast', signals };
}

export interface Route { chain: ModelInfo[]; tier: Tier; reason: string; confidence: number; analysis: Analysis }

function buildChain(models: ModelInfo[], tier: Tier, key: (m: ModelInfo) => number): ModelInfo[] {
  const by = (a: ModelInfo, b: ModelInfo) => key(a) - key(b);
  const inTier = models.filter((m) => m.tier === tier).sort(by);
  const head = inTier[0] ?? [...models].sort(by)[0];
  if (!head) return [];
  const sameTier = inTier.slice(1).sort((a, b) => Number(a.provider === head.provider) - Number(b.provider === head.provider));
  const rest = models.filter((m) => m !== head && !sameTier.includes(m)).sort(by);
  return [head, ...sameTier, ...rest];
}

export function planRoute(text: string, policy: string, registry: Registry): Route {
  const a = analyze(text);
  if (policy === 'privacy-strict') {
    return {
      chain: [LOCAL_MODEL], tier: 'fast', confidence: 1, analysis: a,
      reason: 'privacy-strict: prompts never leave the gateway. Redaction is mandatory and the local deterministic model answers instead of an external API.',
    };
  }
  let tier = a.tier;
  if (policy === 'always-cheap' || policy === 'latency-optimized') tier = 'fast';
  else if (policy === 'always-strong') tier = 'reasoning';
  let chain = buildChain(registry.candidates(), tier, policy === 'latency-optimized' ? (m) => m.avg_latency_ms : price);
  if (!chain.length) chain = [LOCAL_MODEL];
  const why = a.signals.join('; ');
  const diff = a.difficulty.toFixed(2);
  if (policy === 'smart-router')
    return { chain, tier, analysis: a, confidence: Math.round((0.5 + Math.abs(a.difficulty - 0.5)) * 100) / 100, reason: `smart-router: difficulty ${diff} (${why}) -> ${tier} tier, cheapest healthy model first.` };
  if (policy === 'always-cheap') return { chain, tier, analysis: a, confidence: 1, reason: `always-cheap pins the fast tier regardless of difficulty (${diff}).` };
  if (policy === 'always-strong') return { chain, tier, analysis: a, confidence: 1, reason: `always-strong pins the reasoning tier regardless of difficulty (${diff}).` };
  return { chain, tier, analysis: a, confidence: 1, reason: 'latency-optimized: fast tier, lowest average latency first.' };
}

/* ------------------------------------------------------------- providers */
const TOOL_MARK = 'TOOL_RESULT:';
const SEP = '\n---\n';
export const buildSynthesisPrompt = (question: string, results: string[]) =>
  `Answer the question using ONLY the tool results below. Keep any [doc:chunk] citations.\nQuestion: ${question}\n${TOOL_MARK}\n${results.join(SEP)}`;

function parseToolResults(prompt: string): string[] {
  const marker = TOOL_MARK + '\n';
  const at = prompt.indexOf(marker);
  if (at < 0) return [];
  return prompt.slice(at + marker.length).split(SEP).map((b) => b.trim()).filter(Boolean);
}

export const estimateTokens = (t: string) => Math.max(1, Math.floor((t.length + 3) / 4));
export interface Completion { text: string; prompt_tokens: number; completion_tokens: number; simulated_latency_ms: number }
export type CallFn = (model: ModelInfo, prompt: string) => Promise<Completion>;

/** Deterministic mock. Fast-tier models report ONE tool result reliably; reasoning-tier models combine several. */
export const mockCall: CallFn = async (model, prompt) => {
  const blocks = parseToolResults(prompt);
  let text: string;
  if (blocks.length) {
    text = blocks.length > 1 && model.tier === 'fast' && model.provider !== 'local' ? 'Unable to combine multiple tool results reliably.' : blocks.join('\n');
  } else {
    const digest = prompt.trim().replace(/\n/g, ' ').slice(0, 110);
    text = `[mock:${model.id}] Deterministic simulated reply. Set GROQ_API_KEY or GEMINI_API_KEY to use a live model. Prompt digest: ${digest}`;
  }
  return { text, prompt_tokens: estimateTokens(prompt), completion_tokens: estimateTokens(text), simulated_latency_ms: model.avg_latency_ms };
};

/* --------------------------------------------------------------- gateway */
const BACKOFF_BASE_S = 0.25;
const BACKOFF_CAP_S = 8;
const RATE_LIMIT_COOLDOWN_S = 60;
const MAX_AGENT_STEPS = 5;
export const REFUSAL = 'Insufficient grounded context';

interface LogRow { status: string; cost_usd: number; cache_hit: boolean; latency_ms: number }

export interface GatewayOptions {
  call?: CallFn;
  cacheEnabled?: boolean;
  cacheTtlMs?: number;
  cooldownS?: number;
  maxAttempts?: number;
  maxPromptChars?: number;
  dailyBudgetUsd?: number;
  allowChaos?: boolean;
  sleep?: (ms: number) => Promise<void>;
  rng?: () => number;
}

export class Gateway {
  log: LogRow[] = [];
  private cache = new Map<string, { at: number; v: Record<string, unknown> }>();
  constructor(public registry: Registry, public opts: GatewayOptions = {}) {}

  private backoff(attempt: number) {
    return (this.opts.rng ?? Math.random)() * Math.min(BACKOFF_CAP_S, BACKOFF_BASE_S * 2 ** attempt);
  }
  private base(policy: string, red: { text: string; count: number }, flags: string[]): GatewayResult {
    return {
      request_id: newId(), policy, provider: 'none', model: '-', tier: 'fast', route_reason: '',
      confidence: 0, difficulty: 0, signals: [], security_flags: flags, redactions: red.count, sanitized_prompt: red.text,
      blocked: false, status: 'ok', answer: '', cache_hit: false, latency_ms: 0, prompt_tokens: 0, completion_tokens: 0,
      cost_usd: 0, baseline_cost_usd: 0, saved_usd: 0, attempts: [], trace: [],
    };
  }
  private record(r: GatewayResult) {
    this.log.push({ status: r.status, cost_usd: r.cost_usd, cache_hit: r.cache_hit, latency_ms: r.latency_ms });
    if (this.log.length > 1000) this.log.shift();
  }
  spendToday() {
    return this.log.reduce((a, r) => a + r.cost_usd, 0);
  }
  summary() {
    const n = this.log.length;
    const lat = this.log.map((r) => r.latency_ms).sort((a, b) => a - b);
    const pct = (p: number) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor(p * lat.length))] : 0);
    return {
      requests: n,
      cache_hit_rate: n ? this.log.filter((r) => r.cache_hit).length / n : 0,
      blocked: this.log.filter((r) => r.status === 'blocked').length,
      errors: this.log.filter((r) => r.status === 'error').length,
      p50_ms: pct(0.5),
      p95_ms: pct(0.95),
      total_cost_usd: this.spendToday(),
    };
  }

  recordLocal(policy: string, prompt: string, reason: string, answer: string): GatewayResult {
    const red = redact(prompt);
    const r = this.base(policy, red, red.flags.map((f) => `pii:${f}`));
    Object.assign(r, { route_reason: reason, answer, model: 'gateway-local' });
    this.record(r);
    return r;
  }

  async chat(prompt: string, policy = 'smart-router', chaosIn?: string | null, routeText?: string): Promise<GatewayResult> {
    const t0 = performance.now();
    const trace: TraceStep[] = [];
    const ms = () => Math.floor(performance.now() - t0);
    const mark = (node: string, detail: string) => void trace.push({ node, detail, ms: ms() });
    const o = this.opts;
    if (!(POLICIES as readonly string[]).includes(policy)) throw new InvalidRequest(`unknown policy '${policy}'`);
    if (!prompt.trim()) throw new InvalidRequest('prompt is empty');
    if (prompt.length > (o.maxPromptChars ?? 8000)) throw new InvalidRequest('prompt too large');
    if (chaosIn && !(CHAOS_MODES as readonly string[]).includes(chaosIn)) throw new InvalidRequest(`unknown chaos mode '${chaosIn}'`);
    const chaos = o.allowChaos === false ? null : chaosIn ?? null;
    if (this.spendToday() >= (o.dailyBudgetUsd ?? Infinity)) throw new BudgetExceeded('daily budget circuit breaker is open');

    const injection = scanInjection(prompt);
    const red = redact(prompt);
    const flags = [...injection.map((f) => `injection:${f}`), ...red.flags.map((f) => `pii:${f}`)];
    const res = this.base(policy, red, flags);
    res.trace = trace;
    mark('security_check', flags.length ? flags.join(', ') : 'clean: no injection or PII patterns');

    if (injection.length) {
      Object.assign(res, {
        blocked: true, status: 'blocked', latency_ms: ms(), answer: `Request blocked: ${injection.join(', ')}.`,
        route_reason: 'Blocked pre-inference by the prompt-injection firewall. No provider was called, so no tokens were spent.',
      });
      this.record(res);
      return res;
    }

    const route = planRoute(routeText ? redact(routeText).text : red.text, policy, this.registry);
    Object.assign(res, { tier: route.tier, route_reason: route.reason, confidence: route.confidence, difficulty: route.analysis.difficulty, signals: route.analysis.signals });
    mark('router', `${policy} -> ${route.chain[0].id} (${route.tier})`);

    const key = `${policy}|${red.text}`;
    const cacheOn = (o.cacheEnabled ?? true) && !chaos;
    if (cacheOn) {
      const hit = this.cache.get(key);
      if (hit && Date.now() - hit.at < (o.cacheTtlMs ?? 300_000)) {
        const v = hit.v as Record<string, never>;
        Object.assign(res, { provider: v.provider, model: v.model, tier: v.tier, answer: v.answer, prompt_tokens: v.prompt_tokens, completion_tokens: v.completion_tokens, baseline_cost_usd: v.baseline_cost_usd });
        Object.assign(res, { cache_hit: true, cost_usd: 0, saved_usd: res.baseline_cost_usd, latency_ms: ms() });
        mark('cache', 'exact SHA-256 hit, provider skipped');
        this.record(res);
        return res;
      }
    }

    const call = o.call ?? mockCall;
    const sleep = o.sleep ?? ((t: number) => new Promise<void>((r) => setTimeout(r, t)));
    let chosen: ModelInfo | null = null;
    let completion: Completion | null = null;
    for (const model of route.chain.slice(0, o.maxAttempts ?? 4)) {
      const n = res.attempts.length;
      if (chaos && n === 0 && model.provider !== 'local') {
        const b = this.backoff(0);
        res.attempts.push({ model: model.id, provider: model.provider, outcome: chaos, backoff_ms: Math.floor(b * 1000) });
        this.registry.markDegraded(model.id, chaos === 'rate_limit' ? RATE_LIMIT_COOLDOWN_S : o.cooldownS ?? 30);
        mark('failover', `${model.id}: simulated ${chaos}; backoff ${Math.floor(b * 1000)}ms`);
        await sleep(Math.min(b * 1000, 400));
        continue;
      }
      try {
        completion = await call(model, red.text);
        res.attempts.push({ model: model.id, provider: model.provider, outcome: 'ok', backoff_ms: 0 });
        chosen = model;
        break;
      } catch (e) {
        const kind = e instanceof ProviderError ? e.kind : (e as Error)?.name === 'TimeoutError' ? 'timeout' : 'server';
        const b = this.backoff(n);
        res.attempts.push({ model: model.id, provider: model.provider, outcome: kind, backoff_ms: Math.floor(b * 1000) });
        this.registry.markDegraded(model.id, kind === 'rate_limit' ? RATE_LIMIT_COOLDOWN_S : o.cooldownS ?? 30);
        mark('failover', `${model.id}: ${kind}; backoff ${Math.floor(b * 1000)}ms`);
        await sleep(Math.min(b * 1000, 400));
      }
    }

    if (!chosen || !completion) {
      Object.assign(res, { status: 'error', answer: 'All candidate models are cooling down or failing. Try again shortly.', latency_ms: ms() });
      this.record(res);
      return res;
    }
    const cands = this.registry.candidates();
    const strongest = (cands.length ? cands : [chosen]).reduce((a, b) => (price(b) > price(a) ? b : a));
    const cost = modelCost(chosen, completion.prompt_tokens, completion.completion_tokens);
    const baseline = modelCost(strongest, completion.prompt_tokens, completion.completion_tokens);
    Object.assign(res, {
      provider: chosen.provider, model: chosen.id, tier: chosen.tier, answer: completion.text,
      prompt_tokens: completion.prompt_tokens, completion_tokens: completion.completion_tokens,
      cost_usd: cost, baseline_cost_usd: baseline, saved_usd: Math.max(0, baseline - cost),
      latency_ms: ms() + completion.simulated_latency_ms,
    });
    mark('provider', `${chosen.id} answered`);
    if (cacheOn) {
      this.cache.set(key, { at: Date.now(), v: { provider: res.provider, model: res.model, tier: res.tier, answer: res.answer, prompt_tokens: res.prompt_tokens, completion_tokens: res.completion_tokens, baseline_cost_usd: res.baseline_cost_usd } });
      if (this.cache.size > 512) this.cache.delete(this.cache.keys().next().value as string);
    }
    this.record(res);
    return res;
  }
}

/* ----------------------------------------------------------------- agent */
const SPLIT = /\s*(?:;|\band then\b|\bthen\b|\band also\b|[.?!](?:\s+|$))\s*/i;
const TELEMETRY = /\b(?:telemetry|live metrics|p50|p95|request log)\b/i;
export interface ToolCall { tool: 'safe_calculator' | 'hybrid_rag_search' | 'gateway_telemetry_tool'; arg: string }

export function planSteps(question: string): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const raw of question.split(SPLIT)) {
    const clause = (raw ?? '').replace(/^[ ,]+|[ ,]+$/g, '');
    if (clause.length < 3) continue;
    const expr = extractMath(clause);
    let call: ToolCall;
    if (expr !== null) call = { tool: 'safe_calculator', arg: expr };
    else if (TELEMETRY.test(clause)) call = { tool: 'gateway_telemetry_tool', arg: clause };
    else if (tokenize(clause).length >= 2) call = { tool: 'hybrid_rag_search', arg: clause };
    else continue;
    const last = calls[calls.length - 1];
    if (!last || last.tool !== call.tool || last.arg !== call.arg) calls.push(call);
  }
  return calls;
}

export class Agent {
  constructor(public gateway: Gateway, public index: HybridIndex, public maxSteps = MAX_AGENT_STEPS) {}

  async run(question: string, policy = 'smart-router', chaos?: string | null): Promise<GatewayResult> {
    const t0 = performance.now();
    const trace: TraceStep[] = [];
    const mark = (node: string, detail: string) => void trace.push({ node, detail, ms: Math.floor(performance.now() - t0) });
    let calls = planSteps(question);
    const truncated = calls.length > this.maxSteps;
    calls = calls.slice(0, this.maxSteps);
    mark('planner', calls.map((c) => c.tool).join(' -> ') || 'no tools needed (answer directly)');

    const finish = (res: GatewayResult, tools: string[], citations: string[]) => {
      res.tools_used = tools;
      res.steps = tools.length;
      res.citations = citations;
      res.truncated = truncated;
      res.trace = [...trace, ...res.trace];
      return res;
    };

    if (scanInjection(question).length) {
      mark('security_check', 'injection detected; no tools executed');
      return finish(await this.gateway.chat(question, policy, chaos), [], []);
    }
    mark('security_check', 'clean');
    if (!calls.length) return finish(await this.gateway.chat(question, policy, chaos), [], []);

    const outputs: string[] = [];
    const tools: string[] = [];
    const citations: string[] = [];
    let anyGrounded = false;
    let ragAttempted = false;
    for (const call of calls) {
      tools.push(call.tool);
      if (call.tool === 'safe_calculator') {
        const v = fmtNumber(safeCalculator(call.arg));
        outputs.push(`${call.arg} = ${v}`);
        anyGrounded = true;
        mark('tool_executor', `safe_calculator(${call.arg}) = ${v}`);
      } else if (call.tool === 'gateway_telemetry_tool') {
        const s = this.gateway.summary();
        outputs.push(`requests=${s.requests}, cache_hit_rate=${s.cache_hit_rate.toFixed(2)}, blocked=${s.blocked}, p50_ms=${s.p50_ms}, p95_ms=${s.p95_ms}, total_cost_usd=${s.total_cost_usd}`);
        anyGrounded = true;
        mark('tool_executor', 'gateway_telemetry_tool -> live metrics');
      } else {
        ragAttempted = true;
        const { grounded, hits: found } = this.index.search(call.arg, 1);
        if (grounded) {
          const h = found[0];
          outputs.push(`${h.chunk.text} ${cite(h.chunk)}`);
          citations.push(cite(h.chunk));
          anyGrounded = true;
          mark('tool_executor', `hybrid_rag_search -> ${cite(h.chunk)} (bm25 ${h.bm25.toFixed(2)}, cos ${h.cosine.toFixed(2)})`);
        } else {
          outputs.push(`${REFUSAL} for: ${call.arg}`);
          mark('tool_executor', `hybrid_rag_search -> below threshold for '${call.arg}'`);
        }
      }
    }
    mark('reflection_verifier', anyGrounded ? 'grounded evidence present' : 'no grounded evidence: refuse to guess');
    if (ragAttempted && !anyGrounded) {
      const res = this.gateway.recordLocal(policy, question, 'agent refused: retrieval below the relevance threshold', `${REFUSAL}. Retrieval scores were below the threshold, so the agent declined to guess.`);
      return finish(res, tools, []);
    }
    const res = await this.gateway.chat(buildSynthesisPrompt(question, outputs), policy, chaos, question);
    mark('final_synthesizer', `${res.model} composed the answer`);
    return finish(res, tools, citations);
  }
}

/* ---------------------------------------------------------------- limits */
export const LIMITS = [
  { area: 'Free-tier quotas', limit: 'Groq and Gemini free keys enforce per-minute request/token ceilings and daily caps that can change without notice.', mitigation: '429 cooldowns, cross-provider failover, per-client rate limit, daily spend circuit breaker.' },
  { area: 'Cache and limiter state', limit: 'The default in-memory cache and rate limiter are per process; replicas do not share them. On Vercel each function instance has its own.', mitigation: 'Set REDIS_URL for a shared cache; move the limiter to Redis before scaling out.' },
  { area: 'SQLite', limit: 'A single writer lock: fine for one gateway process, not for concurrent replicas.', mitigation: 'The schema is plain SQL; migrate to PostgreSQL before horizontal scaling.' },
  { area: 'Mock provider', limit: 'Mock latency, tokens and capability profile are synthetic; list prices are illustrative.', mitigation: 'Run the benchmark with --live for real numbers.' },
  { area: 'Redaction', limit: 'Regex based: no free-text name detection, and some false positives on long digit runs.', mitigation: 'Layer a NER model or a managed DLP service for regulated data.' },
];
