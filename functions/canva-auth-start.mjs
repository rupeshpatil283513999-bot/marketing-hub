// GET  /api/canva-auth-start   shows a tiny form asking for the design access code.
// POST /api/canva-auth-start   checks the code, registers this site with Canva, and sends the admin to
//                              Canva's own sign-in page. After the admin approves, Canva returns to
//                              /api/canva-auth-callback, which stores the tokens.
// Do this once. It is only needed again if the sign-in is revoked or expires.
// The admin signs in on Canva's page. This code never sees a Canva password.

import { getStore } from '@netlify/blobs';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { CANVA_MCP_ORIGIN, CANVA_SCOPES } from '../lib/canva-auth.mjs';

const html = (body, status = 200) => new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect Canva</title><body style="font:16px system-ui;max-width:460px;margin:12vh auto;padding:0 20px;color:#111">' + body + '</body>', { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const same = (a, b) => { const x = Buffer.from(String(a || '')); const y = Buffer.from(String(b || '')); return x.length === y.length && x.length > 0 && timingSafeEqual(x, y); };
const form = (msg) => html('<h2>Connect Canva</h2><p>Enter the design access code to start the Canva sign-in. You will sign in on Canva\'s own page.</p>' + (msg ? '<p style="color:#b00">' + msg + '</p>' : '') + '<form method="post"><input name="code" type="password" autocomplete="off" style="padding:8px;width:100%;box-sizing:border-box" autofocus><p><button style="padding:8px 14px">Continue to Canva</button></p></form>');

export default async (req) => {
  if (req.method === 'GET') return form('');
  if (req.method !== 'POST') return html('POST or GET only', 405);
  if (!process.env.DESIGN_ACCESS_CODE) return form('The design access code is not set in Netlify yet.');
  const code = (await req.formData().catch(() => null))?.get('code');
  if (!same(code, process.env.DESIGN_ACCESS_CODE)) return form('That code is not right.');

  const origin = new URL(req.url).origin;
  const redirect = origin + '/api/canva-auth-callback';
  const reg = await fetch(CANVA_MCP_ORIGIN + '/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ client_name: 'Valura Marketing Hub', redirect_uris: [redirect], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }),
  });
  const client = await reg.json().catch(() => ({}));
  if (!reg.ok || !client.client_id) return form('Canva did not accept the registration (' + reg.status + '). Try again in a minute.');

  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const state = b64url(randomBytes(24));
  await getStore('canva-auth').setJSON('pending/' + state, { verifier, client_id: client.client_id, redirect, createdAt: Date.now() });

  const u = new URL(CANVA_MCP_ORIGIN + '/authorize');
  u.search = new URLSearchParams({ response_type: 'code', client_id: client.client_id, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256', state, scope: CANVA_SCOPES.join(' '), resource: CANVA_MCP_ORIGIN }).toString();
  return new Response(null, { status: 302, headers: { location: u.toString(), 'cache-control': 'no-store' } });
};

export const config = { path: '/api/canva-auth-start' };
