/** Retrieval smoke test for the assistant knowledge base: in-scope questions must hit the right doc, out-of-scope ones must be refused. */
import { assistantIndex } from '../lib/assistant-kb.js';
const idx = assistantIndex();
let failed = 0;
const qs: Array<[string, string | null]> = [
  ['What certifications does Nikhil have?', 'credentials'],
  ['How many internships has he done?', 'credentials'],
  ['Tell me about TrustGuard AI', 'projects'],
  ['What is NeuroScan AI?', 'projects'],
  ['How does model auto-detection work?', 'about-project'],
  ['How can I contact Nikhil?', 'author'],
  ['Where does he study?', 'author'],
  ['What are his skills?', 'skills'],
  ['Which college does Nikhil attend', 'author'],
  ['Does he know Django?', 'skills'],
  ['What is the default rate limit?', 'gateway-config'],
  ['Tell me about Lexicon Nova', 'projects'],
  ['Does the project use a CNN router?', 'about-project'],
  ['What is the capital of France?', null],
  ['Who won the cricket world cup?', null],
  ['What is his salary expectation?', null],
];
for (const [q, want] of qs) {
  const { grounded, hits } = idx.search(q, 1);
  const h = hits[0];
  const got = grounded ? h.chunk.doc + ':' + h.chunk.id : 'REFUSE';
  const okk = want === null ? !grounded : grounded && h.chunk.doc === want;
  console.log(okk ? 'ok  ' : 'FAIL', q.padEnd(44), got);
  if (!okk) failed++;
}
if (failed) { console.error(`assistant retrieval check FAILED: ${failed}`); process.exit(1); }
console.log(`assistant retrieval OK: ${qs.length} questions`);
