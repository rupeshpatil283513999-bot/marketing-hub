// POST /api/linkedin-reply
// Zapier sends this when LinkedIn emails you about a reply or an accepted invitation.
// Needs INBOUND_KEY as the x-hub-key header or ?key=. Send subject and from (and, if you can, snippet and the email's message id).
// The hub reads these through /api/hub-events like the Resend and Interakt events.
import { timingSafeEqual } from 'node:crypto';
import { inbox } from '../lib/inbox.mjs';
import { linkedinEvent } from '../lib/webhooks.mjs';

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const same = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  const url = new URL(req.url);
  const key = process.env.INBOUND_KEY || '';
  if (!key) return json({ error: 'INBOUND_KEY is not set.' }, 503);
  const sent = String(req.headers.get('x-hub-key') || url.searchParams.get('key') || '');
  if (!sent || !same(sent, key)) return json({ error: 'Wrong or missing key.' }, 401);
  const raw = await req.text();
  let body = {};
  try { body = JSON.parse(raw); } catch (e) { const o = {}; new URLSearchParams(raw).forEach((v, k) => { o[k] = v; }); body = o; }
  const out = linkedinEvent(body);
  if (!out) return json({ ok: true, ignored: true, reason: 'No person name found in the subject or sender, so nothing was saved.' });
  const box = inbox('hub-events');
  if (await box.has(out.id)) return json({ ok: true, added: 0, duplicate: true });
  await box.put(out.id, { ...out, receivedAt: new Date().toISOString() });
  return json({ ok: true, added: 1, kind: out.kind, name: out.name });
};

export const config = { path: '/api/linkedin-reply' };
