// Lead inbox for Instagram comment leads (Interakt, ManyChat or Zapier).
//   POST /api/instagram-leads        from Zapier or ManyChat. Needs INBOUND_KEY as the x-hub-key header or ?key=.
//   GET  /api/instagram-leads        the hub reads waiting leads. Needs the hub access code.
//   POST /api/instagram-leads {ack}  the hub marks leads as imported. Needs the hub access code.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { gate } from '../lib/gate.mjs';
import { inbox } from '../lib/inbox.mjs';

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const clean = (v, n) => String(v === undefined || v === null ? '' : v).trim().slice(0, n || 200);
const handleOf = (v) => clean(v).replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/[/?#].*$/, '').replace(/^@+/, '').toLowerCase();
const same = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };

export default async (req) => {
  const url = new URL(req.url);
  const box = inbox('instagram-leads');
  if (req.method === 'GET') {
    const blocked = gate(req.headers); if (blocked) return blocked;
    return json({ leads: (await box.list()).sort((a, b) => String(a.receivedAt).localeCompare(String(b.receivedAt))) });
  }
  if (req.method !== 'POST') return json({ error: 'Use GET or POST.' }, 405);

  const raw = await req.text();
  let body = {};
  try { body = JSON.parse(raw); } catch (e) { const o = {}; new URLSearchParams(raw).forEach((v, k) => { o[k] = v; }); body = o; }

  if (Array.isArray(body.ack)) {
    const blocked = gate(req.headers); if (blocked) return blocked;
    for (const id of body.ack.slice(0, 1000)) await box.remove(id);
    return json({ ok: true });
  }

  const key = process.env.INBOUND_KEY || '';
  if (!key) return json({ error: 'INBOUND_KEY is not set.' }, 503);
  const sent = String(req.headers.get('x-hub-key') || url.searchParams.get('key') || '');
  if (!sent || !same(sent, key)) return json({ error: 'Wrong or missing key.' }, 401);

  const items = Array.isArray(body.leads) ? body.leads : [body];
  const have = await box.list();
  let added = 0;
  for (const x of items) {
    if (!x || typeof x !== 'object') continue;
    const handle = handleOf(x.handle || x.username || x.instagram || x.ig_username || x.instagram_username);
    const email = clean(x.email).toLowerCase();
    const phone = clean(x.phone || x.mobile, 30);
    if (!handle && !email && !phone) continue;
    if (handle && have.some((l) => l.handle === handle)) continue;
    const name = clean(x.name || [x.first_name, x.last_name].filter(Boolean).join(' '), 120);
    const lead = { id: 'ig' + Date.now().toString(36) + randomBytes(3).toString('hex'), handle, name, email, phone, keyword: clean(x.keyword || x.trigger, 60).toUpperCase(), post: clean(x.post || x.post_url, 300), receivedAt: new Date().toISOString() };
    await box.put(lead.id, lead); have.push(lead); added++;
  }
  return json({ ok: true, added, waiting: have.length });
};

export const config = { path: '/api/instagram-leads' };
