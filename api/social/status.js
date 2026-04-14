import { buildStatus, json } from '../_lib/social.js';

export const runtime = 'nodejs';
export const maxDuration = 15;

export async function GET() {
  return json(buildStatus());
}
