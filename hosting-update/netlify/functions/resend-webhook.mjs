// POST /api/resend-webhook
// Resend calls this when an email is delivered, opened, clicked, bounced or marked as spam.
// Needs RESEND_WEBHOOK_SECRET (the signing secret shown on the Resend webhook page).
import { inbox } from '../lib/inbox.mjs';
import { verifyResend, resendEvent } from '../lib/webhooks.mjs';

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  const secret = process.env.RESEND_WEBHOOK_SECRET || '';
  if (!secret) return json({ error: 'RESEND_WEBHOOK_SECRET is not set.' }, 503);
  const raw = await req.text();
  if (!verifyResend(secret, req.headers, raw)) return json({ error: 'Signature did not match.' }, 401);
  let evt; try { evt = JSON.parse(raw); } catch (e) { return json({ error: 'Not valid JSON.' }, 400); }
  const out = resendEvent(evt, req.headers.get('svix-id'));
  if (!out) return json({ ok: true, ignored: evt && evt.type });
  const box = inbox('hub-events');
  if (await box.has(out.id)) return json({ ok: true, added: 0 });
  await box.put(out.id, { ...out, receivedAt: new Date().toISOString() });
  return json({ ok: true, added: 1 });
};

export const config = { path: '/api/resend-webhook' };
