// Storage for the latest snapshot of the app's state.
//
// On Netlify: Netlify Blobs (built in, no account or extra service needed).
// Anywhere else (your own computer, tests): a JSON file in .data/ so nothing has to be set up.

import { promises as fs } from 'node:fs';
import path from 'node:path';

const KEY = 'snapshot';
const LOCAL_FILE = path.join(process.cwd(), '.data', 'snapshot.json');

function onNetlify() {
  return !!(globalThis.Netlify || process.env.NETLIFY);
}

async function blobs() {
  const { getStore } = await import('@netlify/blobs');
  return getStore('marketing-hub');
}

export async function saveSnapshot(snapshot) {
  const record = { savedAt: new Date().toISOString(), snapshot };
  if (onNetlify()) {
    await (await blobs()).setJSON(KEY, record);
    return record.savedAt;
  }
  await fs.mkdir(path.dirname(LOCAL_FILE), { recursive: true });
  await fs.writeFile(LOCAL_FILE, JSON.stringify(record));
  return record.savedAt;
}

export async function loadSnapshot() {
  if (onNetlify()) return (await (await blobs()).get(KEY, { type: 'json' })) || null;
  try { return JSON.parse(await fs.readFile(LOCAL_FILE, 'utf8')); } catch (e) { return null; }
}
