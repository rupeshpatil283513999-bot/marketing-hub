// GET /api/canva-auth-status  ->  { connected, ready, missing: [...] }
// Yes or no answers only, so Studio can tell people what is left to set up. No keys or tokens are returned.

import { loadAuth } from '../lib/canva-auth.mjs';

export default async () => {
  const rec = await loadAuth().catch(() => null);
  const connected = !!(rec && (rec.refresh_token || rec.expires_at > Date.now())) || !!process.env.CANVA_MCP_TOKEN;
  const missing = [];
  if (!process.env.ANTHROPIC_API_KEY) missing.push('ANTHROPIC_API_KEY');
  if (!process.env.DESIGN_ACCESS_CODE) missing.push('DESIGN_ACCESS_CODE');
  if (!connected) missing.push('Canva sign-in');
  return new Response(JSON.stringify({ connected, ready: missing.length === 0, missing }), { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
};

export const config = { path: '/api/canva-auth-status' };
