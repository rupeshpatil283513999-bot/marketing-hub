// Sends the digest email. Two providers, chosen by MAIL_PROVIDER:
//
//   graph  (default when the Microsoft settings exist)  Outlook / Microsoft 365 via Microsoft Graph.
//                                              Sends from the mailbox in MS_SENDER (or MAIL_FROM).
//   resend                                     Resend.com, handy for a first test.
//
// All keys live in Netlify environment variables, never in the browser code.
// Each Microsoft setting can be given under either name, so the developer config
// document's names work as they are:
//   MS_TENANT_ID / AZURE_TENANT_ID, MS_CLIENT_ID / AZURE_CLIENT_ID,
//   MS_CLIENT_SECRET / AZURE_CLIENT_SECRET, MS_SENDER / MAIL_FROM

function env(...names) {
  for (const n of names) if (process.env[n]) return process.env[n];
  return '';
}

async function graphToken() {
  const tenant = env('MS_TENANT_ID', 'AZURE_TENANT_ID');
  const clientId = env('MS_CLIENT_ID', 'AZURE_CLIENT_ID');
  const secret = env('MS_CLIENT_SECRET', 'AZURE_CLIENT_SECRET');
  if (!tenant || !clientId || !secret) throw new Error('The tenant ID, client ID and client secret must all be set (MS_* or AZURE_*)');
  const r = await fetch('https://login.microsoftonline.com/' + encodeURIComponent(tenant) + '/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: secret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.access_token) throw new Error('Microsoft sign-in failed: ' + (data.error_description || (typeof data.error === 'string' ? data.error : (data.error && data.error.message)) || r.status));
  return data.access_token;
}

async function sendViaGraph({ to, subject, html }) {
  const sender = env('MS_SENDER', 'MAIL_FROM');
  if (!sender) throw new Error('The sender mailbox is not set (MS_SENDER or MAIL_FROM)');
  const token = await graphToken();
  const r = await fetch('https://graph.microsoft.com/v1.0/users/' + encodeURIComponent(sender) + '/sendMail', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: 'HTML', content: html },
        toRecipients: to.map((address) => ({ emailAddress: { address } })),
      },
      saveToSentItems: true,
    }),
  });
  if (r.status !== 202) {
    const data = await r.json().catch(() => ({}));
    throw new Error('Outlook rejected the email: ' + ((data.error && data.error.message) || r.status));
  }
  return { id: 'graph-accepted' };
}

async function sendViaResend({ to, subject, text, html }) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.DIGEST_FROM;
  if (!key) throw new Error('RESEND_API_KEY is not set');
  if (!from) throw new Error('DIGEST_FROM is not set');
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, text, html }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Resend rejected the email: ' + (data.message || r.status));
  return data;
}

export async function sendMail({ to, subject, text, html }) {
  if (!to || !to.length) throw new Error('DIGEST_TO is not set');
  const provider = (process.env.MAIL_PROVIDER || (env('MS_CLIENT_ID', 'AZURE_CLIENT_ID') ? 'graph' : 'resend')).toLowerCase();
  if (provider === 'graph') return sendViaGraph({ to, subject, html });
  if (provider === 'resend') return sendViaResend({ to, subject, text, html });
  throw new Error('Unknown MAIL_PROVIDER: ' + provider);
}
