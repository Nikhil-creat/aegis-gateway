import Breadcrumbs from '../components/Breadcrumbs';
import Contact from '../components/Contact';
import NextCards from '../components/NextCards';
import { Chip, Eyebrow, H2, PageHeader, Section } from '../components/ui';
import { ArrowUpRight, Github, Linkedin, Mail, MapPin } from '../icons';
import { SITE } from '../../site.config';

const PROJECTS: Array<[string, string, string]> = [
  ['TrustGuard AI', 'Live AI trust and safety demo.', 'https://trustguard-ai-nikhil.netlify.app'],
  ['NeuroScan AI', 'Mini project on AI-assisted scan analysis.', 'https://github.com/Nikhil-creat/NeuroScan_AI-mini-project-'],
  ['Lexicon Nova', 'A dictionary web app, live on Vercel.', 'https://dictionaryy.vercel.app'],
];

const STATS: Array<[string, string]> = [['100+', 'certificates earned'], ['5+', 'internships completed'], ['Final year', 'B.Tech, Computer Science']];

export default function About() {
  const a = SITE.author;
  return (
    <>
      <PageHeader h1="Built by Nikhil Chary Sriramoju" lede="Final-year Computer Science student in Warangal, Telangana, building AI infrastructure: gateways, retrieval and evaluation, measured end to end.">
        <Breadcrumbs />
      </PageHeader>

      <Section>
        <div className="grid gap-10 lg:grid-cols-3">
          <div className="lg:col-span-2 prose-aegis">
            <Eyebrow>Why this project</Eyebrow>
            <p className="!mt-3">Aegis exists to show how an LLM system is operated, not just called: which model answers, what it cost, what happens when a provider fails, and whether a change made the agent worse. Every claim on this site has a test, a benchmark or a stated limit behind it.</p>
            <p>The Python gateway, the evaluation harness, and this website’s TypeScript playground were designed, written and verified as one project, with a parity test proving the two implementations agree.</p>
            <div className="mt-6 flex flex-wrap gap-2">
              {['Python', 'FastAPI', 'asyncio', 'httpx', 'SQLite', 'Redis', 'Docker', 'GitHub Actions', 'TypeScript', 'React'].map((t) => <Chip key={t}>{t}</Chip>)}
            </div>
          </div>
          <dl className="grid gap-px bg-gray-200 border border-gray-200 self-start">
            {STATS.map(([k, v]) => (
              <div key={v} className="bg-white p-5">
                <dt className="sr-only">{v}</dt>
                <dd className="font-serif text-4xl tracking-tight">{k}</dd>
                <p className="mt-1 text-xs text-ink/55">{v}</p>
              </div>
            ))}
          </dl>
        </div>
      </Section>

      <Section tone="mist">
        <Eyebrow>More work</Eyebrow>
        <H2>Other projects</H2>
        <ul className="mt-8 grid gap-4 md:grid-cols-3">
          {PROJECTS.map(([name, desc, href]) => (
            <li key={name}>
              <a href={href} target="_blank" rel="noopener noreferrer" className="group block h-full border border-gray-200 bg-white p-6 hover:border-ink transition-colors duration-200">
                <p className="flex items-center justify-between font-serif text-2xl tracking-tight">{name} <ArrowUpRight className="w-4 h-4 text-ink/40 group-hover:text-ink" /></p>
                <p className="mt-2 text-sm leading-relaxed text-ink/65">{desc}</p>
              </a>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="contact">
        <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
          <div>
            <Eyebrow>Contact</Eyebrow>
            <H2>Let’s talk</H2>
            <p className="mt-5 max-w-md text-sm leading-relaxed text-ink/65">Open to internships and junior roles in AI, backend and LLM infrastructure. Email is the quickest route.</p>
            <ul className="mt-8 space-y-4 text-sm">
              <li className="flex items-center gap-3"><Mail className="w-4 h-4 text-ink/50" /><a className="underline underline-offset-4" href={`mailto:${a.email}`}>{a.email}</a></li>
              <li className="flex items-center gap-3"><Github className="w-4 h-4 text-ink/50" /><a className="underline underline-offset-4" href={a.github} target="_blank" rel="noopener noreferrer">github.com/Nikhil-creat</a></li>
              <li className="flex items-center gap-3"><Linkedin className="w-4 h-4 text-ink/50" /><a className="underline underline-offset-4" href={a.linkedin} target="_blank" rel="noopener noreferrer">LinkedIn profile</a></li>
              <li className="flex items-center gap-3"><MapPin className="w-4 h-4 text-ink/50" />{a.locality}, {a.region}, India</li>
            </ul>
          </div>
          <Contact />
        </div>
      </Section>

      <NextCards current="/about/" show={['/playground/', '/architecture/', '/benchmarks/']} />
    </>
  );
}
