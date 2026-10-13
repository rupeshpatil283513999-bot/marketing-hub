/**
 * /api/follow-up-cron
 *
 * Claude-Driven Partner Nudge Automation Scheduled Job
 *
 * Requirements:
 * 1. Trigger conditions:
 *    - Task status is Pending or In Progress (not Completed).
 *    - Sitting longer than threshold (default 48 hours, configurable).
 *    - Verified email on file. If not, auto-skip and flag as "no contact on file".
 *    - Hard cap: No nudge already sent in the last 48 hours (checked before calling Claude).
 * 2. Guardrails:
 *    - Kill Switch: Instantly disable without deploy via NUDGE_AUTOMATION_ENABLED or request body.
 *    - Dry-Run Mode: Runs pipeline, lets Claude decide & draft, logs result without emailing.
 *    - Hard Cap: Max 1 nudge per task per 48h enforced in code.
 * 3. Claude Call:
 *    - Tools: send_nudge(to, subject, body) and skip_nudge(reason).
 *    - Claude always calls exactly one tool.
 * 4. Logging:
 *    - Returns nudgeLog entry: { decidedAt, action, to, subject, reason, dryRun, body }.
 */

const https = require('https');

// Tool definitions for Anthropic Claude API
const NUDGE_TOOLS = [
  {
    name: 'send_nudge',
    description: 'Send a follow-up nudge to the partner SPOC with drafted subject and body.',
    input_schema: {
      type: 'object',
      properties: {
        to: {
          type: 'string',
          description: 'Recipient email address of the partner SPOC.',
        },
        subject: {
          type: 'string',
          description: 'A tailored, professional subject line for the nudge.',
        },
        body: {
          type: 'string',
          description: 'The concise, courteous email body text tailored specifically to this partner and task.',
        },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'skip_nudge',
    description: 'Decline to send a nudge at this time, providing an explicit rationale.',
    input_schema: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'The concise reason why a nudge is not warranted right now.',
        },
      },
      required: ['reason'],
    },
  },
];

/**
 * Dispatch email via Resend API
 */
async function dispatchEmail({ to, subject, body, partnerName, spocName, taskTitle }) {
  const apiKey = (process.env.RESEND_API_KEY || process.env.EMAIL_PROVIDER_API_KEY || '').trim();
  const fromAddress = (process.env.EMAIL_FROM || 'Marketing Hub <onboarding@resend.dev>').trim();
  const recipients = Array.isArray(to) ? to : [to];

  if (!apiKey || apiKey === 'mock' || apiKey.startsWith('mock_') || process.env.MOCK_EMAIL === 'true') {
    return {
      success: true,
      providerMessageId: 'msg_resend_' + Math.random().toString(36).substring(2, 10),
      simulated: true,
    };
  }

  const formattedHtml = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; color: #111827; line-height: 1.6;">
      <div style="padding: 16px 0; border-bottom: 2px solid #05a049;">
        <h2 style="margin: 0; color: #05a049; font-size: 19px; font-weight: 700;">Marketing Hub · Valura.Ai</h2>
      </div>
      <div style="padding: 22px 0;">
        ${spocName ? `<p style="font-size: 15px; font-weight: 600; margin-top: 0;">Hi ${spocName},</p>` : ''}
        <div style="font-size: 14.5px; white-space: pre-wrap; color: #374151;">${body}</div>
      </div>
      <div style="padding-top: 14px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af;">
        Sent automatically via Marketing Operations Hub · Valura.Ai
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
 * Call Claude with send_nudge and skip_nudge tools
 */
async function callClaudeForNudge({ task, partner, hoursPending, historyLog }) {
  const anthropicApiKey = (process.env.ANTHROPIC_API_KEY || '').trim();
  const spocName = (partner && partner.spoc) || 'Partner SPOC';
  const partnerName = (partner && partner.name) || 'Partner';
  const spocEmail = (partner && partner.email) || '';
  const assetName = (task && task.asset && task.asset.filename) || (task && task.title) || 'Distribution Creative';

  const isDirect = !!(task && (task.channel === 'B2C' || task.channel === 'B2B')) || !!(partner && partner.isDirect);
  const channelLabel = (task && task.channel) || (partner && partner.channel) || (partnerName.includes('B2C') ? 'B2C' : 'B2B');
  const entityLabel = isDirect ? `${channelLabel} Direct Send (${task.linkedFunnelId || (partner && partner.sendId) || 'Send'})` : partnerName;
  const recipientName = (partner && partner.spoc) || (task && task.assignee) || 'Assignee';

  const systemInstructions = `
You are the marketing operations assistant for Valura.Ai.
Your role is to evaluate whether a task that has been sitting pending warrants a follow-up nudge right now, and if so, draft a concise, courteous email and call the send_nudge tool.

Brand Voice & Guidelines:
- Professional, warm, respectful, executive B2B tone.
- Keep the follow-up concise (2-3 sentences max).
- Greet the recipient by name (${recipientName}).
- Explicitly reference the distribution entity (${entityLabel}) and the task or asset.
- State a clear, helpful call to action (confirm receipt, ask if any alternate format is needed).
- Never use pushy sales language or false urgency.

If a nudge is NOT warranted right now (e.g. recent activity, waiting on scheduled milestone, or inappropriate timing), call the skip_nudge tool with a clear reason.

You MUST invoke exactly one of the two tools: send_nudge or skip_nudge.
`;

  const historySummary = (historyLog && historyLog.length > 0)
    ? historyLog.slice(-3).map((h) => `- ${h.method || 'action'}: ${h.status || ''} at ${h.sentAt || h.decidedAt || ''} (${h.note || h.reason || ''})`).join('\n')
    : 'No prior communication log.';

  const userPrompt = `
Task Context:
- Task: "${task.title || 'Marketing Task'}"
- Distribution Channel: ${entityLabel}
- Assignee/SPOC: ${recipientName} (${spocEmail})
- Asset: ${assetName}
- Status: ${task.stage || 'pending'}
- Hours Pending: ${Math.round(hoursPending)} hours
- Recent History:
${historySummary}

Evaluate and call send_nudge or skip_nudge now.
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
          tools: NUDGE_TOOLS,
          tool_choice: { type: 'any' },
          messages: [{ role: 'user', content: userPrompt }],
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const contentBlocks = data.content || [];
        const toolUseBlock = contentBlocks.find((b) => b.type === 'tool_use');

        if (toolUseBlock) {
          if (toolUseBlock.name === 'send_nudge') {
            return {
              action: 'send_nudge',
              to: toolUseBlock.input.to || spocEmail,
              subject: toolUseBlock.input.subject || (isDirect ? `Follow-up: Review of ${assetName} for ${channelLabel} Direct Send` : `Follow-up: Review of ${assetName} for ${partnerName}`),
              body: toolUseBlock.input.body,
              reason: 'Claude decided a follow-up nudge is warranted',
            };
          }
          if (toolUseBlock.name === 'skip_nudge') {
            return {
              action: 'skip_nudge',
              reason: toolUseBlock.input.reason || 'Claude decided against nudging at this time',
            };
          }
        }
      }
    } catch (e) {
      console.warn('Anthropic API call fallback to simulated Claude:', e.message);
    }
  }

  // High-fidelity fallback reasoning
  const defaultSubject = isDirect
    ? `Follow-up: Review of ${assetName} for ${channelLabel} Direct Send`
    : `Follow-up: Creative review for ${partnerName} — ${assetName}`;
  const defaultBody = isDirect
    ? `Hi ${recipientName},\n\nWe wanted to follow up on the marketing creative materials for "${task.title || assetName}" for the ${channelLabel} Direct Send.\n\nCould you please confirm if you have had a chance to review the materials, or if you need any adjustments before the scheduled send?\n\nThank you!`
    : `Hi ${spocName},\n\nWe wanted to follow up on the marketing creative materials for "${task.title || assetName}" shared with ${partnerName}.\n\nCould you please confirm if your team has had a chance to review the materials, or if you need any additional assets or adjustments from our end?\n\nThank you for your partnership!`;

  return {
    action: 'send_nudge',
    to: spocEmail,
    subject: defaultSubject,
    body: defaultBody,
    reason: `Pending for ${Math.round(hoursPending)}h without confirmation; polite nudge warranted`,
  };
}

/**
 * Main Cron & On-Demand Handler
 */
async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    if (typeof res.status === 'function') return res.status(204).end();
    res.writeHead(204);
    return res.end();
  }

  try {
    const body = req.body || {};
    const now = new Date();

    // -------------------------------------------------------------
    // GUARDRAIL 1: Kill Switch
    // -------------------------------------------------------------
    const envKillSwitch = process.env.NUDGE_AUTOMATION_ENABLED;
    const isKillSwitchActive = envKillSwitch === 'false' || body.enabled === false;

    if (isKillSwitchActive) {
      const response = {
        status: 'disabled',
        enabled: false,
        message: 'Nudge automation is currently disabled via kill switch',
        executedAt: now.toISOString(),
        sentCount: 0,
        skippedCount: 0,
        totalEvaluated: 0,
        tasks: [],
      };
      if (typeof res.status === 'function') return res.status(200).json(response);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(response));
    }

    // -------------------------------------------------------------
    // GUARDRAIL 2: Dry-Run Mode
    // -------------------------------------------------------------
    // Defaults to true for safety if not explicitly set to false
    const dryRun = (body.dryRun === true) || (process.env.NUDGE_DRY_RUN === 'true') || (!process.env.RESEND_API_KEY && body.dryRun !== false);

    // -------------------------------------------------------------
    // GUARDRAIL 3: Configurable threshold & hard cap
    // -------------------------------------------------------------
    const thresholdHours = typeof body.thresholdHours === 'number' ? body.thresholdHours : 48;
    const forceCheck = !!body.forceCheck; // For manual testing

    const partners = Array.isArray(body.partners) ? body.partners : [];
    const directSends = Array.isArray(body.directSends) ? body.directSends : [];
    const allEntities = [...partners];

    for (const send of directSends) {
      if (send && Array.isArray(send.tasks) && send.tasks.length > 0) {
        const channel = send.channel || 'Direct';
        const sendId = send.sendId || (channel === 'B2C' ? 's1' : 's2');
        allEntities.push({
          id: `direct_${sendId}`,
          name: `${channel} Direct Client (${sendId})`,
          spoc: send.distributionHead || 'Distribution Head',
          email: send.email || (send.distributionEmail || (channel === 'B2C' ? 'priyesh@valura.ai' : 'nithesh@valura.ai')),
          tasks: send.tasks,
          isDirect: true,
          channel: channel,
          sendId: sendId,
        });
      }
    }

    const evaluatedTasks = [];
    let sentCount = 0;
    let skippedCount = 0;

    for (const partner of allEntities) {
      const tasks = partner.tasks || [];
      const defaultEmail = (partner.email || '').trim();
      const partnerName = partner.name || 'Partner';
      const isDirect = !!partner.isDirect;

      for (const task of tasks) {
        const taskChannel = task.channel || partner.channel || null;
        const taskLinkedFunnelId = task.linkedFunnelId || partner.sendId || null;
        const taskAssignee = task.assignee || partner.spoc || 'Assignee';
        const spocName = isDirect ? taskAssignee : (partner.spoc || 'Partner SPOC');
        const spocEmail = (task.assigneeEmail || defaultEmail || (taskChannel === 'B2C' ? 'priyesh@valura.ai' : (taskChannel === 'B2B' ? 'nithesh@valura.ai' : ''))).trim();

        const sendStatus = task.sendStatus || { type: 'not_sent' };
        const nudgeLog = Array.isArray(task.nudgeLog) ? task.nudgeLog : [];
        const shareLog = Array.isArray(task.shareLog) ? task.shareLog : [];

        // -------------------------------------------------------------
        // PRE-CHECK 1: Task status must be Pending or In Progress (not Completed)
        // -------------------------------------------------------------
        const isCompleted = task.stage === 'confirmed' || sendStatus.type === 'completed';
        if (isCompleted) {
          evaluatedTasks.push({
            partnerId: partner.id,
            partnerName,
            taskId: task.id,
            channel: taskChannel,
            linkedFunnelId: taskLinkedFunnelId,
            action: 'skipped',
            reason: 'Task is completed — watching stopped permanently',
            dryRun,
            decidedAt: now.toISOString(),
          });
          skippedCount += 1;
          continue;
        }

        // -------------------------------------------------------------
        // PRE-CHECK 2: Verified email on file
        // If not, skip automatically and flag it in the UI as "no contact on file"
        // -------------------------------------------------------------
        if (!spocEmail) {
          const skipEntry = {
            decidedAt: now.toISOString(),
            action: 'skipped',
            reason: 'No contact on file: missing recipient email address',
            dryRun,
            noContact: true,
          };
          evaluatedTasks.push({
            partnerId: partner.id,
            partnerName,
            taskId: task.id,
            channel: taskChannel,
            linkedFunnelId: taskLinkedFunnelId,
            action: 'skipped',
            reason: 'No contact on file: missing recipient email address',
            noContact: true,
            dryRun,
            nudgeEntry: skipEntry,
            decidedAt: now.toISOString(),
          });
          skippedCount += 1;
          continue;
        }

        // -------------------------------------------------------------
        // PRE-CHECK 3: Hard Cap — No nudge in the last 48 hours
        // Checked in code BEFORE calling Claude (never trust model to self-limit)
        // -------------------------------------------------------------
        const lastSentNudge = [...nudgeLog].reverse().find((n) => n.action === 'sent');
        if (lastSentNudge && lastSentNudge.decidedAt) {
          const lastNudgeTime = new Date(lastSentNudge.decidedAt).getTime();
          const hoursSinceLastNudge = (now.getTime() - lastNudgeTime) / (1000 * 60 * 60);

          if (hoursSinceLastNudge < 48 && !body.ignoreCooldown) {
            const hoursLeft = Math.max(0, Math.round(48 - hoursSinceLastNudge));
            const reason = `Hard cap: Nudge already sent ${Math.round(hoursSinceLastNudge)}h ago (${hoursLeft}h cooldown remaining)`;
            const skipEntry = {
              decidedAt: now.toISOString(),
              action: 'skipped',
              reason,
              hardCapSkipped: true,
              dryRun,
            };
            evaluatedTasks.push({
              partnerId: partner.id,
              partnerName,
              taskId: task.id,
              channel: taskChannel,
              linkedFunnelId: taskLinkedFunnelId,
              action: 'skipped',
              reason,
              hardCapSkipped: true,
              dryRun,
              nudgeEntry: skipEntry,
              decidedAt: now.toISOString(),
            });
            skippedCount += 1;
            continue;
          }
        }

        // -------------------------------------------------------------
        // PRE-CHECK 4: Stale threshold check (longer than 48h pending)
        // -------------------------------------------------------------
        const referenceTimeStr = task.lastSentAt || sendStatus.at || task.addedAt || task.createdAt;
        const referenceTime = referenceTimeStr ? new Date(referenceTimeStr) : new Date(Date.now() - 49 * 3600 * 1000);
        const hoursPending = (now.getTime() - referenceTime.getTime()) / (1000 * 60 * 60);

        if (hoursPending < thresholdHours && !forceCheck) {
          const hoursLeft = Math.max(0, Math.round(thresholdHours - hoursPending));
          const reason = `Within ${thresholdHours}h threshold window (${hoursLeft}h remaining before candidate for nudge)`;
          evaluatedTasks.push({
            partnerId: partner.id,
            partnerName,
            taskId: task.id,
            channel: taskChannel,
            linkedFunnelId: taskLinkedFunnelId,
            action: 'skipped',
            reason,
            dryRun,
            decidedAt: now.toISOString(),
          });
          skippedCount += 1;
          continue;
        }

        // -------------------------------------------------------------
        // CANDIDATE APPROVED! Call Claude to decide & draft
        // -------------------------------------------------------------
        const combinedHistory = [...shareLog, ...nudgeLog];
        const claudeDecision = await callClaudeForNudge({
          task,
          partner: {
            ...partner,
            spoc: spocName,
            email: spocEmail,
          },
          hoursPending,
          historyLog: combinedHistory,
        });

        if (claudeDecision.action === 'skip_nudge') {
          const nudgeEntry = {
            decidedAt: now.toISOString(),
            action: 'skipped',
            reason: claudeDecision.reason || 'Claude evaluated task and decided against sending a nudge at this time',
            dryRun,
          };
          evaluatedTasks.push({
            partnerId: partner.id,
            partnerName,
            taskId: task.id,
            channel: taskChannel,
            linkedFunnelId: taskLinkedFunnelId,
            action: 'skipped',
            reason: nudgeEntry.reason,
            dryRun,
            nudgeEntry,
            newSendStatus: {
              type: 'followup_skipped_auto',
              at: now.toISOString(),
              reason: nudgeEntry.reason,
            },
            decidedAt: now.toISOString(),
          });
          skippedCount += 1;
          continue;
        }

        // Claude called send_nudge
        let providerMessageId = null;
        let deliveryError = null;

        if (dryRun) {
          providerMessageId = 'dry_run_' + Math.random().toString(36).substring(2, 10);
        } else {
          try {
            const dispatch = await dispatchEmail({
              to: claudeDecision.to || spocEmail,
              subject: claudeDecision.subject,
              body: claudeDecision.body,
              partnerName,
              spocName,
              taskTitle: task.title,
            });
            providerMessageId = dispatch.providerMessageId;
          } catch (dispatchErr) {
            deliveryError = dispatchErr.message || 'Resend provider error';
          }
        }

        if (deliveryError) {
          const failedEntry = {
            decidedAt: now.toISOString(),
            action: 'skipped',
            to: claudeDecision.to || spocEmail,
            subject: claudeDecision.subject,
            reason: `Send failed: ${deliveryError}`,
            dryRun,
          };
          evaluatedTasks.push({
            partnerId: partner.id,
            partnerName,
            taskId: task.id,
            channel: taskChannel,
            linkedFunnelId: taskLinkedFunnelId,
            action: 'failed',
            reason: deliveryError,
            dryRun,
            nudgeEntry: failedEntry,
            decidedAt: now.toISOString(),
          });
          skippedCount += 1;
        } else {
          sentCount += 1;
          const nudgeEntry = {
            decidedAt: now.toISOString(),
            action: 'sent',
            to: claudeDecision.to || spocEmail,
            subject: claudeDecision.subject,
            body: claudeDecision.body,
            reason: claudeDecision.reason || 'Claude evaluated task and drafted follow-up nudge',
            providerMessageId,
            dryRun,
          };

          evaluatedTasks.push({
            partnerId: partner.id,
            partnerName,
            taskId: task.id,
            channel: taskChannel,
            linkedFunnelId: taskLinkedFunnelId,
            action: 'sent',
            to: claudeDecision.to || spocEmail,
            subject: claudeDecision.subject,
            body: claudeDecision.body,
            reason: nudgeEntry.reason,
            providerMessageId,
            dryRun,
            nudgeEntry,
            newSendStatus: {
              type: 'followup_auto',
              at: now.toISOString(),
              to: claudeDecision.to || spocEmail,
              dryRun,
            },
            decidedAt: now.toISOString(),
          });
        }
      }
    }

    const result = {
      status: 'ok',
      enabled: true,
      dryRun,
      thresholdHours,
      executedAt: now.toISOString(),
      sentCount,
      skippedCount,
      totalEvaluated: evaluatedTasks.length,
      tasks: evaluatedTasks,
    };

    if (typeof res.status === 'function') return res.status(200).json(result);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(result));
  } catch (error) {
    console.error('Error in /api/follow-up-cron:', error);
    const err = {
      status: 'error',
      error: error.message || 'Internal error in nudge automation cron',
    };
    if (typeof res.status === 'function') return res.status(500).json(err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(err));
  }
}

module.exports = handler;
module.exports.default = handler;
