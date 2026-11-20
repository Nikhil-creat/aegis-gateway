import BoomerangVideoBg from '../components/BoomerangVideoBg';
import NextCards from '../components/NextCards';
import { Code, Eyebrow, H2, Section } from '../components/ui';
import { ArrowRight, ArrowUpRight, Github, Shield, Zap, Activity } from '../icons';
import { Link } from '../router';
import { BENCH, pct } from '../data/bench';
import { SITE } from '../../site.config';

const PANEL: Array<[string, string, string]> = [
  ['Routed', 'Scores every prompt and picks the cheapest model that can answer it.', '/playground/'],
  ['Reliable', 'Fails over across Groq and Gemini with backoff, cooldowns and a spend breaker.', '/architecture/'],
  ['Evaluated', 'A fixed 30-task exam gates every change, so claims come with numbers.', '/benchmarks/'],
];

const FLOW: Array<[string, string]> = [
  ['Guard', 'Injection firewall, PII redaction, per-client rate limit and a daily budget check run before any model is called.'],
  ['Route', 'Token length, code, math notation and multi-step cues give a difficulty score. Easy goes to the fast tier, hard to the reasoning tier.'],
  ['Cache', 'Exact SHA-256 match on the redacted prompt and policy. A hit costs nothing and returns in under a millisecond.'],
  ['Call', 'The chosen model is called with a timeout. A 429 or 5xx puts it in cooldown and the next candidate, preferably another provider, takes over.'],
  ['Log', 'Model, tokens, latency, cost, status and trace are written to SQLite for every request, including blocked ones.'],
];

const FEATURES: Array<[string, string, typeof Zap]> = [
  ['Dynamic model discovery', 'Reads each provider’s model list at startup and every ten minutes, then classifies models into fast and reasoning tiers. No model names are hard-coded.', Zap],
  ['Hybrid retrieval', 'BM25 plus hashed character-trigram vectors, fused with reciprocal rank fusion. Below the score threshold the agent refuses instead of guessing.', Activity],
  ['Bounded agent', 'Planner, safe calculator, retrieval and telemetry tools, a verifier and a synthesizer, capped at five steps.', Zap],
  ['Zero-trust input', 'Every prompt is scanned and redacted first. The provider only ever receives the sanitized text.', Shield],
  ['Chaos testing', 'Send X-Chaos-Simulate to force a 429, a timeout or a 500 on the first model and watch failover recover.', Activity],
  ['CI-gated evals', 'The benchmark exits non-zero if pass rate drops more than 10 points or savings fall under 30%.', Shield],
];

export default function Home() {
  const { results, gate } = BENCH;
  return (
    <>
      <section className="relative min-h-[100svh] overflow-hidden border-b border-gray-200">
        <BoomerangVideoBg />
        <div className="relative z-10 mx-auto flex min-h-[100svh] max-w-6xl flex-col justify-center px-4 sm:px-6 md:px-10 pt-28 pb-16">
          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-gray-200 bg-white/80 px-3 py-1.5 text-xs text-ink/70 backdrop-blur">
            <span className="pulse-dot h-2 w-2 rounded-full bg-emerald-500" /> Open source · FastAPI · Groq + Gemini
          </div>
          <h1 className="mt-6 max-w-4xl font-serif text-5xl sm:text-6xl md:text-7xl lg:text-8xl leading-[1.02] tracking-tighter font-normal">Route every request to the right model.</h1>
          <p className="mt-6 max-w-xl text-base md:text-lg leading-relaxed text-ink/70">Aegis is an LLM gateway that auto-routes between cheap and strong models, survives provider failures, logs cost and latency per request, and grades its own agents with a fixed evaluation suite.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/playground/" className="inline-flex items-center gap-2 bg-ink px-6 py-3.5 text-sm font-medium text-white rounded-lg hover:bg-ink/90 transition-colors duration-200">Try the live playground <ArrowRight className="w-4 h-4" /></Link>
            <Link href={SITE.repo} className="inline-flex items-center gap-2 border border-gray-300 bg-white/80 px-6 py-3.5 text-sm font-medium rounded-lg hover:border-ink backdrop-blur transition-colors duration-200"><Github className="w-4 h-4" /> Read the source</Link>
          </div>

          <div className="mt-14 max-w-2xl border border-gray-200 bg-white/90 backdrop-blur">
            <p className="px-5 pt-4 text-[11px] uppercase tracking-[0.2em] text-ink/50 font-medium">What does it do?</p>
            <ul>
              {PANEL.map(([k, v, href]) => (
                <li key={k} className="border-t border-gray-200 first:border-t-0 mt-3 first:mt-1">
                  <Link href={href} className="group flex items-center gap-4 px-5 py-4 hover:bg-mist/70 transition-colors duration-200">
                    <span className="w-24 shrink-0 font-serif text-xl tracking-tight">{k}</span>
                    <span className="flex-1 text-sm leading-relaxed text-ink/65">{v}</span>
                    <ArrowUpRight className="w-4 h-4 shrink-0 text-ink/40 group-hover:text-ink transition-colors duration-200" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <Section>
        <div className="grid gap-10 md:grid-cols-2 md:gap-16">
          <div>
            <Eyebrow>The problem</Eyebrow>
            <H2>One kitchen, two chefs.</H2>
          </div>
          <div className="prose-aegis">
            <p>Picture a restaurant with a line cook and a head chef. Boiling an egg does not need the head chef, and a tasting menu should not go to the line cook. Sending every order to the head chef is safe and expensive; sending every order to the line cook is cheap and sometimes wrong.</p>
            <p>An LLM gateway is the person at the pass who reads each ticket and decides. Aegis adds the rest of a real kitchen: a backup stove when one breaks, a log of every plate, and a taste test that runs before any recipe change goes live.</p>
          </div>
        </div>
      </Section>

      <Section tone="mist" grid>
        <Eyebrow>Measured, not claimed</Eyebrow>
        <H2>What the 30-task exam shows</H2>
        <div className="mt-10 grid gap-px bg-gray-200 border border-gray-200 sm:grid-cols-3">
          {(['always-cheap', 'smart-router', 'always-strong'] as const).map((k) => (
            <div key={k} className="bg-white p-6">
              <p className="font-mono text-xs text-ink/50">{k}</p>
              <p className="mt-3 font-serif text-5xl tracking-tight">{pct(results[k].pass_rate, 0)}</p>
              <p className="mt-1 text-xs text-ink/55">pass rate</p>
              <p className="mt-4 font-mono text-sm">${(results[k].cost_usd * 1000).toFixed(3)} <span className="text-ink/45">per 1k tasks</span></p>
            </div>
          ))}
        </div>
        <p className="mt-6 max-w-3xl text-sm leading-relaxed text-ink/65">
          On the mock provider, smart routing is {pct(gate.cost_savings, 0)} cheaper than always-strong and gives up {Math.round(gate.pass_rate_drop * 100)} points of pass rate. Two multi-hop tasks with no wording cues slip past the router, and that failure is left in on purpose.
          These numbers come from the synthetic mock provider; the benchmark has a <code className="inline">--live</code> mode that produces real Groq and Gemini results.
        </p>
        <Link href="/benchmarks/" className="mt-6 inline-flex items-center gap-2 text-sm font-medium underline underline-offset-4">See per-category results and the method <ArrowRight className="w-4 h-4" /></Link>
      </Section>

      <Section>
        <Eyebrow>Request flow</Eyebrow>
        <H2>Five stages, every request</H2>
        <ol className="mt-10 grid gap-px bg-gray-200 border border-gray-200 md:grid-cols-5">
          {FLOW.map(([k, v], i) => (
            <li key={k} className="bg-white p-5">
              <p className="font-mono text-xs text-ink/40">0{i + 1}</p>
              <p className="mt-3 font-serif text-2xl tracking-tight">{k}</p>
              <p className="mt-3 text-sm leading-relaxed text-ink/65">{v}</p>
            </li>
          ))}
        </ol>
        <Link href="/architecture/" className="mt-6 inline-flex items-center gap-2 text-sm font-medium underline underline-offset-4">Read the design decisions <ArrowRight className="w-4 h-4" /></Link>
      </Section>

      <Section tone="mist">
        <Eyebrow>What is inside</Eyebrow>
        <H2>Built like production, scoped like a project</H2>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(([title, body, Icon]) => (
            <article key={title} className="bg-white border border-gray-200 p-6">
              <Icon className="w-5 h-5 text-ink/70" />
              <h3 className="mt-4 font-serif text-xl tracking-tight">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink/65">{body}</p>
            </article>
          ))}
        </div>
      </Section>

      <Section>
        <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
          <div>
            <Eyebrow>Run it yourself</Eyebrow>
            <H2>Clone, test, benchmark</H2>
            <p className="mt-5 max-w-md text-sm leading-relaxed text-ink/65">No API key is needed: without one the gateway runs on a deterministic mock provider, so tests and the benchmark are repeatable. Add a Groq or Gemini key to go live.</p>
            <Link href="/benchmarks/#reproduce" className="mt-6 inline-flex items-center gap-2 text-sm font-medium underline underline-offset-4">Full reproduction steps <ArrowRight className="w-4 h-4" /></Link>
          </div>
          <Code label="terminal">{`git clone ${SITE.repo}.git
cd aegis-gateway/gateway
pip install -r requirements-dev.txt
pytest -q                          # 76 tests
python -m evals.benchmark          # mock run + CI gate
uvicorn app.main:app --reload      # http://localhost:8000/docs`}</Code>
        </div>
      </Section>

      <NextCards current="/" show={['/playground/', '/security/', '/about/']} />
    </>
  );
}
