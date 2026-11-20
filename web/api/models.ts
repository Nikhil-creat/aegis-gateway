import type { VercelRequest, VercelResponse } from '@vercel/node';
import { LIMITS } from '../lib/engine.js';
import { getState } from './_state.js';

/** GET /api/models -> discovered model registry, health, telemetry and documented limits. */
export default async function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const { registry, gateway, discovery } = await getState();
    return res.status(200).json({
      source: discovery.source,
      errors: discovery.errors,
      models: registry.snapshot(),
      metrics: gateway.summary(),
      limitations: LIMITS,
    });
  } catch {
    return res.status(500).json({ error: 'discovery_failed' });
  }
}
