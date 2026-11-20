import Breadcrumbs from '../components/Breadcrumbs';
import NextCards from '../components/NextCards';
import { pct } from '../data/bench';
import { Code, Eyebrow, H2, PageHeader, Section, Table } from '../components/ui';
import { Link } from '../router';
import study from '../data/router_study.json';

const BOXES: Array<[number, number, string, string]> = [
  [20, 60, 'Client', 'POST /v1/chat'],
  [190, 60, 'Guard', 'inject · PII · rate'],
  [360, 60, 'Router', 'difficulty score'],
  [530, 60, 'Cache', 'SHA-256 exact'],
  [700, 60, 'Providers', 'Groq · Gemini'],
];

function Diagram() {
  return (
    <figure className="border border-gray-200 bg-white p-4 overflow-x-auto">
      <svg viewBox="0 0 860 230" role="img" aria-labelledby="arch-t arch-d" className="w-full min-w-[640px] h-auto">
        <title id="arch-t">Aegis request pipeline</title>
        <desc id="arch-d">A request flows from the client through the guard, router and cache to a provider, with failover back to a second provider and every outcome written to a SQLite request log.</desc>
        <defs>
          <marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#191919" /></marker>
        </defs>
        {BOXES.map(([x, y, t, s], i) => (
          <g key={t}>
            <rect x={x} y={y} width={140} height={64} fill="#fff" stroke="#191919" />
            <text x={x + 70} y={y + 28} textAnchor="middle" fontSize="15" fontWeight="600" fill="#191919">{t}</text>
            <text x={x + 70} y={y + 48} textAnchor="middle" fontSize="11" fill="#666">{s}</text>
            {i < BOXES.length - 1 && <line x1={x + 140} y1={y + 32} x2={x + 190} y2={y + 32} stroke="#191919" markerEnd="url(#ah)" />}
          </g>
        ))}
        <path d="M770 124 V170 H430" fill="none" stroke="#191919" strokeDasharray="5 4" markerEnd="url(#ah)" />
        <text x="600" y="164" textAnchor="middle" fontSize="11" fill="#666">429 / 5xx / timeout: cooldown + next model</text>
        <rect x="20" y="180" width="300" height="36" fill="#f4f3f3" stroke="#d1d5db" />
        <text x="170" y="203" textAnchor="middle" fontSize="12" fill="#191919">SQLite request log: every outcome</text>
        <line x1="170" y1="124" x2="170" y2="180" stroke="#9ca3af" strokeDasharray="3 3" />
      </svg>
      <figcaption className="mt-2 text-xs text-ink/55">Blocked requests stop at the guard and are still logged. Cache hits skip the provider call entirely.</figcaption>
    </figure>
  );
}

const DECISIONS: string[][] = [
  ['Heuristic router, not a model', 'It is explainable in one sentence per request, costs no tokens, and its failures are inspectable. The trade-off is blind spots (see the benchmark). A learned router is the next step once there is labelled traffic.'],
  ['Redact before routing, cache and logging', 'Raw PII never reaches a provider, the cache key or the request log. Cost: regex redaction misses names.'],
  ['Cooldown instead of a circuit-breaker library', 'A model that returned 429 sits out 60 s; 5xx and timeouts sit out 30 s. Simple, observable on the registry, and enough for one process.'],
  ['Full-jitter backoff', 'Sleep is uniform(0, min(8 s, 0.25 s · 2^attempt)). Jitter stops many clients retrying in lockstep.'],
  ['Prefer another provider on first fallback', 'A provider-wide outage is more likely than one bad model, so the first fallback leaves the failing provider.'],
  ['Exact-match cache', 'Semantic caching can return a wrong answer for a near-duplicate prompt. Exact match is safe; semantic similarity is listed as future work.'],
  ['Hybrid retrieval with a refusal threshold', 'BM25 catches exact terms, trigram vectors catch word variants, RRF merges them. Under the threshold the agent says "Insufficient grounded context" and calls no model.'],
  ['Own gateway rather than LiteLLM', 'LiteLLM is the right choice for a production team. Writing the routing, failover, logging and evals by hand is what this project is for, and it makes every decision explainable.'],
];

const ENDPOINTS: string[][] = [
  ['GET /healthz', 'Liveness probe used by the Docker healthcheck.'],
  ['GET /v1/models', 'Discovered models with tier, price, source and health.'],
  ['POST /v1/chat', 'Guard, route, cache, provider call with failover. Accepts a policy and X-Chaos-Simulate.'],
  ['POST /v1/agent/run', 'Bounded agent: plan, tools, verify, synthesize. Returns the full trace.'],
  ['POST /v1/rag/ingest', 'Add a document to the hybrid index.'],
  ['GET /v1/metrics', 'Requests, cache hit rate, blocked, errors, p50/p95 latency, total cost.'],
  ['GET /v1/logs', 'Most recent request log rows.'],
  ['GET /v1/system/limits', 'The known limitations, served by the API itself.'],
];

const QA: Array<[string, string]> = [
  ['How does the router decide?', 'It builds a difficulty score from token length, code, math notation, multi-step wording and a JSON-output constraint, divides by six, and sends anything at or above 0.5 to the reasoning tier. The reasons are returned with every response.'],
  ['How do you evaluate an agent?', 'Three deterministic scorers: correctness of the final answer, trajectory (right tools in the right order) and compliance (no leaked PII, no unsafe output). A task passes only if all three are 1.0. There is no LLM judge, so scores are repeatable.'],
  ['How is cost calculated, and what about timeouts?', 'cost = prompt_tokens/1M · input price + completion_tokens/1M · output price, using the provider’s usage field when present. Saved cost compares against the strongest model for the same token counts. Provider calls time out at 15 s and count as a timeout failure.'],
  ['Why not just use LiteLLM?', 'In production, probably do. Here the goal is to show the mechanics: tier classification, cooldowns, backoff, logging and eval gates, each small enough to read and test.'],
];

export default function Architecture() {
  return (
    <>
      <PageHeader h1="How the gateway decides" lede="The request pipeline, the heuristics behind each decision, the failover rules, the API surface, and why each choice was made over the alternative.">
        <Breadcrumbs />
      </PageHeader>

      <Section>
        <Eyebrow>Pipeline</Eyebrow>
        <H2>From request to logged response</H2>
        <div className="mt-8"><Diagram /></div>
      </Section>

      <Section tone="mist">
        <Eyebrow>Routing</Eyebrow>
        <H2 id="router">The difficulty score</H2>
        <div className="mt-8 grid gap-8 lg:grid-cols-2">
          <Table caption="Router heuristics and the score each adds" head={['Signal', 'Points']} rows={[
            ['Input over ~120 tokens', '+1'],
            ['Input over ~400 tokens', '+2'],
            ['Code content', '+2'],
            ['Mathematical notation', '+1.5'],
            ['Multi-step cues ("first", "then", "compare"…)', '+1.5 each, max +3'],
            ['Structured-output constraint', '+1'],
          ]} />
          <div className="prose-aegis">
            <p>Difficulty is the total divided by six, capped at 1. At 0.5 or above the request goes to the reasoning tier, otherwise to the fast tier. Five policies change what happens next: <code className="inline">smart-router</code>, <code className="inline">always-cheap</code>, <code className="inline">always-strong</code>, <code className="inline">latency-optimized</code> and <code className="inline">privacy-strict</code>, which never leaves the gateway.</p>
            <p>The known weakness is a multi-hop question phrased without cues, such as "Default rate limit? Max agent steps?". It looks short and easy, goes to the fast tier and fails. You can reproduce it in the <Link href="/playground/">playground</Link>, and it is the reason two benchmark tasks fail.</p>
          </div>
        </div>
      </Section>

      <Section>
        <Eyebrow>Learned router</Eyebrow>
        <H2 id="learned-router">A CNN that learned the blind spot</H2>
        <div className="mt-8 grid gap-8 lg:grid-cols-2">
          <div className="prose-aegis">
            <p>The Python gateway also ships a <code className="inline">learned-router</code> policy: a character-level 1-D CNN ({study.params.toLocaleString('en-US')} parameters, written in NumPy with hand-coded backpropagation) that predicts whether a prompt needs the strong tier. It reads raw characters, so it can pick up structure such as several short questions in a row, which the keyword heuristic cannot see.</p>
            <p>It is a prototype. Labels come from a documented definition over synthetic prompts, train and test use disjoint phrase pools, and no benchmark prompt appears in either set. It is available in the Python API only, not in this page&apos;s TypeScript playground.</p>
          </div>
          <div>
            <Table caption="Held-out routing accuracy: heuristic router against the character CNN" head={['Router', 'Accuracy', 'Strong-tier recall']} rows={[
              ['Heuristic', pct(study.heldout.heuristic.accuracy), pct(study.heldout.heuristic.recall_strong)],
              ['Character CNN', pct(study.heldout.cnn.accuracy), pct(study.heldout.cnn.recall_strong)],
            ]} />
            <p className="mt-3 text-xs leading-relaxed text-ink/60">{study.test_n.toLocaleString('en-US')} held-out synthetic prompts. On the 30-task benchmark (mock provider) the CNN policy passes {pct(study.benchmark_learned_router_mock.pass_rate)}, fixing both hidden multi-hop tasks and failing {study.benchmark_learned_router_mock.failed.join(', ')} instead. That run is optimistic: the router was built after the benchmark exposed the weakness. A hybrid of both routers, trained on real traffic, is the next step.</p>
          </div>
        </div>
      </Section>

      <Section tone="mist">
        <Eyebrow>Reliability</Eyebrow>
        <H2>Failover rules</H2>
        <Code label="gateway.chat(): simplified">{`candidates = registry.candidates(tier, policy)   # healthy models only
for attempt in range(max_attempts):              # 4
    model = candidates[attempt]
    try:
        return await provider.call(model, redacted_prompt)
    except ProviderError as e:
        registry.cooldown(model, 60 if e.kind == "rate_limit" else 30)
        await sleep(uniform(0, min(8, 0.25 * 2 ** attempt)))   # full jitter
raise AllProvidersFailed`}</Code>
        <p className="mt-4 text-sm text-ink/60 max-w-3xl">Use <code className="inline">X-Chaos-Simulate: rate_limit | timeout | provider_500</code> to fail the first model on purpose. The playground exposes the same control.</p>
      </Section>

      <Section>
        <Eyebrow>Decisions</Eyebrow>
        <H2>Why it is built this way</H2>
        <div className="mt-8"><Table caption="Design decisions and their trade-offs" head={['Decision', 'Reasoning and trade-off']} rows={DECISIONS} /></div>
      </Section>

      <Section tone="mist">
        <Eyebrow>API</Eyebrow>
        <H2>Endpoints</H2>
        <div className="mt-8"><Table caption="FastAPI endpoints" head={['Endpoint', 'Purpose']} rows={ENDPOINTS.map(([a, b]) => [<code key={a} className="inline">{a}</code>, b])} /></div>
        <p className="mt-4 text-sm text-ink/60">Auth is an optional <code className="inline">X-API-Key</code> compared in constant time. Interactive docs are served at <code className="inline">/docs</code>.</p>
      </Section>

      <Section>
        <Eyebrow>Interview prep</Eyebrow>
        <H2>Questions this project should answer</H2>
        <dl className="mt-8 grid gap-4 md:grid-cols-2">
          {QA.map(([q, a]) => (
            <div key={q} className="border border-gray-200 bg-white p-6">
              <dt className="font-serif text-xl tracking-tight">{q}</dt>
              <dd className="mt-3 text-sm leading-relaxed text-ink/70">{a}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <NextCards current="/architecture/" show={['/playground/', '/benchmarks/', '/security/']} />
    </>
  );
}
