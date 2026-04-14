import { buildLivePayload, json } from '../_lib/social.js';

export const runtime = 'nodejs';
export const maxDuration = 20;

export async function GET() {
  try {
    const payload = await buildLivePayload();
    return json(payload);
  } catch (error) {
    return json({ ok: false, error: error?.message || 'Erreur live' }, 500);
  }
}
