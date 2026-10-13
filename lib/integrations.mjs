// Zoom Webinars and Luma, read only.
// Secrets live in Netlify environment variables and never leave the server:
//   ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET   (Zoom Server-to-Server OAuth app)
//   ZOOM_HOST_EMAIL                                        (optional: the licensed webinar host)
//   LUMA_API_KEY                                           (needs Luma Plus)
//   HUB_ACCESS_CODE                                        (optional: if set, callers must send x-hub-code)
//
// Routes (all GET), reached through netlify/functions/integrations.mjs:
//   /api/integrations/status            which keys are set, no secrets returned. Add ?test=1 to test the live login.
//   /api/integrations/zoom/webinars     recent and upcoming webinars
//   /api/integrations/zoom/sync?id=     one webinar: setup checks, registrants, attendance, Q&A, polls
//   /api/integrations/luma/events       recent and upcoming events on the calendar
//   /api/integrations/luma/sync?id=     one event: setup checks, guests, check-ins

const ZOOM_API = 'https://api.zoom.us/v2';
const ZOOM_TOKEN_URL = 'https://zoom.us/oauth/token';
const LUMA_API = 'https://public-api.luma.com';
const TIMEOUT_MS = 8000;

export const ZOOM_KEYS = ['ZOOM_ACCOUNT_ID', 'ZOOM_CLIENT_ID', 'ZOOM_CLIENT_SECRET'];
export const LUMA_KEYS = ['LUMA_API_KEY'];

export class UpstreamError extends Error {
  constructor(platform, status, message, extra) {
    super(message);
    this.platform = platform;
    this.status = status;
    this.extra = extra || {};
  }
}

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const missingKeys = (env, keys) => keys.filter((k) => !env[k]);
const low = (s) => String(s || '').trim().toLowerCase();
const num = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : null);

async function timedFetch(f, url, opts) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try { return await f(url, { ...opts, signal: ctl.signal }); } finally { clearTimeout(t); }
}

/* ---------------------------- Zoom ---------------------------- */
const zoomCache = { token: null, exp: 0 };

async function zoomToken(env, f, force) {
  if (!force && zoomCache.token && Date.now() < zoomCache.exp - 60000) return zoomCache.token;
  const basic = Buffer.from(env.ZOOM_CLIENT_ID + ':' + env.ZOOM_CLIENT_SECRET).toString('base64');
  let res;
  try {
    res = await timedFetch(f, ZOOM_TOKEN_URL, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + basic, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=account_credentials&account_id=' + encodeURIComponent(env.ZOOM_ACCOUNT_ID),
    });
  } catch (e) { throw new UpstreamError('zoom', 504, 'Could not reach Zoom to sign in.'); }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    const why = body.reason || body.error_description || body.message || body.error || 'Zoom refused the sign in';
    throw new UpstreamError('zoom', res.status === 400 || res.status === 401 ? 401 : 502, 'Zoom sign in failed: ' + why + '. Check ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID and ZOOM_CLIENT_SECRET, and that the app is activated.');
  }
  zoomCache.token = body.access_token;
  zoomCache.exp = Date.now() + num(body.expires_in || 3600) * 1000;
  return zoomCache.token;
}

async function zoomGet(env, f, path, params) {
  const qs = params ? '?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '')).toString() : '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await zoomToken(env, f, attempt === 1);
    let res;
    try { res = await timedFetch(f, ZOOM_API + path + qs, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } }); }
    catch (e) { throw new UpstreamError('zoom', 504, 'Zoom did not answer in time.'); }
    if (res.status === 401 && attempt === 0) continue;
    const body = await res.json().catch(() => ({}));
    if (res.ok) return body;
    const msg = (body && body.message) || 'Zoom returned an error';
    const hint = /scope/i.test(msg) ? ' Add the missing scope to your Zoom app, then try again.' : '';
    throw new UpstreamError('zoom', res.status, 'Zoom: ' + msg + hint, { code: body && body.code });
  }
  throw new UpstreamError('zoom', 401, 'Zoom rejected the access token.');
}

async function zoomAll(env, f, path, key, params, maxPages = 8) {
  const out = [];
  let token = '';
  for (let i = 0; i < maxPages; i++) {
    const body = await zoomGet(env, f, path, { page_size: 300, ...(params || {}), next_page_token: token || undefined });
    (body[key] || []).forEach((x) => out.push(x));
    token = body.next_page_token;
    if (!token) break;
  }
  return out;
}

async function zoomHosts(env, f) {
  if (env.ZOOM_HOST_EMAIL) return env.ZOOM_HOST_EMAIL.split(',').map((s) => s.trim()).filter(Boolean);
  const users = await zoomAll(env, f, '/users', 'users', { status: 'active' }, 1);
  return users.slice(0, 6).map((u) => u.email || u.id).filter(Boolean);
}

export async function zoomWebinars(env, f) {
  const hosts = await zoomHosts(env, f);
  if (!hosts.length) throw new UpstreamError('zoom', 404, 'No Zoom users found. Set ZOOM_HOST_EMAIL to the licensed webinar host.');
  const lists = await Promise.all(hosts.map((h) => zoomAll(env, f, '/users/' + encodeURIComponent(h) + '/webinars', 'webinars', { page_size: 100 }, 2).catch((e) => { if (hosts.length === 1) throw e; return []; })));
  const seen = new Set();
  const items = [];
  lists.flat().forEach((w) => {
    if (seen.has(String(w.id))) return;
    seen.add(String(w.id));
    items.push({ id: String(w.id), topic: w.topic || 'Untitled webinar', startTime: w.start_time || null, durationMin: num(w.duration), timezone: w.timezone || '', joinUrl: w.join_url || '' });
  });
  items.sort((a, b) => String(b.startTime || '').localeCompare(String(a.startTime || '')));
  return { platform: 'zoom', items, hosts };
}

const setupCheck = (key, label, state, note) => ({ key, label, state, note: note || '' });
const flag = (v) => (v === undefined || v === null ? 'unknown' : v ? 'ok' : 'missing');

export function zoomSetup(d, panelistCount) {
  const s = (d && d.settings) || {};
  const approval = s.approval_type; // 0 automatic, 1 manual, 2 no registration
  const reminders = s.attendees_and_panelists_reminder_email_notification;
  const followAtt = s.follow_up_attendees_email_notification;
  const followAbs = s.follow_up_absentees_email_notification;
  const qa = s.question_and_answer;
  return [
    setupCheck('registration', 'Registration is required', approval === undefined ? 'unknown' : approval === 2 ? 'missing' : 'ok', approval === 0 ? 'Approved automatically' : approval === 1 ? 'Approved manually' : approval === 2 ? 'Anyone with the link can join, so there is no registrant list' : ''),
    setupCheck('regLink', 'Registration link exists', flag(!!d.registration_url), d.registration_url || ''),
    setupCheck('agenda', 'Agenda or description written', flag(!!(d.agenda && String(d.agenda).trim()))),
    setupCheck('panelists', 'Panelists and speakers added', panelistCount === null ? 'unknown' : panelistCount > 0 ? 'ok' : 'missing', panelistCount === null ? '' : panelistCount + ' added'),
    setupCheck('reminders', 'Reminder emails switched on', reminders ? flag(reminders.enable) : 'unknown'),
    setupCheck('followAttended', 'Follow up email to attendees', followAtt ? flag(followAtt.enable) : 'unknown'),
    setupCheck('followAbsent', 'Follow up email to people who missed it', followAbs ? flag(followAbs.enable) : 'unknown'),
    setupCheck('recording', 'Recording switched on', s.auto_recording === undefined ? 'unknown' : s.auto_recording !== 'none' ? 'ok' : 'missing', s.auto_recording && s.auto_recording !== 'none' ? 'Recording: ' + s.auto_recording : ''),
    setupCheck('practice', 'Practice session enabled', flag(s.practice_session)),
    setupCheck('qa', 'Q&A enabled', qa && qa.enable !== undefined ? flag(qa.enable) : 'unknown'),
  ];
}

async function settle(errors, name, fn) {
  try { return await fn(); } catch (e) { errors[name] = e.message || 'Failed'; return null; }
}

export async function zoomSync(env, f, id) {
  if (!/^\d{6,14}$/.test(String(id || ''))) throw new UpstreamError('zoom', 400, 'Pick a webinar first. The webinar id is the 9 to 11 digit number.');
  const details = await zoomGet(env, f, '/webinars/' + id);
  const startMs = details.start_time ? Date.parse(details.start_time) : NaN;
  const durationMin = num(details.duration);
  const ended = Number.isFinite(startMs) ? Date.now() > startMs + durationMin * 60000 : false;
  const errors = {};
  const [regApproved, regPending, panelists, parts, qaRep, pollRep] = await Promise.all([
    settle(errors, 'registrants', () => zoomAll(env, f, '/webinars/' + id + '/registrants', 'registrants', { status: 'approved' })),
    settle(errors, 'pendingRegistrants', () => zoomAll(env, f, '/webinars/' + id + '/registrants', 'registrants', { status: 'pending' }, 3)),
    settle(errors, 'panelists', () => zoomGet(env, f, '/webinars/' + id + '/panelists')),
    ended ? settle(errors, 'attendance', () => zoomAll(env, f, '/report/webinars/' + id + '/participants', 'participants')) : null,
    ended ? settle(errors, 'qa', () => zoomGet(env, f, '/report/webinars/' + id + '/qa')) : null,
    ended ? settle(errors, 'polls', () => zoomGet(env, f, '/report/webinars/' + id + '/polls')) : null,
  ]);
  const panelistList = panelists ? panelists.panelists || [] : null;
  const panelistEmails = new Set((panelistList || []).map((p) => low(p.email)));

  const registrants = (regApproved || []).map((r) => ({
    email: low(r.email), name: [r.first_name, r.last_name].filter(Boolean).join(' ').trim(), status: r.status || 'approved',
    registeredAt: r.create_time || null, source: r.source_id || r.tracking_source || '',
  })).concat((regPending || []).map((r) => ({
    email: low(r.email), name: [r.first_name, r.last_name].filter(Boolean).join(' ').trim(), status: 'pending',
    registeredAt: r.create_time || null, source: r.source_id || r.tracking_source || '',
  })));

  let attendees = null;
  if (parts) {
    const byKey = new Map();
    parts.forEach((p) => {
      const email = low(p.user_email || p.email);
      if (email && panelistEmails.has(email)) return; // speakers are not audience
      const key = email || low(p.name || p.user_name);
      if (!key) return;
      const cur = byKey.get(key) || { email, name: p.name || p.user_name || '', joinTime: p.join_time || null, leaveTime: p.leave_time || null, seconds: 0 };
      cur.seconds += num(p.duration);
      if (p.join_time && (!cur.joinTime || p.join_time < cur.joinTime)) cur.joinTime = p.join_time;
      if (p.leave_time && (!cur.leaveTime || p.leave_time > cur.leaveTime)) cur.leaveTime = p.leave_time;
      byKey.set(key, cur);
    });
    attendees = [...byKey.values()].map((a) => ({ email: a.email, name: a.name, joinTime: a.joinTime, leaveTime: a.leaveTime, durationMin: Math.round(a.seconds / 60) }));
  }

  const qa = [];
  if (qaRep && Array.isArray(qaRep.questions)) {
    qaRep.questions.forEach((q) => (q.question_details || []).forEach((d) => qa.push({ name: q.name || '', email: low(q.email), question: d.question || '', answer: d.answer || '' })));
  }
  const polls = [];
  if (pollRep && Array.isArray(pollRep.questions)) {
    const byQ = new Map();
    pollRep.questions.forEach((r) => (r.question_details || []).forEach((d) => {
      const k = d.question || 'Poll question';
      const cur = byQ.get(k) || { question: k, answers: new Map(), respondents: 0 };
      cur.respondents += 1;
      const a = d.answer || '(no answer)';
      cur.answers.set(a, (cur.answers.get(a) || 0) + 1);
      byQ.set(k, cur);
    }));
    byQ.forEach((v) => polls.push({ question: v.question, respondents: v.respondents, answers: [...v.answers.entries()].map(([answer, count]) => ({ answer, count })).sort((x, y) => y.count - x.count) }));
  }

  const approved = registrants.filter((r) => r.status === 'approved');
  const regEmails = new Set(approved.map((r) => r.email).filter(Boolean));
  const attendedRegistered = attendees ? attendees.filter((a) => a.email && regEmails.has(a.email)).length : null;
  const stayedHalf = attendees && durationMin ? attendees.filter((a) => a.durationMin >= durationMin * 0.5).length : null;
  const counts = {
    registered: approved.length, pending: registrants.length - approved.length,
    attended: attendees ? attendees.length : null, attendedRegistered,
    walkIns: attendees && attendedRegistered !== null ? attendees.length - attendedRegistered : null,
    attendanceRate: attendees ? pct(attendedRegistered, approved.length) : null,
    avgDurationMin: attendees && attendees.length ? Math.round(attendees.reduce((s, a) => s + a.durationMin, 0) / attendees.length) : null,
    leftInFirstHalfPct: attendees && attendees.length && stayedHalf !== null ? 100 - pct(stayedHalf, attendees.length) : null,
    questions: ended ? qa.length : null, pollQuestions: ended ? polls.length : null,
  };
  return {
    platform: 'zoom', id: String(details.id || id), topic: details.topic || '', startTime: details.start_time || null, durationMin, timezone: details.timezone || '',
    joinUrl: details.join_url || '', registrationUrl: details.registration_url || '', ended,
    setup: zoomSetup(details, panelistList ? panelistList.length : null),
    counts, registrants, attendees, qa, polls, errors, fetchedAt: new Date().toISOString(),
  };
}

export async function zoomTest(env, f) {
  const host = env.ZOOM_HOST_EMAIL ? env.ZOOM_HOST_EMAIL.split(',')[0].trim() : '';
  if (host) {
    const u = await zoomGet(env, f, '/users/' + encodeURIComponent(host));
    return { ok: true, as: u.email || host, note: 'Webinar host found' };
  }
  const users = await zoomAll(env, f, '/users', 'users', { status: 'active' }, 1);
  return { ok: true, as: (users[0] && users[0].email) || 'Zoom account', note: users.length + ' user(s) visible. Set ZOOM_HOST_EMAIL to pick the webinar host.' };
}

/* ---------------------------- Luma ---------------------------- */
async function lumaGet(env, f, path, params) {
  const qs = params ? '?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '')).toString() : '';
  let res;
  try { res = await timedFetch(f, LUMA_API + path + qs, { headers: { 'x-luma-api-key': env.LUMA_API_KEY, Accept: 'application/json' } }); }
  catch (e) { throw new UpstreamError('luma', 504, 'Luma did not answer in time.'); }
  const body = await res.json().catch(() => ({}));
  if (res.ok) return body;
  const raw = (body && (body.message || (body.error && (body.error.message || body.error)))) || '';
  const msg = res.status === 401 ? 'Luma rejected the API key. Check LUMA_API_KEY.' : res.status === 403 ? 'Luma refused access. The API needs a Luma Plus plan, and the key must belong to the calendar owner.' : res.status === 429 ? 'Luma rate limit reached. Wait a minute and try again.' : 'Luma: ' + (raw || 'error ' + res.status);
  throw new UpstreamError('luma', res.status, msg);
}

async function lumaAll(env, f, path, params, maxPages = 30) {
  const out = [];
  let cursor = '';
  for (let i = 0; i < maxPages; i++) {
    const body = await lumaGet(env, f, path, { pagination_limit: 100, ...(params || {}), pagination_cursor: cursor || undefined });
    (body.entries || []).forEach((x) => out.push(x));
    if (!body.has_more || !body.next_cursor) break;
    cursor = body.next_cursor;
  }
  return out;
}

export async function lumaEvents(env, f) {
  const entries = await lumaAll(env, f, '/v1/calendars/events/list', { sort_column: 'start_at', sort_direction: 'desc' }, 2);
  const items = entries.map((e) => {
    const ev = e.event || e;
    return { id: ev.id || ev.api_id, name: ev.name || 'Untitled event', startAt: ev.start_at || null, endAt: ev.end_at || null, url: ev.url || '', timezone: ev.timezone || '' };
  }).filter((x) => x.id);
  return { platform: 'luma', items };
}

export function lumaSetup(ev) {
  const metUrl = ev.meeting_url || ev.zoom_meeting_url || '';
  return [
    setupCheck('public', 'Event page is public', ev.visibility ? (ev.visibility === 'public' ? 'ok' : 'missing') : 'unknown', ev.visibility ? 'Visibility: ' + ev.visibility : ''),
    setupCheck('open', 'Registration is open', flag(ev.registration_open)),
    setupCheck('cover', 'Cover image added', flag(!!ev.cover_url)),
    setupCheck('join', 'Join link set', ev.location_type ? (ev.location_type === 'missing' || ev.location_type === 'unknown' ? 'missing' : 'ok') : 'unknown', metUrl ? 'Link: ' + metUrl : ev.location_type ? 'Location type: ' + ev.location_type : ''),
    setupCheck('desc', 'Description written', flag(!!(ev.description_md && String(ev.description_md).trim()))),
    setupCheck('questions', 'Registration questions asked', Array.isArray(ev.registration_questions) ? (ev.registration_questions.length ? 'ok' : 'missing') : 'unknown', Array.isArray(ev.registration_questions) ? ev.registration_questions.length + ' question(s)' : ''),
    setupCheck('approval', 'Approval mode chosen', ev.require_approval === undefined ? 'unknown' : 'ok', ev.require_approval ? 'Guests need approval' : 'Guests are approved automatically'),
  ];
}

export async function lumaSync(env, f, id) {
  if (!/^evt-[A-Za-z0-9]+$/.test(String(id || ''))) throw new UpstreamError('luma', 400, 'Pick a Luma event first. Its id starts with evt-.');
  const ev = await lumaGet(env, f, '/v1/events/get', { event_id: id });
  const errors = {};
  const guestsRaw = await settle(errors, 'guests', () => lumaAll(env, f, '/v1/events/guests/list', { event_id: id }));
  const guests = (guestsRaw || []).map((g) => {
    const x = g.guest || g;
    return {
      email: low(x.email || x.user_email), name: x.name || [x.first_name, x.last_name].filter(Boolean).join(' ').trim() || x.user_name || '',
      status: x.approval_status || '', registeredAt: x.registered_at || x.created_at || null, checkedInAt: x.checked_in_at || null,
      ticket: Array.isArray(x.event_tickets) && x.event_tickets[0] ? x.event_tickets[0].name || '' : '',
    };
  });
  const isIn = (g) => g.status === 'approved' || g.status === 'session';
  const registered = guests.filter(isIn);
  const checkedIn = guests.filter((g) => g.checkedInAt);
  const by = (s) => guests.filter((g) => g.status === s).length;
  const counts = {
    registered: registered.length, pending: by('pending_approval'), waitlist: by('waitlist'), invited: by('invited'), declined: by('declined'),
    checkedIn: checkedIn.length, attendanceRate: guestsRaw ? pct(checkedIn.length, registered.length) : null,
    spotsRemaining: ev.spots_remaining === undefined ? null : ev.spots_remaining, maxCapacity: ev.max_capacity === undefined ? null : ev.max_capacity,
  };
  return {
    platform: 'luma', id: ev.id || id, name: ev.name || '', startAt: ev.start_at || null, endAt: ev.end_at || null, timezone: ev.timezone || '', url: ev.url || '',
    ended: ev.end_at ? Date.now() > Date.parse(ev.end_at) : false,
    setup: lumaSetup(ev), counts, guests, errors, fetchedAt: new Date().toISOString(),
  };
}

export async function lumaTest(env, f) {
  const me = await lumaGet(env, f, '/v1/users/get-self');
  const u = me.user || me;
  return { ok: true, as: u.email || u.name || 'Luma account', note: 'API key accepted' };
}

/* ---------------------------- router ---------------------------- */
export function status(env) {
  const zm = missingKeys(env, ZOOM_KEYS), lm = missingKeys(env, LUMA_KEYS);
  return {
    zoom: { configured: zm.length === 0, missing: zm, hostSet: !!env.ZOOM_HOST_EMAIL },
    luma: { configured: lm.length === 0, missing: lm },
    protected: !!env.HUB_ACCESS_CODE,
  };
}

export async function handle(req, env = process.env, f = fetch) {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/integrations\/?/, '').split('/').filter(Boolean);
  if (req.method !== 'GET') return json({ error: 'GET only' }, 405);
  if (env.HUB_ACCESS_CODE && req.headers.get('x-hub-code') !== env.HUB_ACCESS_CODE) {
    return json({ error: 'Enter the hub access code to use integrations.', needsCode: true }, 401);
  }
  const route = parts.join('/');
  try {
    if (route === 'status' || route === '') {
      const st = status(env);
      if (url.searchParams.get('test')) {
        const which = url.searchParams.get('test');
        const run = async (name, cfg, fn) => {
          if (!cfg.configured) return { ...cfg, ok: false, error: 'Not set up yet. Add ' + cfg.missing.join(', ') + ' in Netlify.' };
          try { return { ...cfg, ...(await fn(env, f)) }; } catch (e) { return { ...cfg, ok: false, error: e.message }; }
        };
        if (which === 'zoom' || which === '1') st.zoom = await run('zoom', st.zoom, zoomTest);
        if (which === 'luma' || which === '1') st.luma = await run('luma', st.luma, lumaTest);
      }
      return json(st);
    }
    const [platform, action] = parts;
    if (platform === 'zoom' || platform === 'luma') {
      const miss = missingKeys(env, platform === 'zoom' ? ZOOM_KEYS : LUMA_KEYS);
      if (miss.length) return json({ error: 'Not set up yet. Add ' + miss.join(', ') + ' in Netlify, then redeploy.', notConfigured: true, missing: miss }, 400);
      const id = url.searchParams.get('id');
      if (platform === 'zoom' && action === 'webinars') return json(await zoomWebinars(env, f));
      if (platform === 'zoom' && action === 'sync') return json(await zoomSync(env, f, id));
      if (platform === 'luma' && action === 'events') return json(await lumaEvents(env, f));
      if (platform === 'luma' && action === 'sync') return json(await lumaSync(env, f, id));
    }
    return json({ error: 'Unknown route' }, 404);
  } catch (e) {
    if (e instanceof UpstreamError) return json({ error: e.message, platform: e.platform }, e.status >= 400 && e.status < 600 && e.status !== 401 ? e.status : 502);
    return json({ error: 'Unexpected error: ' + (e && e.message ? e.message : 'unknown') }, 500);
  }
}
