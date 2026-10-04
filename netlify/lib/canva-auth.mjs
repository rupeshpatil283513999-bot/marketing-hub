// Keeps the Canva sign-in for the design service.
// The access token and its renewal token live in Netlify Blobs (never in the browser, never in the repository).
// getAccessToken() hands back a fresh access token, renewing it first if it is about to expire.

import { getStore } from '@netlify/blobs';

export const CANVA_MCP_ORIGIN = 'https://mcp.canva.com';
export const CANVA_SCOPES = ['profile:read', 'design:meta:read', 'design:content:read', 'design:content:write', 'folder:read', 'folder:write', 'asset:read', 'asset:write', 'brandkit:read'];

const KEY = 'tokens';
const authStore = () => getStore('canva-auth');

export async function loadAuth() {
  return (await authStore().get(KEY, { type: 'json' })) || null;
}

export async function saveAuth(rec) {
  await authStore().setJSON(KEY, rec);
}

export async function tokenRequest(params) {
  const res = await fetch(CANVA_MCP_ORIGIN + '/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(params).toString(),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error((j && (j.error_description || j.error)) || 'Canva sign-in failed (' + res.status + ')');
  return j;
}

export function recordFromTokens(j, clientId, prev) {
  return {
    client_id: clientId,
    access_token: j.access_token,
    refresh_token: j.refresh_token || (prev && prev.refresh_token) || '',
    expires_at: Date.now() + (Number(j.expires_in) > 0 ? Number(j.expires_in) : 3600) * 1000,
    scope: j.scope || (prev && prev.scope) || '',
    updated_at: new Date().toISOString(),
  };
}

// Returns an access token, or throws a plain message an admin can act on.
export async function getAccessToken() {
  const rec = await loadAuth();
  if (!rec) {
    if (process.env.CANVA_MCP_TOKEN) return process.env.CANVA_MCP_TOKEN; // optional manual token
    throw new Error('Canva is not signed in yet. An admin needs to open /api/canva-auth-start once.');
  }
  if (rec.expires_at - Date.now() > 120 * 1000) return rec.access_token;
  if (!rec.refresh_token) throw new Error('Canva sign-in expired. An admin needs to open /api/canva-auth-start again.');
  try {
    const j = await tokenRequest({ grant_type: 'refresh_token', refresh_token: rec.refresh_token, client_id: rec.client_id });
    const next = recordFromTokens(j, rec.client_id, rec);
    await saveAuth(next);
    return next.access_token;
  } catch (e) {
    throw new Error('Canva sign-in expired. An admin needs to open /api/canva-auth-start again.');
  }
}
