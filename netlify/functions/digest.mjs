// GET /api/digest          -> run the rules on the latest snapshot and email the digest
// GET /api/digest?dry=1    -> same, but show the digest and send nothing
//
// Protected: the caller must send the header  Authorization: Bearer <CRON_SECRET>.
// (The daily schedule does not go through this address, see digest-daily.mjs.)

import { runDigest } from '../lib/run.js';

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

export default async (req) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) return json({ error: 'CRON_SECRET is not set on the server' }, 500);
  if (req.headers.get('authorization') !== 'Bearer ' + secret) return json({ error: 'unauthorized' }, 401);

  const dry = new URL(req.url).searchParams.has('dry');
  try {
    return json(await runDigest({ dry }));
  } catch (e) {
    return json({ ok: false, error: e.message }, 500);
  }
};

export const config = { path: '/api/digest' };
