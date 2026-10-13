// The whole daily job in one place, so the scheduled run and the manual test address
// do exactly the same thing.

import { loadSnapshot } from './store.js';
import { computeDashboardEscalations, computeLaunchReadiness } from './readiness.js';
import { buildDigest } from './digest.js';
import { sendMail } from './mail.js';

export async function runDigest({ dry = false } = {}) {
  const record = await loadSnapshot();
  if (!record) return { ok: false, reason: 'No snapshot yet. Open the app once so it can sync.' };

  const s = record.snapshot;
  const escalations = computeDashboardEscalations({ phase1: s.phase1, contentItems: s.contentItems, phase4: s.phase4, phase5: s.phase5, partnerItems: s.partnerItems });
  const readiness = computeLaunchReadiness({ phase1: s.phase1, contentItems: s.contentItems, phase4: s.phase4, phase5: s.phase5, partnerItems: s.partnerItems, escalationCount: escalations.length });
  const digest = buildDigest(readiness, { savedAt: record.savedAt, appUrl: process.env.APP_URL });

  if (dry) return { ok: true, dryRun: true, status: readiness.status, subject: digest.subject, text: digest.text };

  const to = (process.env.DIGEST_TO || '').split(',').map((x) => x.trim()).filter(Boolean);
  const sent = await sendMail({ to, subject: digest.subject, text: digest.text, html: digest.html });
  return { ok: true, status: readiness.status, sentTo: to.length, id: sent.id };
}
