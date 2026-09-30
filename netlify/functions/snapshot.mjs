// POST /api/snapshot
// The app calls this (debounced) whenever its data changes. We keep only the LATEST
// snapshot, which is what the daily digest reads. The app already strips the snapshot
// down to the fields the rules need (no contact details, notes or files).

import { saveSnapshot } from '../lib/store.js';

const MAX_BYTES = 200 * 1024;

function looksLikeSnapshot(s) {
  return s && typeof s === 'object'
    && s.phase1 && typeof s.phase1 === 'object'
    && s.phase4 && typeof s.phase4 === 'object'
    && s.phase5 && typeof s.phase5 === 'object'
    && Array.isArray(s.contentItems)
    && Array.isArray(s.partnerItems);
}

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const raw = await req.text();
  if (raw.length > MAX_BYTES) return json({ error: 'Snapshot too large' }, 413);
  let body;
  try { body = JSON.parse(raw); } catch (e) { return json({ error: 'Not JSON' }, 400); }
  if (!looksLikeSnapshot(body)) return json({ error: 'Not a valid snapshot' }, 400);
  try {
    const savedAt = await saveSnapshot(body);
    return json({ ok: true, savedAt });
  } catch (e) {
    return json({ error: 'Could not save snapshot' }, 500);
  }
};

export const config = { path: '/api/snapshot' };
