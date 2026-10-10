/**
 * /api/send-whatsapp (Interakt WhatsApp template message)
 *
 * Sends one approved WhatsApp template message through Interakt.
 * The API key stays on the server (INTERAKT_API_KEY in .env.local) and is never sent to the browser.
 *
 * Body: { phone: "919876500001", template: { name, languageCode, bodyValues: [], headerValues: [], buttonValues: {} }, callbackData, simulate }
 */

// Longest codes first, so 971 is matched before 97 or 9.
const COUNTRY_CODES = ['971', '966', '974', '968', '973', '965', '353', '852', '91', '44', '65', '61', '49', '33', '27', '1'];

function splitPhone(raw) {
  const d = String(raw || '').replace(/[^0-9]/g, '');
  if (d.length < 8 || d.length > 15) return null;
  const cc = COUNTRY_CODES.find((c) => d.startsWith(c) && d.length - c.length >= 6 && d.length - c.length <= 12);
  if (!cc) return null;
  const rest = d.slice(cc.length);
  if (cc === '91' && rest.length !== 10) return null;
  return { countryCode: '+' + cc, phoneNumber: rest };
}

function reply(res, code, obj) {
  if (typeof res.status === 'function') return res.status(code).json(obj);
  res.writeHead(code, { 'Content-Type': 'application/json' });
  return res.end(JSON.stringify(obj));
}

async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (req.method !== 'POST') return reply(res, 405, { status: 'error', error: 'Method not allowed. Use POST.' });

  try {
    const body = req.body || {};
    const t = body.template || {};
    if (!t.name || !String(t.name).trim()) return reply(res, 400, { status: 'error', code: 'NO_TEMPLATE', error: 'The Interakt template name is required.' });
    const ph = splitPhone(body.phone);
    if (!ph) return reply(res, 400, { status: 'error', code: 'BAD_PHONE', error: 'The phone number needs a country code, for example 919876543210.' });

    const apiKey = (process.env.INTERAKT_API_KEY || '').trim();
    if (!apiKey && !body.simulate) {
      return reply(res, 400, { status: 'error', code: 'MISSING_API_KEY', error: 'Missing INTERAKT_API_KEY in environment variables.', hint: 'Add your Interakt key to .env.local and restart the hub.' });
    }
    if (body.simulate === true || apiKey === 'mock') {
      return reply(res, 200, { status: 'sent', simulated: true, id: 'wa_sim_' + Math.random().toString(36).slice(2, 10), to: ph.countryCode + ph.phoneNumber, at: new Date().toISOString() });
    }

    const template = {
      name: String(t.name).trim(),
      languageCode: String(t.languageCode || 'en').trim(),
    };
    if (Array.isArray(t.headerValues) && t.headerValues.length) template.headerValues = t.headerValues.map(String);
    if (Array.isArray(t.bodyValues) && t.bodyValues.length) template.bodyValues = t.bodyValues.map(String);
    if (t.buttonValues && typeof t.buttonValues === 'object' && Object.keys(t.buttonValues).length) template.buttonValues = t.buttonValues;

    const payload = { countryCode: ph.countryCode, phoneNumber: ph.phoneNumber, type: 'Template', template };
    if (body.callbackData) payload.callbackData = String(body.callbackData).slice(0, 512);

    // Interakt expects the key from the dashboard as it is shown, after the word Basic.
    const r = await fetch('https://api.interakt.ai/v1/public/message/', {
      method: 'POST',
      headers: { Authorization: 'Basic ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));

    if (!r.ok || data.result === false) {
      const msg = data.message || data.error || ('Interakt returned status ' + r.status);
      return reply(res, r.ok ? 400 : (r.status || 500), { status: 'error', code: r.status === 429 ? 'RATE_LIMIT' : 'INTERAKT_API_ERROR', error: msg, details: data });
    }
    return reply(res, 200, { status: 'sent', id: data.id || null, to: ph.countryCode + ph.phoneNumber, at: new Date().toISOString() });
  } catch (e) {
    return reply(res, 500, { status: 'error', code: 'SERVER_ERROR', error: e.message || 'Internal server error while sending WhatsApp.' });
  }
}

module.exports = handler;
module.exports.default = handler;
module.exports.splitPhone = splitPhone;
