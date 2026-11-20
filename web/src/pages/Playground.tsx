import Breadcrumbs from '../components/Breadcrumbs';
import Gateway from '../components/Gateway';
import NextCards from '../components/NextCards';
import { PageHeader, Section } from '../components/ui';
import { Link } from '../router';

export default function Playground() {
  return (
    <>
      <PageHeader h1="Live gateway playground" lede="Send a prompt and see the decisions behind the answer: difficulty score, chosen model, security verdict, retrieval citations, tool trace, failover attempts and cost.">
        <Breadcrumbs />
      </PageHeader>
      <Section>
        <Gateway />
        <p className="mt-8 max-w-3xl text-sm leading-relaxed text-ink/60">
          This page runs the same routing, retrieval and agent code as the Python gateway, ported to TypeScript and checked against it for identical model, tier, tool and cost on 90 task runs. Without provider keys it uses a synthetic mock provider, so latencies and token counts are simulated. Read how routing works in the <Link href="/architecture/" className="underline underline-offset-4">architecture write-up</Link> or the limits on the <Link href="/security/" className="underline underline-offset-4">security page</Link>.
        </p>
      </Section>
      <NextCards current="/playground/" show={['/architecture/', '/benchmarks/', '/security/']} />
    </>
  );
}
