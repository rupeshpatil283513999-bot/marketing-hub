// Checks and reads the webhooks from Resend (email) and Interakt (WhatsApp).
// Both sign the exact bytes they send, so the raw body text must be used as received.

import { createHmac, timingSafeEqual } from 'node:crypto';

const eq = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };

/* Resend signs with Svix: HMAC SHA256 of "id.timestamp.body", key is the base64 part after whsec_, 5 minute window. */
export function verifyResend(secret, headers, raw, nowSec = Date.now() / 1000) {
  const id = headers.get('svix-id'), ts = headers.get('svix-timestamp'), sig = headers.get('svix-signature');
  if (!id || !ts || !sig) return false;
  if (Math.abs(nowSec - Number(ts)) > 300) return false;
  const key = Buffer.from(String(secret).replace(/^whsec_/, ''), 'base64');
  const want = createHmac('sha256', key).update(id + '.' + ts + '.' + raw).digest('base64');
  return String(sig).split(' ').some((part) => eq(part.split(',')[1] || '', want));
}

/* Interakt sends Interakt-Signature: sha256=<hex of HMAC SHA256 of the raw body>. */
export function verifyInterakt(secret, headers, raw) {
  const got = String(headers.get('interakt-signature') || '').replace(/^sha256=/i, '').trim().toLowerCase();
  if (!got) return false;
  return eq(got, createHmac('sha256', secret).update(raw).digest('hex'));
}

const RESEND_KINDS = { 'email.sent': 'sent', 'email.delivered': 'delivered', 'email.delivery_delayed': 'delayed', 'email.opened': 'opened', 'email.clicked': 'clicked', 'email.bounced': 'bounced', 'email.complained': 'complained', 'email.failed': 'failed' };
const tagOf = (tags, name) => {
  if (!tags) return '';
  if (Array.isArray(tags)) { const t = tags.find((x) => x && x.name === name); return t ? String(t.value || '') : ''; }
  return typeof tags === 'object' ? String(tags[name] || '') : '';
};

/* Returns a hub event, or null when this event type is not one the hub uses. */
export function resendEvent(evt, svixId) {
  const kind = RESEND_KINDS[evt && evt.type];
  if (!kind) return null;
  const d = evt.data || {};
  const to = Array.isArray(d.to) ? d.to[0] : d.to;
  return {
    id: String(svixId), src: 'resend', kind,
    email: String(to || '').toLowerCase(),
    contactId: tagOf(d.tags, 'contact'), flowId: tagOf(d.tags, 'flow'),
    at: evt.created_at || d.created_at || new Date().toISOString(),
    subject: String(d.subject || '').slice(0, 200),
    reason: String((d.bounce && (d.bounce.message || d.bounce.type)) || '').slice(0, 200),
    link: String((d.click && d.click.link) || '').slice(0, 300),
  };
}

const IK_STATUS = { sent: 'sent', delivered: 'delivered', read: 'read', failed: 'failed', clicked: 'clicked' };
export function interaktEvent(evt) {
  const type = String((evt && evt.type) || '');
  const d = (evt && evt.data) || {}; const msg = d.message || {}; const cust = d.customer || {};
  const phone = String(cust.channel_phone_number || '').replace(/[^0-9]/g, '');
  let out = null;
  const m = /^message_(?:api|campaign)_(sent|delivered|read|failed|clicked)$/.exec(type);
  if (m) {
    const cb = String((((msg.meta_data || {}).source_data || {}).callback_data) || '');
    const parts = cb.split(':');
    out = { id: String(msg.id || '') + ':' + IK_STATUS[m[1]], src: 'interakt', kind: IK_STATUS[m[1]], phone, flowId: parts[0] || '', contactId: parts[1] || '', at: msg.seen_at_utc || msg.delivered_at_utc || msg.received_at_utc || evt.timestamp || new Date().toISOString(), reason: String(msg.channel_failure_reason || '').slice(0, 200) };
  } else if (type === 'message_received') {
    out = { id: String(msg.id || ('in' + Date.now())) + ':reply', src: 'interakt', kind: 'reply', phone, text: String(msg.message || '').slice(0, 300), at: msg.received_at_utc || evt.timestamp || new Date().toISOString() };
  }
  if (!out || !out.id || (!out.phone && !out.contactId)) return null;
  return out;
}
