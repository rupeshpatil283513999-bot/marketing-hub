// A small inbox for things that arrive from outside and wait for the hub to pick them up:
// delivery events from Resend and Interakt, and Instagram comment leads.
// One blob per item, so two webhooks arriving together can never overwrite each other.
// On Netlify this uses Netlify Blobs. Anywhere else it writes files in .data/ so tests need no setup.

import { promises as fs } from 'node:fs';
import path from 'node:path';

const onNetlify = () => !!(globalThis.Netlify || process.env.NETLIFY);
const safeKey = (k) => String(k).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 180);
const MAX_READ = 500;

export function inbox(name, root = process.cwd()) {
  const dir = path.join(root, '.data', name);
  const blobs = async () => (await import('@netlify/blobs')).getStore({ name, consistency: 'strong' });
  return {
    async has(key) {
      key = safeKey(key);
      if (onNetlify()) return (await (await blobs()).get(key)) != null;
      try { await fs.access(path.join(dir, key + '.json')); return true; } catch (e) { return false; }
    },
    async put(key, value) {
      key = safeKey(key);
      if (onNetlify()) { await (await blobs()).setJSON(key, value); return; }
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, key + '.json'), JSON.stringify(value));
    },
    async list() {
      if (onNetlify()) {
        const s = await blobs();
        const { blobs: keys } = await s.list();
        const out = [];
        for (const b of keys.slice(0, MAX_READ)) { const v = await s.get(b.key, { type: 'json' }).catch(() => null); if (v) out.push(v); }
        return out;
      }
      let files = []; try { files = await fs.readdir(dir); } catch (e) { return []; }
      const out = [];
      for (const f of files.slice(0, MAX_READ)) { try { out.push(JSON.parse(await fs.readFile(path.join(dir, f), 'utf8'))); } catch (e) { } }
      return out;
    },
    async remove(key) {
      key = safeKey(key);
      if (onNetlify()) { await (await blobs()).delete(key); return; }
      try { await fs.unlink(path.join(dir, key + '.json')); } catch (e) { }
    },
  };
}
export { safeKey };
