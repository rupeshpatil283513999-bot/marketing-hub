// GET /api/fx-rate
// Returns the current US dollar to Indian rupee rate so the app never asks anyone to type it.
//   { "base": "USD", "quote": "INR", "rate": 88.02, "asOf": "2026-10-04T06:00:00.000Z", "source": "open.er-api.com" }
//
// Two free providers are tried in turn (neither needs a key). The answer is cached for an hour
// at the edge and in this function, and the last good value is served if both providers fail.
// To use a paid or bank feed instead, change PROVIDERS below. Nothing here is secret.

const PROVIDERS = [
  {
    name: 'open.er-api.com',
    url: 'https://open.er-api.com/v6/latest/USD',
    pick: (j) => ({ rate: j && j.rates && j.rates.INR, asOf: j && j.time_last_update_unix ? new Date(j.time_last_update_unix * 1000).toISOString() : null }),
  },
  {
    name: 'frankfurter.dev',
    url: 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=INR',
    pick: (j) => ({ rate: j && j.rates && j.rates.INR, asOf: j && j.date ? new Date(j.date + 'T00:00:00Z').toISOString() : null }),
  },
];

const FRESH_MS = 60 * 60 * 1000;
let last = null; // { rate, asOf, source, fetchedAt }

const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...extra } });

async function fetchRate() {
  for (const p of PROVIDERS) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 6000);
      const res = await fetch(p.url, { signal: ctl.signal, headers: { Accept: 'application/json' } });
      clearTimeout(t);
      if (!res.ok) continue;
      const { rate, asOf } = p.pick(await res.json());
      const n = Number(rate);
      // sanity range, so a bad payload can never show a silly number
      if (!(n > 20 && n < 300)) continue;
      return { rate: Math.round(n * 10000) / 10000, asOf: asOf || new Date().toISOString(), source: p.name, fetchedAt: Date.now() };
    } catch (e) { /* try the next provider */ }
  }
  return null;
}

export default async () => {
  if (last && Date.now() - last.fetchedAt < FRESH_MS) return reply(last);
  const fresh = await fetchRate();
  if (fresh) { last = fresh; return reply(fresh); }
  if (last) return reply(last, true);
  return json({ error: 'No rate available right now' }, 503, { 'Cache-Control': 'no-store' });
};

function reply(v, stale) {
  return json({ base: 'USD', quote: 'INR', rate: v.rate, asOf: v.asOf, source: v.source, stale: !!stale }, 200, { 'Cache-Control': 'public, max-age=300, s-maxage=3600' });
}

export const config = { path: '/api/fx-rate' };
