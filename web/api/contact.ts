import type { VercelRequest, VercelResponse } from '@vercel/node';
import { rateLimit } from '../lib/engine.js';
import { clientIp } from './_state.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/**
 * POST /api/contact: validated, rate-limited, delivered through Resend when RESEND_API_KEY and
 * CONTACT_TO_EMAIL are set. Otherwise answers { delivered: false } and the page opens a mailto: link.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  const rl = rateLimit(`contact:${clientIp(req)}`, 3, 10 * 60_000);
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfter));
    return res.status(429).json({ error: 'rate_limited', retryAfter: rl.retryAfter });
  }
  let body: unknown = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'invalid_json' }); }
  }
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.website === 'string' && b.website) return res.status(200).json({ delivered: true }); // honeypot
  const name = String(b.name ?? '').trim().slice(0, 100);
  const email = String(b.email ?? '').trim().slice(0, 200);
  const message = String(b.message ?? '').trim().slice(0, 4000);
  if (name.length < 2 || !EMAIL.test(email) || message.length < 10) return res.status(422).json({ error: 'validation_failed' });

  const key = process.env.RESEND_API_KEY;
  const to = process.env.CONTACT_TO_EMAIL;
  if (!key || !to) return res.status(200).json({ delivered: false });
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.CONTACT_FROM_EMAIL ?? 'Aegis site <onboarding@resend.dev>',
        to: [to],
        reply_to: email,
        subject: `Message from ${name} via the Aegis site`,
        html: `<p><b>${esc(name)}</b> &lt;${esc(email)}&gt;</p><p>${esc(message).replace(/\n/g, '<br>')}</p>`,
      }),
      signal: AbortSignal.timeout(10000),
    });
    return r.ok ? res.status(200).json({ delivered: true }) : res.status(502).json({ error: 'delivery_failed' });
  } catch {
    return res.status(502).json({ error: 'delivery_failed' });
  }
}
