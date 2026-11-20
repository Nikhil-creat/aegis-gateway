import Breadcrumbs from '../components/Breadcrumbs';
import NextCards from '../components/NextCards';
import { Eyebrow, H2, PageHeader, Section, Table } from '../components/ui';
import { LIMITS } from '../../lib/engine';

const THREATS: string[][] = [
  ['Prompt injection ("ignore previous instructions")', 'Pattern firewall on every input; the request is refused with status "blocked" before routing and logged.', 'Pattern lists miss novel phrasing. A classifier model would be the next layer.'],
  ['PII sent to a provider', 'Emails, phone numbers, Aadhaar, PAN, SSN and API-key patterns are replaced before routing, caching and logging.', 'Regex only: names and addresses in free text are not detected.'],
  ['Prompt flooding / cost abuse', 'Max prompt length, per-client sliding-window rate limit, and a daily spend circuit breaker that returns 503.', 'Limiter state is per process.'],
  ['Unauthorized API use', 'Optional X-API-Key checked with a constant-time comparison.', 'A single shared key; no per-user quotas or rotation.'],
  ['Secret leakage', 'Provider keys live only in environment variables, are git-ignored, and are never logged or returned.', 'Use a secrets manager in a real deployment.'],
  ['Arbitrary code via the calculator tool', 'Expressions are parsed to an AST and evaluated against an allow-list of operators and functions. There is no eval.', 'Numeric only by design.'],
  ['Fault injection reaching production', 'X-Chaos-Simulate is honoured only when ALLOW_CHAOS is enabled.', 'Leave it off outside demos.'],
];

export default function Security() {
  return (
    <>
      <PageHeader h1="Security model and honest limits" lede="What the gateway defends against, how, and where each defence stops. A control without a stated limit is a claim, so both are listed.">
        <Breadcrumbs />
      </PageHeader>
      <Section>
        <Eyebrow>Threat model</Eyebrow>
        <H2>Defences by threat</H2>
        <div className="mt-8"><Table caption="Threats, controls and their limits" head={['Threat', 'Control', 'Limit']} rows={THREATS} /></div>
      </Section>
      <Section tone="mist">
        <Eyebrow>Limits</Eyebrow>
        <H2>What to harden before real traffic</H2>
        <div className="mt-8"><Table caption="Known limitations and mitigations" head={['Area', 'Limit', 'Mitigation']} rows={LIMITS.map((l) => [l.area, l.limit, l.mitigation])} /></div>
        <p className="mt-6 max-w-3xl text-sm leading-relaxed text-ink/65">Not implemented: a learned (CNN) router, human-in-the-loop approval, streaming responses, idempotency keys and a LangGraph runtime. The agent is a small bounded state machine written for clarity.</p>
      </Section>
      <NextCards current="/security/" show={['/architecture/', '/benchmarks/', '/about/']} />
    </>
  );
}
