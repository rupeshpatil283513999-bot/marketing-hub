// Access code for the routes that send messages or return contact data.
// Set HUB_ACCESS_CODE in Netlify (Site configuration, Environment variables, secret).
// The page itself stays open to anyone with the link. The hub sends the code as the x-hub-code header.
// If the code is not set, these routes refuse to run, so a missing setting can never leave them open.

import { timingSafeEqual } from 'node:crypto';

const json = (obj, status) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

function same(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

/* null when the caller may continue, else a Response to send back. headers is a Headers object or a plain object. */
export function gate(headers, env = process.env) {
  const want = String(env.HUB_ACCESS_CODE || '');
  if (!want) return json({ error: 'HUB_ACCESS_CODE is not set on the server. Add it in Netlify, then try again.', notConfigured: true }, 503);
  const got = typeof headers.get === 'function' ? headers.get('x-hub-code') : headers['x-hub-code'];
  if (!got || !same(got, want)) return json({ error: 'Enter the hub access code to continue.', needsCode: true }, 401);
  return null;
}
