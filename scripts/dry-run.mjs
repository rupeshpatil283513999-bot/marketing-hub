// npm run digest:dry
// Builds a sample snapshot and prints the digest, so you can see exactly what the
// email would say without deploying, sending, or needing any keys.

import { computeDashboardEscalations, computeLaunchReadiness, setToday } from '../netlify/lib/readiness.js';
import { buildDigest } from '../netlify/lib/digest.js';

setToday('2026-09-30');
const snapshot = {
  phase1: { launchDate: '2026-10-03', productReady: { confirmed: true }, readyDecision: 'yes', conflictDecision: 'pending', readyEscalation: { active: false }, conflictEscalation: { active: false } },
  contentItems: [
    { id: 'a', type: 'Email', status: 'done', designStage: 'approved', deadline: '2026-09-20' },
    { id: 'b', type: 'Carousel', status: 'in_progress', designStage: 'in_review', deadline: '2026-09-25' },
  ],
  phase4: { kickoff: { confirmed: true }, b2c: { confirmed: false, status: 'draft', tasks: [] }, b2b: { confirmed: true, tasks: [] }, social: { confirmed: true }, postsLiveDecision: 'no', postsLiveEscalation: { active: false } },
  phase5: { invitesCreated: { confirmed: true }, landingPage: { confirmed: true }, pageTestedDecision: 'yes', pageTestedEscalation: { active: false }, reminderConfirmedDecision: 'pending', reminderConfirmedEscalation: { active: false }, milestones: { t10: { confirmed: true }, t7: { confirmed: false } }, invitePlans: [1] },
  partnerItems: [{ id: 1, name: 'Acme Wealth', tasks: [] }, { id: 2, name: 'Bright Advisors', tasks: [{ stage: 'confirmed' }] }],
};
const esc = computeDashboardEscalations({ ...snapshot, partnerItems: snapshot.partnerItems });
const readiness = computeLaunchReadiness({ ...snapshot, escalationCount: esc.length });
const digest = buildDigest(readiness, { savedAt: new Date().toISOString(), appUrl: 'https://your-project.vercel.app' });
console.log('SUBJECT: ' + digest.subject + '\n');
console.log(digest.text);
