// Lets the original serverless handlers (written as handler(req, res) for Vercel)
// run unchanged on Netlify, which calls functions with a standard Request and
// expects a standard Response.

export function adapt(handler) {
  return async (request) => {
    const url = new URL(request.url);
    let body;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const raw = await request.text();
      if (raw) {
        try { body = JSON.parse(raw); } catch (e) { body = raw; }
      }
    }
    const headers = {};
    request.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
    const req = {
      method: request.method,
      url: url.pathname + url.search,
      headers,
      body,
      query: Object.fromEntries(url.searchParams),
    };

    return new Promise((resolve) => {
      const out = { status: 200, headers: {}, chunks: [] };
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        const text = out.chunks.join('');
        resolve(new Response(out.status === 204 || !text ? null : text, { status: out.status, headers: out.headers }));
      };
      const res = {
        setHeader(k, v) { out.headers[k] = v; return res; },
        getHeader(k) { return out.headers[k]; },
        status(c) { out.status = c; return res; },
        writeHead(c, h) { out.status = c; if (h) Object.assign(out.headers, h); return res; },
        json(o) { out.headers['Content-Type'] = 'application/json'; out.chunks.push(JSON.stringify(o)); finish(); return res; },
        send(b) { out.chunks.push(typeof b === 'string' ? b : JSON.stringify(b)); finish(); return res; },
        write(c) { out.chunks.push(String(c)); return res; },
        end(c) { if (c != null) out.chunks.push(String(c)); finish(); return res; },
      };
      Promise.resolve(handler(req, res))
        .then(() => setTimeout(finish, 0))
        .catch((e) => {
          if (done) return;
          done = true;
          resolve(new Response(JSON.stringify({ status: 'error', error: e && e.message ? e.message : 'Server error' }), { status: 500, headers: { 'Content-Type': 'application/json' } }));
        });
    });
  };
}
