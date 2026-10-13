// GET  /api/hub-events          the hub reads waiting delivery events
// POST /api/hub-events {ack}    the hub marks events as handled
// Both need the hub access code (x-hub-code header).
import { gate } from '../lib/gate.mjs';
import { inbox } from '../lib/inbox.mjs';

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export default async (req) => {
  const blocked = gate(req.headers); if (blocked) return blocked;
  const box = inbox('hub-events');
  if (req.method === 'GET') {
    const events = (await box.list()).sort((a, b) => String(a.receivedAt).localeCompare(String(b.receivedAt)));
    return json({ events });
  }
  if (req.method === 'POST') {
    let b = {}; try { b = await req.json(); } catch (e) { }
    if (!Array.isArray(b.ack)) return json({ error: 'Send {ack: [ids]}.' }, 400);
    for (const id of b.ack.slice(0, 1000)) await box.remove(id);
    return json({ ok: true });
  }
  return json({ error: 'Use GET or POST.' }, 405);
};

export const config = { path: '/api/hub-events' };
