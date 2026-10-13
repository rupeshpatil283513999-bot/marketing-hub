// GET /api/canva-auth-callback?code=...&state=...
// Canva sends the admin back here after they approve. We swap the one-time code for tokens and keep them
// in Netlify Blobs. Nothing secret is shown on the page.

import { getStore } from '@netlify/blobs';
import { tokenRequest, recordFromTokens, saveAuth } from '../lib/canva-auth.mjs';

const page = (title, msg, status = 200) => new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + title + '</title><body style="font:16px system-ui;max-width:460px;margin:12vh auto;padding:0 20px;color:#111"><h2>' + title + '</h2><p>' + msg + '</p></body>', { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });

export default async (req) => {
  const url = new URL(req.url);
  const state = url.searchParams.get('state') || '';
  const code = url.searchParams.get('code') || '';
  if (url.searchParams.get('error')) return page('Canva was not connected', 'Canva said: ' + String(url.searchParams.get('error')).replace(/[<>&"]/g, ''), 400);
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(state) || !code) return page('Canva was not connected', 'This link is not valid. Start again from /api/canva-auth-start.', 400);
  const store = getStore('canva-auth');
  const pending = await store.get('pending/' + state, { type: 'json' });
  if (!pending || Date.now() - pending.createdAt > 15 * 60 * 1000) return page('Canva was not connected', 'That sign-in attempt expired. Start again from /api/canva-auth-start.', 400);
  try {
    const j = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: pending.redirect, client_id: pending.client_id, code_verifier: pending.verifier });
    await saveAuth(recordFromTokens(j, pending.client_id, null));
    await store.delete('pending/' + state).catch(() => {});
    return page('Canva is connected', 'You can close this tab and go back to Studio. Design with a prompt is ready once the access code and API key are set.');
  } catch (e) {
    return page('Canva was not connected', String(e && e.message ? e.message : 'Sign-in failed').replace(/[<>&"]/g, ''), 400);
  }
};

export const config = { path: '/api/canva-auth-callback' };
