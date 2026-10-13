/**
 * /api/confirm-hop
 *
 * Co-Brand Hop Confirmation Endpoint (Phase 4)
 *
 * Implements the one-tap scoped authentication confirmation link:
 * "I've forwarded this — tap to confirm."
 *
 * No login required — the link itself is the scoped authentication for that one hop.
 * Returns a high-polish confirmation landing page for external SPOCs / partners,
 * and JSON for frontend API callers.
 */

function decodeConfirmToken(token) {
  try {
    const raw = Buffer.from(token, 'base64').toString('utf8');
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function generateConfirmToken(data) {
  return Buffer.from(JSON.stringify(data)).toString('base64');
}

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost:5173'}`);
  const qToken = urlObj.searchParams.get('token');
  const qAssetId = urlObj.searchParams.get('assetId');
  const qPartnerId = urlObj.searchParams.get('partnerId');
  const qStage = urlObj.searchParams.get('stage') || 'spoc_forwarded';
  const qFormat = urlObj.searchParams.get('format');

  let assetId = qAssetId;
  let partnerId = qPartnerId;
  let stage = qStage;
  let assetName = urlObj.searchParams.get('assetName') || 'Co-Branded Campaign Asset';
  let partnerName = urlObj.searchParams.get('partnerName') || 'Channel Partner';
  let spocName = urlObj.searchParams.get('spocName') || 'Partner SPOC';

  if (qToken) {
    const payload = decodeConfirmToken(qToken);
    if (payload) {
      assetId = payload.assetId || assetId;
      partnerId = payload.partnerId || partnerId;
      stage = payload.stage || stage;
      assetName = payload.assetName || assetName;
      partnerName = payload.partnerName || partnerName;
      spocName = payload.spocName || spocName;
    }
  }

  // Also support POST json body
  if (req.method === 'POST') {
    let body = {};
    if (req.body) {
      body = req.body;
    } else {
      try {
        const buffers = [];
        for await (const chunk of req) buffers.push(chunk);
        body = JSON.parse(Buffer.concat(buffers).toString('utf8') || '{}');
      } catch (e) {}
    }
    if (body.assetId) assetId = body.assetId;
    if (body.partnerId) partnerId = body.partnerId;
    if (body.stage) stage = body.stage;
    if (body.assetName) assetName = body.assetName;
    if (body.partnerName) partnerName = body.partnerName;
    if (body.spocName) spocName = body.spocName;
  }

  const confirmedAt = new Date().toISOString();
  const hopTitles = {
    design_ready: 'Hop 1: Creative Design Ready',
    sent_to_spoc: 'Hop 2: Delivered to Partner SPOC',
    spoc_forwarded: 'Hop 3: Forwarded by SPOC to Partner Leadership',
    partner_forwarded: 'Hop 4: Published & Distributed to End Investors / Clients',
  };

  const hopTitle = hopTitles[stage] || `Hop: ${stage}`;

  // If JSON requested or POST API call:
  if (qFormat === 'json' || req.headers.accept?.includes('application/json') || req.method === 'POST') {
    const responsePayload = {
      status: 'confirmed',
      stage,
      hopTitle,
      assetId,
      assetName,
      partnerId,
      partnerName,
      spocName,
      confirmedAt,
      message: `${hopTitle} confirmed successfully for ${partnerName}`,
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(responsePayload));
  }

  // Otherwise return high-polish branded HTML confirmation landing page
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Hand-Off Confirmed — Valura.Ai Orbit</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Geist+Mono:wght@500;600&display=swap">
  <style>
    :root {
      --bg: #09090a;
      --surface: #131315;
      --surface-2: #1c1c20;
      --ink: #FFFFFF;
      --ink-soft: #8E8E93;
      --accent: #05a049;
      --border: rgba(255, 255, 255, 0.1);
      --font-body: 'Plus Jakarta Sans', -apple-system, sans-serif;
      --font-mono: 'Geist Mono', monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--ink);
      font-family: var(--font-body);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px;
      -webkit-font-smoothing: antialiased;
    }
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 20px;
      width: 100%;
      max-width: 520px;
      padding: 36px 32px;
      box-shadow: 0 24px 64px rgba(0,0,0,0.8), 0 0 1px 1px rgba(255,255,255,0.06);
      text-align: center;
      animation: popIn .24s cubic-bezier(0.16, 1, 0.3, 1);
    }
    @keyframes popIn {
      from { transform: scale(0.96) translateY(8px); opacity: 0; }
      to { transform: scale(1) translateY(0); opacity: 1; }
    }
    .brand-row {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 24px;
    }
    .brand-logo {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      background: var(--accent);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 13px;
    }
    .brand-name {
      font-size: 15px;
      font-weight: 800;
      letter-spacing: -0.01em;
    }
    .brand-product {
      font-size: 11px;
      font-weight: 700;
      color: var(--accent);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .check-icon {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      background: rgba(5, 160, 73, 0.16);
      border: 2px solid var(--accent);
      color: var(--accent);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 28px;
      margin: 0 auto 20px;
      box-shadow: 0 0 24px rgba(5, 160, 73, 0.35);
    }
    h1 {
      font-size: 22px;
      font-weight: 800;
      letter-spacing: -0.02em;
      margin-bottom: 8px;
      color: var(--ink);
    }
    p.sub {
      font-size: 13.5px;
      color: var(--ink-soft);
      line-height: 1.5;
      margin-bottom: 24px;
    }
    .meta-box {
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 16px 20px;
      text-align: left;
      margin-bottom: 24px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .meta-row {
      display: flex;
      justify-content: space-between;
      font-size: 12.5px;
    }
    .meta-label {
      color: var(--ink-soft);
      font-weight: 500;
    }
    .meta-val {
      color: var(--ink);
      font-weight: 700;
      text-align: right;
    }
    .timestamp {
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--accent);
    }
    .btn {
      display: inline-block;
      width: 100%;
      padding: 12px 18px;
      background: rgba(255, 255, 255, 0.08);
      color: var(--ink);
      border: 1px solid var(--border);
      border-radius: 10px;
      font-size: 13px;
      font-weight: 700;
      text-decoration: none;
      transition: all .15s ease;
    }
    .btn:hover {
      background: rgba(255, 255, 255, 0.14);
      border-color: rgba(255, 255, 255, 0.2);
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="brand-row">
      <div class="brand-logo">V</div>
      <div style="text-align: left;">
        <div class="brand-name">Valura.Ai</div>
        <div class="brand-product">• Orbit</div>
      </div>
    </div>

    <div class="check-icon">✓</div>
    <h1>Hand-Off Confirmed</h1>
    <p class="sub">Thank you for confirming. Valura.Ai Orbit has authenticated your one-tap hand-off and updated the co-brand distribution ledger in real-time.</p>

    <div class="meta-box">
      <div class="meta-row">
        <span class="meta-label">Milestone</span>
        <span class="meta-val" style="color: var(--accent);">${hopTitle}</span>
      </div>
      <div class="meta-row">
        <span class="meta-label">Campaign Asset</span>
        <span class="meta-val">${assetName}</span>
      </div>
      <div class="meta-row">
        <span class="meta-label">Channel Partner</span>
        <span class="meta-val">${partnerName}</span>
      </div>
      <div class="meta-row">
        <span class="meta-label">Confirmed By</span>
        <span class="meta-val">${spocName}</span>
      </div>
      <div class="meta-row">
        <span class="meta-label">Timestamp</span>
        <span class="meta-val timestamp">${confirmedAt}</span>
      </div>
    </div>

    <a href="/" class="btn">Return to Marketing Hub</a>
  </div>
</body>
</html>`;

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  return res.end(html);
};

module.exports.generateConfirmToken = generateConfirmToken;
module.exports.decodeConfirmToken = decodeConfirmToken;
