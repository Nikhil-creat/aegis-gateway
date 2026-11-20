import { HybridIndex } from './engine.js';
import { DEFAULT_CHUNKS } from './kb.js';
import type { KBChunk } from './kb.js';

/**
 * Knowledge base for the "Ask Aegis" assistant: public facts about the author plus the gateway's own docs.
 * One topic per chunk, because the agent cites the single best chunk for each question clause.
 * Keep it factual: the assistant can only be as honest as this file.
 */
export const ASSISTANT_CHUNKS: KBChunk[] = [
  { doc: 'author', id: 'c1', text: 'Education: Nikhil Chary Sriramoju studies as a final-year B.Tech Computer Science and Engineering student at Vaagdevi College of Engineering (2023 to 2027), based in Warangal, Telangana, India.' },
  { doc: 'author', id: 'c2', text: 'Nikhil is open to internships and junior roles in AI, backend, data and LLM infrastructure. The quickest way to reach him is email at sriramojunikhil66@gmail.com, or the contact form on the About page.' },
  { doc: 'author', id: 'c3', text: 'Nikhil links: GitHub is github.com/Nikhil-creat and LinkedIn is in.linkedin.com/in/nikhil-chary-sriramoju-95041b38a.' },
  { doc: 'skills', id: 'c1', text: "Skills overview. Nikhil's technical skills, skill set and tech stack: Python with pandas, SQL, Power BI, Excel, Django, React, FastAPI, and machine learning and deep learning fundamentals. This project adds async Python, httpx, SQLite, Redis, Docker and GitHub Actions." },
  { doc: 'credentials', id: 'c1', text: "Nikhil's certifications: he has earned 100 or more certificates and certifications, including Skill India and NASSCOM, IBM SkillsBuild Artificial Intelligence Fundamentals, UiPath, Reliance Foundation, and many Forage job simulations." },
  { doc: 'credentials', id: 'c2', text: 'Nikhil has completed 5 or more internships and micro-internships, including a Data Analytics Intern role at Thiranex in July and August 2026, and Forage virtual job simulations for Latham and Watkins, Datacom and Clifford Chance.' },
  { doc: 'credentials', id: 'c3', text: 'Forage simulation issuers on his credential list include Deloitte, TATA, BCG Platinion, Skyscanner, Vista, AIG, British Airways, Morrison Foerster and Ashurst, covering cloud, cybersecurity, data, automation and consulting.' },
  { doc: 'projects', id: 'c1', text: 'TrustGuard AI is Nikhil\'s flagship AI and machine learning project combining document and KYC verification, real-time fraud detection, risk case prioritization and MLOps. It is live at trustguard-ai-nikhil.netlify.app.' },
  { doc: 'projects', id: 'c2', text: 'NeuroScan AI is his final-year mini project: an explainable deep learning and retrieval clinical decision support system for multi-class brain MRI diagnosis. The code is at github.com/Nikhil-creat/NeuroScan_AI-mini-project-.' },
  { doc: 'projects', id: 'c3', text: 'Lexicon Nova is an intelligent dictionary platform with agentic AI, retrieval, CNN-based OCR and a Groq and Gemini chatbot. It is live at dictionaryy.vercel.app.' },
  { doc: 'projects', id: 'c4', text: 'DistWorkspace is Nikhil\'s distributed systems project: a real-time collaborative workspace combining CRDT editing, a Raft-based key-value store and a Kafka-style event stream.' },
  { doc: 'projects', id: 'c5', text: 'Other projects by Nikhil include a full-stack task manager with JWT authentication, MongoDB and Socket.io real-time updates, ChurnScope for customer churn prediction, and an AI PDF chatbot using retrieval.' },
  { doc: 'about-project', id: 'c1', text: 'Aegis AI Gateway is Nikhil\'s resume project: a FastAPI LLM gateway that auto-routes between cheap and strong models, fails over across Groq and Gemini, logs cost and latency, and is graded by a 30-task agent evaluation that gates CI.' },
  { doc: 'about-project', id: 'c2', text: 'This assistant is a bounded retrieval agent. It searches a small hand-written knowledge base with BM25 plus trigram vectors, cites its source, and refuses when nothing relevant is found. Answers go through the same gateway: Groq or Gemini when keys are set, a deterministic mock provider otherwise.' },
  { doc: 'about-project', id: 'c4', text: 'The Python gateway has a learned-router policy: a small character-level CNN with about four thousand parameters, written in NumPy, that predicts whether a prompt needs the strong tier. It was trained on synthetic labelled prompts and is a prototype.' },
  { doc: 'about-project', id: 'c3', text: 'Model auto-detection: at startup and every ten minutes the gateway lists the models each provider offers, classifies them into fast and reasoning tiers, and routes to the cheapest healthy one. No model names are hard-coded.' },
];

export const assistantChunks = (): KBChunk[] => [...ASSISTANT_CHUNKS, ...DEFAULT_CHUNKS];
export const assistantIndex = () => new HybridIndex(assistantChunks());

export const SUGGESTED_QUESTIONS = [
  'What certifications does Nikhil have?',
  'Tell me about TrustGuard AI',
  'How does model auto-detection work?',
  'How can I contact Nikhil?',
];
