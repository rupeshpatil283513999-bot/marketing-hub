// GET /api/canva-design-status?id=<job id>            -> { status, message, title, editUrl, ... }
// GET /api/canva-design-status?id=<job id>&img=1       -> the exported PNG
// The id is a long random value made by the browser when it starts a design, so it works like a
// private link. Nothing secret is returned.

import { getStore } from '@netlify/blobs';

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export default async (req) => {
  const url = new URL(req.url);
  const id = url.searchParams.get('id') || '';
  if (!/^[a-z0-9]{12,40}$/.test(id)) return json({ error: 'Bad id' }, 400);
  const s = getStore('canva-design');
  if (url.searchParams.get('img')) {
    const buf = await s.get('img/' + id, { type: 'arrayBuffer' });
    if (!buf) return json({ error: 'Not ready' }, 404);
    return new Response(buf, { status: 200, headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=3600' } });
  }
  const job = await s.get('job/' + id, { type: 'json' });
  if (!job) return json({ status: 'unknown', message: 'No such design request' }, 404);
  const { prompt, ...safe } = job;
  return json(safe);
};

export const config = { path: '/api/canva-design-status' };
