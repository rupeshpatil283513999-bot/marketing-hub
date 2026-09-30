/**
 * /api/send-mail (Vercel Serverless Function)
 *
 * Deterministic "Send to SPOC" direct email dispatch endpoint.
 * Calls the Resend API using the server-side environment variable
 * (RESEND_API_KEY or EMAIL_PROVIDER_API_KEY).
 *
 * API keys remain strictly on the server and are never exposed to the client.
 */

async function handler(req, res) {
  // Set CORS headers for all responses
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    if (typeof res.status === 'function') return res.status(204).end();
    res.writeHead(204);
    return res.end();
  }

  if (req.method !== 'POST') {
    const errorResponse = { status: 'error', error: 'Method not allowed. Use POST.' };
    if (typeof res.status === 'function') {
      return res.status(405).json(errorResponse);
    }
    res.writeHead(405, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(errorResponse));
  }

  try {
    const body = req.body || {};
    const {
      to,
      subject,
      body: textBody,
      html: htmlBody,
      attachmentUrl,
      attachments,
      taskId,
      partnerName,
      spocName,
    } = body;

    // Validate recipient
    if (!to || (Array.isArray(to) && to.length === 0)) {
      const err = { status: 'error', error: 'Recipient email ("to") is required.' };
      if (typeof res.status === 'function') return res.status(400).json(err);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(err));
    }

    const recipients = Array.isArray(to) ? to : [to];

    // Read API key strictly from server environment variables
    const apiKey = (process.env.RESEND_API_KEY || process.env.EMAIL_PROVIDER_API_KEY || '').trim();

    if (!apiKey && !body.simulate) {
      const err = {
        status: 'error',
        code: 'MISSING_API_KEY',
        error: 'Missing RESEND_API_KEY or EMAIL_PROVIDER_API_KEY in environment variables.',
        hint: 'Add your key to .env.local for local testing or Vercel Project Settings for production.',
      };
      if (typeof res.status === 'function') return res.status(400).json(err);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(err));
    }

    const fromAddress = (process.env.EMAIL_FROM || 'Marketing Hub <onboarding@resend.dev>').trim();
    const mailSubject = subject || (partnerName ? `Marketing Distribution Kit — ${partnerName}` : 'Update from Marketing Hub');

    // Simulated / mock dispatch if requested or mock key
    if (apiKey === 'mock' || (apiKey && apiKey.startsWith('mock_')) || process.env.MOCK_EMAIL === 'true' || body.simulate === true) {
      const successResponse = {
        status: 'sent',
        id: 'msg_resend_' + Math.random().toString(36).substring(2, 10),
        to: recipients,
        subject: mailSubject,
        taskId: taskId || null,
        partnerName: partnerName || null,
        at: new Date().toISOString(),
        simulated: true,
      };
      if (typeof res.status === 'function') return res.status(200).json(successResponse);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(successResponse));
    }

    // Build HTML representation
    const contentText = textBody || 'Please find the marketing distribution materials attached.';
    const formattedHtml = htmlBody || `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; color: #111827; line-height: 1.6;">
        <div style="padding: 20px 0; border-bottom: 2px solid #05a049;">
          <h2 style="margin: 0; color: #05a049; font-size: 20px; font-weight: 700;">Marketing Hub · Launch Automation</h2>
        </div>
        <div style="padding: 24px 0;">
          ${spocName ? `<p style="font-size: 15px; font-weight: 600; margin-top: 0;">Hi ${spocName},</p>` : ''}
          <div style="font-size: 14.5px; white-space: pre-wrap; color: #374151;">${contentText}</div>
          ${attachmentUrl ? `
            <div style="margin: 24px 0; padding: 14px 18px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px;">
              <span style="font-size: 13px; color: #6b7280; display: block; margin-bottom: 4px;">Shared Asset File:</span>
              <a href="${attachmentUrl}" target="_blank" style="color: #05a049; font-weight: 600; text-decoration: none; word-break: break-all;">
                📎 Open &amp; Download Attachment
              </a>
            </div>
          ` : ''}
        </div>
        <div style="padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af;">
          Sent securely via Marketing Management Hub · Valura.Ai
        </div>
      </div>
    `;

    // Build Resend payload
    const resendPayload = {
      from: fromAddress,
      to: recipients,
      subject: mailSubject,
      text: contentText,
      html: formattedHtml,
    };

    // Attachments handling
    if (Array.isArray(attachments) && attachments.length > 0) {
      resendPayload.attachments = attachments;
    } else if (attachmentUrl) {
      if (attachmentUrl.startsWith('data:')) {
        const parts = attachmentUrl.split(',');
        const base64Data = parts[1] || '';
        const filename = (body.asset && body.asset.filename) || 'creative-asset';
        resendPayload.attachments = [{ content: base64Data, filename }];
      } else {
        const filename = (body.asset && body.asset.filename) || attachmentUrl.split('?')[0].split('/').pop() || 'attachment';
        resendPayload.attachments = [{ path: attachmentUrl, filename }];
      }
    }

    // Call Resend API endpoint
    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(resendPayload),
    });

    const resendData = await resendResponse.json().catch(() => ({}));

    if (!resendResponse.ok) {
      const errorMsg = resendData.message || resendData.error || `Resend API returned status ${resendResponse.status}`;
      const err = {
        status: 'error',
        code: 'RESEND_API_ERROR',
        error: errorMsg,
        details: resendData,
      };
      if (typeof res.status === 'function') return res.status(resendResponse.status || 500).json(err);
      res.writeHead(resendResponse.status || 500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(err));
    }

    const successResponse = {
      status: 'sent',
      id: resendData.id,
      to: recipients,
      subject: mailSubject,
      taskId: taskId || null,
      partnerName: partnerName || null,
      at: new Date().toISOString(),
    };

    if (typeof res.status === 'function') {
      return res.status(200).json(successResponse);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(successResponse));
  } catch (error) {
    const catchError = {
      status: 'error',
      code: 'SERVER_ERROR',
      error: error.message || 'Internal server error while sending email.',
    };
    if (typeof res.status === 'function') {
      return res.status(500).json(catchError);
    }
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(catchError));
  }
}

module.exports = handler;
module.exports.default = handler;
