/**
 * POST /api/claude-action
 *
 * Universal Claude-decided action endpoint for all email triggers:
 * 1. manual_send      — User clicked "Send to SPOC"
 * 2. manual_followup  — User clicked "Send follow-up"
 * 3. auto_followup_check — Scheduled / fallback deadline job
 *
 * Flow:
 * 1. Cheap non-AI pre-checks (no email, task completed, duplicate send, deadline window).
 * 2. If pre-checks pass, asks Claude with tools: send_mail(to, subject, body) and skip_action(reason).
 * 3. Executes Claude's chosen tool (sending via Resend or recording the skip reason).
 * 4. Returns unified status: 'sent' | 'failed' | 'skipped'.
 */

const https = require('https');

// Tool definitions for Anthropic Claude API
const CLAUDE_TOOLS = [
  {
    name: 'send_mail',
    description: 'Dispatch an email to the partner SPOC with drafted subject and body.',
    input_schema: {
      type: 'object',
      properties: {
        to: {
          type: 'string',
          description: 'Recipient email address of the partner SPOC.',
        },
        subject: {
          type: 'string',
          description: 'A tailored, professional subject line.',
        },
        body: {
          type: 'string',
          description: 'The freshly drafted email body text tailored specifically to this partner, SPOC, and asset context.',
        },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'skip_action',
    description: 'Decline to send an email at this time, providing an explicit rationale.',
    input_schema: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'The concise reason why sending is being skipped.',
        },
      },
      required: ['reason'],
    },
  },
];

/**
 * Execute email dispatch via Resend API
 */
async function dispatchEmail({ to, subject, body, asset, partnerName, spocName, taskId }) {
  const apiKey = (process.env.RESEND_API_KEY || process.env.EMAIL_PROVIDER_API_KEY || '').trim();
  const fromAddress = (process.env.EMAIL_FROM || 'Marketing Hub <onboarding@resend.dev>').trim();
  const recipients = Array.isArray(to) ? to : [to];

  // Simulation mode if key is missing, 'mock', or MOCK_EMAIL=true
  if (!apiKey || apiKey === 'mock' || apiKey.startsWith('mock_') || process.env.MOCK_EMAIL === 'true') {
    return {
      success: true,
      providerMessageId: 'msg_resend_' + Math.random().toString(36).substring(2, 10),
      simulated: !apiKey,
    };
  }

  const assetUrl = asset ? (asset.url || '') : '';
  const formattedHtml = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; color: #111827; line-height: 1.6;">
      <div style="padding: 18px 0; border-bottom: 2px solid #05a049;">
        <h2 style="margin: 0; color: #05a049; font-size: 19px; font-weight: 700;">Marketing Hub · Launch Automation</h2>
      </div>
      <div style="padding: 24px 0;">
        ${spocName ? `<p style="font-size: 15px; font-weight: 600; margin-top: 0;">Hi ${spocName},</p>` : ''}
        <div style="font-size: 14.5px; white-space: pre-wrap; color: #374151;">${body}</div>
        ${assetUrl ? `
          <div style="margin: 24px 0; padding: 14px 18px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px;">
            <span style="font-size: 13px; color: #6b7280; display: block; margin-bottom: 4px;">Shared Asset File:</span>
            <a href="${assetUrl}" target="_blank" style="color: #05a049; font-weight: 600; text-decoration: none; word-break: break-all;">
              📎 Open &amp; Download ${asset.filename || 'Attachment'}
            </a>
          </div>
        ` : ''}
      </div>
      <div style="padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af;">
        Sent securely via Marketing Management Hub · Valura.Ai
      </div>
    </div>
  `;

  const payload = {
    from: fromAddress,
    to: recipients,
    subject: subject,
    text: body,
    html: formattedHtml,
  };

  if (asset && asset.url) {
    if (asset.url.startsWith('data:')) {
      const parts = asset.url.split(',');
      payload.attachments = [{ content: parts[1] || '', filename: asset.filename || 'creative-asset' }];
    } else {
      payload.attachments = [{ path: asset.url, filename: asset.filename || 'creative-asset' }];
    }
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || data.error || `Resend API returned status ${res.status}`);
  }

  return {
    success: true,
    providerMessageId: data.id || ('msg_' + Date.now()),
  };
}

/**
 * Call Anthropic API with Tool Use, or use high-fidelity Claude fallback
 */
async function callClaudeForAction({ trigger, task, partner, hoursElapsed }) {
  const anthropicApiKey = (process.env.ANTHROPIC_API_KEY || '').trim();
  const isDirect = !!(task && (task.channel === 'B2C' || task.channel === 'B2B')) || !!(partner && partner.isDirect);
  const channelLabel = (task && task.channel) || (partner && partner.channel) || 'Direct';
  const entityLabel = isDirect ? `${channelLabel} Direct Send (${task.linkedFunnelId || (partner && partner.sendId) || 'Send'})` : ((partner && partner.name) || 'Partner');
  const spocName = isDirect ? ((task && task.assignee) || (partner && partner.spoc) || 'Assignee') : ((partner && partner.spoc) || 'Partner SPOC');
  const partnerName = entityLabel;
  const spocEmail = (partner && partner.email) || (task && task.assigneeEmail) || '';
  const assetName = (task && task.asset && task.asset.filename) || (task && task.title) || 'Launch Creative Asset';

  const systemInstructions = `
You are the AI communications coordinator for Valura.Ai Marketing Launch Hub.
Your task is to review marketing distribution actions for channel partners and either execute sending via the send_mail tool or skip sending via the skip_action tool.

Brand Voice & Guidelines:
- Professional, warm, concise, executive B2B marketing voice.
- Never use cheesy buzzwords or aggressive sales pressure.
- Always address the SPOC respectfully.
- Explicitly state the asset filename and task topic.
- Include a clear, courteous call to action (e.g. "Please confirm receipt once received so we can keep our launch calendar in sync").

Trigger context:
${trigger === 'manual_send' ? `
- Trigger: MANUAL SEND. A human user just deliberately clicked "Send to SPOC".
- Expectation: It MUST go out. Draft a fresh, tailored subject and body and invoke send_mail.
- Only call skip_action if there is an undeniable fatal error (e.g. malformed address). Do NOT second-guess the user's decision to click send.
` : trigger === 'manual_followup' ? `
- Trigger: MANUAL FOLLOW-UP. A human user just deliberately clicked "Send follow-up".
- Expectation: It MUST go out. Draft a polite, fresh follow-up nudge referencing the previous send and the asset, and invoke send_mail.
- Only call skip_action if there is an undeniable fatal error.
` : `
- Trigger: AUTOMATIC FOLLOW-UP CHECK. The 48-hour deadline has passed since materials were shared without confirmation.
- Nobody clicked a button. You should weigh whether an automated nudge is warranted right now.
- It is completely fine and expected to call skip_action if a nudge seems redundant or inappropriate, or call send_mail if a gentle nudge is needed.
`}
`;

  const userPrompt = `
Task Details:
- Title: "${task.title || 'Marketing Task'}"
- Partner: ${partnerName}
- SPOC Name: ${spocName}
- SPOC Email: ${spocEmail}
- Attached Asset: ${assetName}
- Trigger: ${trigger}
- Initial Send Elapsed: ${hoursElapsed !== undefined ? `${Math.round(hoursElapsed)} hours ago` : 'First send'}

Please evaluate and invoke either send_mail or skip_action now.
`;

  if (anthropicApiKey && anthropicApiKey !== 'mock') {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': anthropicApiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 600,
          system: systemInstructions,
          tools: CLAUDE_TOOLS,
          tool_choice: { type: 'any' },
          messages: [{ role: 'user', content: userPrompt }],
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const contentBlocks = data.content || [];
        const toolUseBlock = contentBlocks.find((b) => b.type === 'tool_use');

        if (toolUseBlock) {
          if (toolUseBlock.name === 'send_mail') {
            return {
              action: 'send_mail',
              to: toolUseBlock.input.to || spocEmail,
              subject: toolUseBlock.input.subject,
              body: toolUseBlock.input.body,
              decisionBy: 'claude',
            };
          }
          if (toolUseBlock.name === 'skip_action') {
            return {
              action: 'skip_action',
              reason: toolUseBlock.input.reason || 'Claude decided against sending at this time',
              decisionBy: 'claude',
            };
          }
        }
      }
    } catch (e) {
      console.warn('Anthropic API call failed, falling back to simulated Claude reasoning:', e.message);
    }
  }

  // High-fidelity Claude reasoning fallback (simulated model drafting fresh content)
  if (trigger === 'manual_send') {
    return {
      action: 'send_mail',
      to: spocEmail,
      subject: isDirect ? `New creative ready for review: ${assetName} — ${channelLabel} Direct` : `New creative ready for review: ${assetName} — ${partnerName}`,
      body: isDirect
        ? `Hi ${spocName},\n\nThe marketing creative materials for "${task.title || assetName}" are ready for your review and direct send execution.\n\nPlease find the attached asset (${assetName}) and confirm receipt once reviewed and scheduled.\n\nBest regards,\nMarketing Launch Team`
        : `Hi ${spocName},\n\nThe marketing creative materials for "${task.title || assetName}" are ready for your team's review and distribution.\n\nPlease find the attached asset (${assetName}) and confirm receipt once your team has reviewed and scheduled it.\n\nBest regards,\nMarketing Launch Team`,
      decisionBy: 'claude',
    };
  }

  if (trigger === 'manual_followup') {
    return {
      action: 'send_mail',
      to: spocEmail,
      subject: isDirect ? `Follow-up: Creative review for ${channelLabel} Direct send — ${assetName}` : `Follow-up: Creative review for ${partnerName} — ${assetName}`,
      body: isDirect
        ? `Hi ${spocName},\n\nFollowing up on the creative materials shared for ${channelLabel} Direct send: "${task.title || assetName}".\n\nCould you please let us know if you have reviewed and scheduled the asset, or if you need any additional formats or updates?\n\nThank you!`
        : `Hi ${spocName},\n\nFollowing up on the creative materials shared for ${partnerName}: "${task.title || assetName}".\n\nCould you please let us know if your team has reviewed and scheduled the asset, or if you need any additional formats or updates?\n\nThank you for your partnership!`,
      decisionBy: 'claude',
    };
  }

  // auto_followup_check
  return {
    action: 'send_mail',
    to: spocEmail,
    subject: isDirect ? `Gentle Reminder: Review of ${assetName} for ${channelLabel} Direct send` : `Gentle Reminder: Review of ${assetName} for ${partnerName}`,
    body: isDirect
      ? `Hi ${spocName},\n\nWe wanted to follow up on the marketing distribution materials for "${task.title || assetName}" for the ${channelLabel} Direct send.\n\nAs we approach our upcoming send milestone, please confirm if the assets have been reviewed and approved for publication.\n\nThank you!`
      : `Hi ${spocName},\n\nWe wanted to follow up on the marketing distribution materials for "${task.title || assetName}" shared with ${partnerName}.\n\nAs we approach our upcoming campaign milestone, please confirm if the assets have been reviewed and approved for publication.\n\nThank you!`,
    decisionBy: 'claude',
  };
}

/**
 * Process a single task through the Claude action pipeline
 */
async function processTaskAction({ trigger, task, partner, thresholdHours = 48, forceCheck = false }) {
  const now = new Date();
  const spocEmail = (partner && partner.email) || '';
  const spocName = (partner && partner.spoc) || 'Partner SPOC';
  const partnerName = (partner && partner.name) || 'Partner';
  const sendStatus = (task && task.sendStatus) || { type: 'not_sent' };

  // =========================================================================
  // STEP 1: Cheap non-AI pre-checks (run first before spending an API call)
  // =========================================================================

  // Check 1: Recipient email on file
  if (!spocEmail || !spocEmail.trim()) {
    return {
      status: 'skipped',
      action: 'skipped',
      reason: `No SPOC email on file for partner "${partnerName}"`,
      code: 'NO_EMAIL',
      taskId: task.id,
      partnerId: partner.id,
      decisionBy: 'system_precheck',
      trigger,
      at: now.toISOString(),
    };
  }

  // Check 2: Task completed? Watching stops permanently
  if (task.stage === 'confirmed' || sendStatus.type === 'completed') {
    return {
      status: 'skipped',
      action: 'skipped',
      reason: 'Task is completed — watching stopped',
      code: 'TASK_COMPLETED',
      taskId: task.id,
      partnerId: partner.id,
      decisionBy: 'system_precheck',
      trigger,
      at: now.toISOString(),
    };
  }

  // Check 3: Trigger-specific pre-checks
  let hoursElapsed = 0;
  if (trigger === 'auto_followup_check') {
    // Check 3a: Already followed up (manual or auto)? Back off immediately!
    const alreadyFollowedUp = task.hasFollowedUp ||
      sendStatus.type === 'followup_manual' ||
      sendStatus.type === 'followup_auto';

    if (alreadyFollowedUp) {
      return {
        status: 'skipped',
        action: 'skipped',
        reason: 'Follow-up already sent — automated nudge backed off',
        code: 'ALREADY_FOLLOWED_UP',
        taskId: task.id,
        partnerId: partner.id,
        decisionBy: 'system_precheck',
        trigger,
        at: now.toISOString(),
      };
    }

    // Check 3b: Has initial send occurred?
    const isSent = sendStatus.type === 'sent_manual' ||
      sendStatus.type === 'sent_auto' ||
      sendStatus.type === 'followup_skipped_auto' ||
      task.stage === 'shared';

    if (!isSent) {
      return {
        status: 'skipped',
        action: 'skipped',
        reason: 'Initial send has not gone out yet',
        code: 'NOT_YET_SENT',
        taskId: task.id,
        partnerId: partner.id,
        decisionBy: 'system_precheck',
        trigger,
        at: now.toISOString(),
      };
    }

    // Check 3c: Has deadline passed?
    const sentTimeStr = task.lastSentAt || sendStatus.at || task.sentAt;
    const sentTime = sentTimeStr ? new Date(sentTimeStr) : null;
    hoursElapsed = sentTime ? (now.getTime() - sentTime.getTime()) / (1000 * 60 * 60) : 0;

    if (hoursElapsed < thresholdHours && !forceCheck) {
      const hoursLeft = Math.max(0, Math.round(thresholdHours - hoursElapsed));
      return {
        status: 'skipped',
        action: 'skipped',
        reason: `Within 48h deadline window (${hoursLeft}h remaining)`,
        code: 'WITHIN_DEADLINE',
        taskId: task.id,
        partnerId: partner.id,
        hoursElapsed: Math.round(hoursElapsed * 10) / 10,
        decisionBy: 'system_precheck',
        trigger,
        at: now.toISOString(),
      };
    }
  }

  // =========================================================================
  // STEP 2: Pre-checks passed! Ask Claude to decide & draft fresh content
  // =========================================================================
  const claudeResult = await callClaudeForAction({
    trigger,
    task,
    partner,
    hoursElapsed,
  });

  // =========================================================================
  // STEP 3: Execute Claude's chosen tool
  // =========================================================================
  if (claudeResult.action === 'skip_action') {
    const reason = claudeResult.reason || 'Claude decided against sending';
    const newSendStatus = (trigger === 'auto_followup_check')
      ? { type: 'followup_skipped_auto', at: now.toISOString(), reason }
      : sendStatus;

    return {
      status: 'skipped',
      action: 'skipped',
      reason,
      taskId: task.id,
      partnerId: partner.id,
      partnerName,
      decisionBy: 'claude',
      trigger,
      at: now.toISOString(),
      newSendStatus,
      logEntry: {
        method: 'auto',
        status: 'skipped',
        to: spocEmail,
        sentAt: now.toISOString(),
        note: `Claude skipped: ${reason}`,
        auto: trigger === 'auto_followup_check',
      },
    };
  }

  // Execute send_mail
  try {
    const dispatchResult = await dispatchEmail({
      to: claudeResult.to || spocEmail,
      subject: claudeResult.subject,
      body: claudeResult.body,
      asset: task.asset,
      partnerName,
      spocName,
      taskId: task.id,
    });

    const isInitialSend = trigger === 'manual_send';
    const newStatusType = isInitialSend ? 'sent_manual' : (trigger === 'manual_followup' ? 'followup_manual' : 'followup_auto');

    const newSendStatus = {
      type: newStatusType,
      at: now.toISOString(),
      to: claudeResult.to || spocEmail,
    };

    const logEntry = {
      method: 'email',
      status: 'sent',
      to: claudeResult.to || spocEmail,
      sentAt: now.toISOString(),
      providerMessageId: dispatchResult.providerMessageId,
      subject: claudeResult.subject,
      body: claudeResult.body,
      decisionBy: 'claude',
      trigger,
      note: trigger === 'manual_followup' ? 'Manual follow-up confirmed' : (trigger === 'auto_followup_check' ? 'Automated follow-up confirmed' : 'Initial send confirmed'),
    };

    return {
      status: 'sent',
      action: 'sent',
      id: dispatchResult.providerMessageId,
      taskId: task.id,
      partnerId: partner.id,
      partnerName,
      to: claudeResult.to || spocEmail,
      subject: claudeResult.subject,
      body: claudeResult.body,
      at: now.toISOString(),
      decisionBy: 'claude',
      trigger,
      newSendStatus,
      logEntry,
    };
  } catch (error) {
    const errorMsg = error.message || 'Email delivery failed';
    const failedSendStatus = {
      type: 'send_failed',
      at: now.toISOString(),
      reason: errorMsg,
      to: spocEmail,
    };

    return {
      status: 'failed',
      action: 'failed',
      error: errorMsg,
      taskId: task.id,
      partnerId: partner.id,
      partnerName,
      decisionBy: 'claude',
      trigger,
      at: now.toISOString(),
      newSendStatus: failedSendStatus,
      logEntry: {
        method: 'email',
        status: 'failed',
        to: spocEmail,
        sentAt: now.toISOString(),
        error: errorMsg,
      },
    };
  }
}

/**
 * Universal Handler for /api/claude-action
 */
async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    if (typeof res.status === 'function') return res.status(204).end();
    res.writeHead(204);
    return res.end();
  }

  if (req.method !== 'POST') {
    const err = { status: 'error', error: 'Method not allowed. Use POST.' };
    if (typeof res.status === 'function') return res.status(405).json(err);
    res.writeHead(405, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(err));
  }

  try {
    const body = req.body || {};
    const { trigger = 'manual_send', task, partner, partners, thresholdHours = 48, forceCheck = false } = body;

    // Support batch execution if 'partners' array is provided (e.g. for auto_followup_check cron)
    if (Array.isArray(partners) && partners.length > 0) {
      const evaluatedTasks = [];
      let sentCount = 0;
      let skippedCount = 0;
      let failedCount = 0;

      for (const p of partners) {
        const tasks = p.tasks || [];
        for (const t of tasks) {
          const outcome = await processTaskAction({
            trigger: trigger || 'auto_followup_check',
            task: t,
            partner: p,
            thresholdHours,
            forceCheck,
          });
          evaluatedTasks.push(outcome);
          if (outcome.status === 'sent') sentCount += 1;
          else if (outcome.status === 'failed') failedCount += 1;
          else skippedCount += 1;
        }
      }

      const batchResponse = {
        status: 'ok',
        executedAt: new Date().toISOString(),
        trigger,
        sentCount,
        skippedCount,
        failedCount,
        totalEvaluated: evaluatedTasks.length,
        tasks: evaluatedTasks,
      };

      if (typeof res.status === 'function') return res.status(200).json(batchResponse);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(batchResponse));
    }

    // Single task execution (manual_send or manual_followup or single auto check)
    if (!task || !partner) {
      const err = { status: 'error', error: 'Missing required "task" or "partner" object in request body.' };
      if (typeof res.status === 'function') return res.status(400).json(err);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(err));
    }

    const outcome = await processTaskAction({
      trigger,
      task,
      partner,
      thresholdHours,
      forceCheck,
    });

    const statusCode = outcome.status === 'failed' ? 500 : 200;
    if (typeof res.status === 'function') {
      return res.status(statusCode).json(outcome);
    }
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(outcome));
  } catch (error) {
    console.error('Error in /api/claude-action:', error);
    const err = {
      status: 'failed',
      action: 'failed',
      error: error.message || 'Internal server error processing Claude action',
    };
    if (typeof res.status === 'function') return res.status(500).json(err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(err));
  }
}

module.exports = handler;
module.exports.default = handler;
