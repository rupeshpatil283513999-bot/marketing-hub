// POST /api/interakt-webhook
// Interakt calls this when a WhatsApp template is sent, delivered, read or fails, and when a customer replies.
// Needs INTERAKT_WEBHOOK_SECRET (the secret key entered on the Interakt webhook page).
import { inbox } from '../lib/inbox.mjs';
import { verifyInterakt, interaktEvent } from '../lib/webhooks.mjs';

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  const secret = process.env.INTERAKT_WEBHOOK_SECRET || '';
  if (!secret) return json({ error: 'INTERAKT_WEBHOOK_SECRET is not set.' }, 503);
  const raw = await req.text();
  if (!verifyInterakt(secret, req.headers, raw)) return json({ error: 'Signature did not match.' }, 401);
  let evt; try { evt = JSON.parse(raw); } catch (e) { return json({ error: 'Not valid JSON.' }, 400); }
  const out = interaktEvent(evt);
  if (!out) return json({ ok: true, ignored: evt && evt.type });
  const box = inbox('hub-events');
  if (await box.has(out.id)) return json({ ok: true, added: 0 });
  await box.put(out.id, { ...out, receivedAt: new Date().toISOString() });
  return json({ ok: true, added: 1 });
};

export const config = { path: '/api/interakt-webhook' };
