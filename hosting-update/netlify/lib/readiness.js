// AUTO-PORTED from the Marketing Hub front end (index.html) so the server runs the
// exact same rules the dashboard card runs. If you change a rule in the app, change it
// here too (or, later, move this file into a shared package both sides import).
//
// Pure functions only: no browser APIs, no network. Feed it a snapshot, get a verdict.

let todayOverride = null;
export function setToday(iso) { todayOverride = iso; }

function todayISODate() {
  if (todayOverride) return todayOverride;
  const tz = process.env.DIGEST_TZ || 'Asia/Kolkata';
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function pad2(n) { return n < 10 ? '0' + n : '' + n; }
function toISODate(y, m, d) { return y + '-' + pad2(m + 1) + '-' + pad2(d); }

function addDaysISO(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return toISODate(d.getFullYear(), d.getMonth(), d.getDate());
}

function partnerTaskStats(partner) {
  const tasks = partner.tasks || [];
  const total = tasks.length;
  const confirmed = tasks.filter((t) => t.stage === 'confirmed').length;
  const escalated = tasks.some((t) => t.escalation && t.escalation.active);
  const complete = total > 0 && confirmed === total;
  return { total, confirmed, escalated, complete };
}

function getPartnerDistributionStatus(partner) {
  const tasks = (partner && partner.tasks) || [];
  if (!tasks.length) return 'unshared';
  const sharedOrConfirmed = tasks.filter((t) => t.stage === 'shared' || t.stage === 'confirmed');
  if (!sharedOrConfirmed.length) return 'unshared';
  const hasVerified = sharedOrConfirmed.some((t) => (t.shareMethod === 'email' || t.sentViaApi));
  if (hasVerified) return 'verified';
  return 'reported';
}

function computePartnerStats(items) {
  const total = items.length;
  let totalTasks = 0, confirmedTasks = 0, escalatedCount = 0, partnersComplete = 0;
  let verifiedPartners = 0, reportedPartners = 0, unsharedPartners = 0;
  items.forEach((p) => {
    const st = partnerTaskStats(p);
    totalTasks += st.total;
    confirmedTasks += st.confirmed;
    if (st.escalated) escalatedCount += 1;
    if (st.complete) partnersComplete += 1;

    const distStatus = getPartnerDistributionStatus(p);
    if (distStatus === 'verified') verifiedPartners += 1;
    else if (distStatus === 'reported') reportedPartners += 1;
    else unsharedPartners += 1;
  });
  return { total, totalTasks, confirmedTasks, escalatedCount, partnersComplete, verifiedPartners, reportedPartners, unsharedPartners };
}

function computePhase1Status(p) {
  const aDone = p.productReady.confirmed;
  const bDone = p.readyDecision === 'yes';
  const cDone = !!p.launchDate;
  const dDone = p.conflictDecision === 'clear';
  const doneCount = [aDone, bDone, cDone, dDone].filter(Boolean).length;
  const escalated = p.readyEscalation.active || p.conflictEscalation.active;
  const locked = aDone && bDone && cDone && dDone;
  let status = 'not_started';
  if (escalated) status = 'at_risk';
  else if (locked) status = 'complete';
  else if (doneCount > 0) status = 'in_progress';
  return { aDone, bDone, cDone, dDone, doneCount, total: 4, escalated, locked, status };
}

function computePhase4Status(p, partners) {
  const kickoffDone = p.kickoff.confirmed;
  const b2cDone = p.b2c.confirmed || p.b2c.status === 'live' || p.b2c.status === 'completed';
  const b2bDone = p.b2b.confirmed || p.b2b.status === 'live' || p.b2b.status === 'completed';
  const partnersTotal = partners.length;
  const partnersComplete = partners.filter((pt) => partnerTaskStats(pt).complete).length;
  const channelPartnerDone = partnersTotal > 0 && partnersComplete === partnersTotal;
  const socialDone = p.social.confirmed;
  const postsLiveDone = p.postsLiveDecision === 'yes';
  const checks = [kickoffDone, b2cDone, b2bDone, channelPartnerDone, socialDone, postsLiveDone];
  const doneCount = checks.filter(Boolean).length;
  const partnerEscalated = partners.some((pt) => partnerTaskStats(pt).escalated);
  const directEscalated = (p.b2c && (p.b2c.missedSendEscalated || p.b2c.stalledEscalated)) ||
                          (p.b2b && (p.b2b.missedSendEscalated || p.b2b.stalledEscalated)) ||
                          (p.b2c && (p.b2c.tasks || []).some((t) => t.escalation && t.escalation.active)) ||
                          (p.b2b && (p.b2b.tasks || []).some((t) => t.escalation && t.escalation.active));
  const escalated = partnerEscalated || p.postsLiveEscalation.active || directEscalated;
  const locked = checks.every(Boolean);
  let status = 'not_started';
  if (escalated) status = 'at_risk';
  else if (locked) status = 'complete';
  else if (doneCount > 0) status = 'in_progress';
  return { kickoffDone, b2cDone, b2bDone, channelPartnerDone, partnersComplete, partnersTotal, socialDone, postsLiveDone, doneCount, total: checks.length, escalated, locked, status };
}

const INVITE_MILESTONE_DEFS = [
  { key: 't10', offsetDays: -10, label: 'First invite wave', short: 'T-10', detail: 'Send the first invite — email & WhatsApp list, then partners and social.' },
  { key: 't7', offsetDays: -7, label: 'Second invite wave', short: 'T-7', detail: 'Second wave — catch anyone missed in the first push, with a focus on the partner (B2B2C) and business (B2B) channels.' },
  { key: 't5', offsetDays: -5, label: 'Main invite push', short: 'T-5', detail: 'Send the primary invite across every channel — email, WhatsApp, partners, social, personal outreach.' },
  { key: 't3', offsetDays: -3, label: 'Reminder wave — 3 days out', short: 'T-3', detail: 'First reminder to everyone who has not registered yet.' },
  { key: 't1', offsetDays: -1, label: 'Reminder wave — 1 day out', short: 'T-1', detail: 'Final reminder wave the day before the event.' },
  { key: 'dayOf3h', offsetDays: 0, label: 'Final reminder — 3 hours before', short: '3h before', detail: 'Last-call reminder a few hours before go-live.' },
  { key: 'dayOf10m', offsetDays: 0, label: 'Go-live ping — 10 minutes before', short: '10m before', detail: 'Final nudge right before the session starts.' },
];

function computeInviteMilestoneDates(launchDate) {
  return INVITE_MILESTONE_DEFS.map((m) => ({
    ...m,
    date: launchDate ? addDaysISO(launchDate, m.offsetDays) : null,
  }));
}

function computePhase5Status(p) {
  const invitesDone = p.invitesCreated.confirmed;
  const landingPageDone = p.landingPage.confirmed;
  const pageTestedDone = p.pageTestedDecision === 'yes';
  const invitePlannerDone = (p.invitePlans || []).length > 0;
  const reminderConfirmedDone = p.reminderConfirmedDecision === 'yes';
  const checks = [invitesDone, landingPageDone, pageTestedDone, invitePlannerDone, reminderConfirmedDone];
  const doneCount = checks.filter(Boolean).length;
  const escalated = p.pageTestedEscalation.active || p.reminderConfirmedEscalation.active;
  const locked = checks.every(Boolean);
  let status = 'not_started';
  if (escalated) status = 'at_risk';
  else if (locked) status = 'complete';
  else if (doneCount > 0) status = 'in_progress';
  return { invitesDone, landingPageDone, pageTestedDone, invitePlannerDone, reminderConfirmedDone, doneCount, total: checks.length, escalated, locked, status };
}

function isItemEscalated(item, today) {
  if (item.designStage === 'approved') return false;
  return !!(item.deadline && item.deadline < today);
}

function daysBetweenISO(fromISO, toISO) {
  return Math.round((new Date(toISO + 'T00:00:00') - new Date(fromISO + 'T00:00:00')) / 86400000);
}

export function computeDashboardEscalations({ phase1, contentItems, phase4, phase5, partnerItems }) {
  const rows = [];
  const today = todayISODate();
  if (phase1.readyEscalation.active) rows.push({ id: 'p1-ready', phase: 'phase1', label: 'Phase 1 — Product readiness', reason: 'Waiting on the "product ready" confirmation' });
  if (phase1.conflictEscalation.active) rows.push({ id: 'p1-conflict', phase: 'phase1', label: 'Phase 1 — Calendar conflict', reason: 'Launch date conflict not yet cleared' });
  (contentItems || []).filter((it) => it.status === 'escalated').forEach((it) => rows.push({
    id: 'c-' + it.id, phase: 'phase2', label: 'Phase 2 — ' + (it.type || 'Content item'), reason: 'Content item escalated',
  }));
  (contentItems || []).filter((it) => isItemEscalated(it, today)).forEach((it) => rows.push({
    id: 'd-' + it.id, phase: 'phase3', label: 'Phase 3 — ' + (it.type || 'Design asset'), reason: 'Past its design deadline',
  }));
  if (phase4.postsLiveEscalation.active) rows.push({ id: 'p4-posts', phase: 'phase4', label: 'Phase 4 — Social posts', reason: 'Posts did not go live on schedule' });
  (partnerItems || []).filter((p) => partnerTaskStats(p).escalated).forEach((p) => rows.push({
    id: 'partner-' + p.id, phase: 'partners', label: 'Partner — ' + (p.name || 'Unnamed partner'), reason: 'SPOC has not responded',
  }));
  // Direct Client - Funnel and Task level escalations
  if (phase4.b2c) {
    if (phase4.b2c.missedSendEscalated) {
      rows.push({ id: 'p4-b2c-missed', phase: 'phase4', label: 'Phase 4 — Direct Client B2C Send', reason: 'Scheduled send is past due (Distribution Head alerted)' });
    }
    if (phase4.b2c.stalledEscalated) {
      rows.push({ id: 'p4-b2c-stalled', phase: 'phase4', label: 'Phase 4 — Direct Client B2C Funnel', reason: 'Funnel stalled with 0 conversions for 7+ days (Owner alerted)' });
    }
    (phase4.b2c.tasks || []).filter((t) => t.escalation && t.escalation.active).forEach((t) => {
      rows.push({ id: 'p4-b2c-task-' + t.id, phase: 'phase4', label: `B2C Task — ${t.title || 'Untitled task'}`, reason: `Assignee (${t.assignee || 'Assignee'}) hasn't confirmed receipt` });
    });
  }
  if (phase4.b2b) {
    if (phase4.b2b.missedSendEscalated) {
      rows.push({ id: 'p4-b2b-missed', phase: 'phase4', label: 'Phase 4 — Direct Client B2B Send', reason: 'Scheduled send is past due (Distribution Head alerted)' });
    }
    if (phase4.b2b.stalledEscalated) {
      rows.push({ id: 'p4-b2b-stalled', phase: 'phase4', label: 'Phase 4 — Direct Client B2B Funnel', reason: 'Funnel stalled with 0 conversions for 7+ days (Owner alerted)' });
    }
    (phase4.b2b.tasks || []).filter((t) => t.escalation && t.escalation.active).forEach((t) => {
      rows.push({ id: 'p4-b2b-task-' + t.id, phase: 'phase4', label: `B2B Task — ${t.title || 'Untitled task'}`, reason: `Assignee (${t.assignee || 'Assignee'}) hasn't confirmed receipt` });
    });
  }
  if (phase5.pageTestedEscalation.active) rows.push({ id: 'p5-page', phase: 'phase5', label: 'Phase 5 — Landing page', reason: 'Page/registration link not tested' });
  if (phase5.reminderConfirmedEscalation.active) rows.push({ id: 'p5-reminder', phase: 'phase5', label: 'Phase 5 — Reminder send', reason: 'Reminder wave not confirmed sent' });
  return rows;
}

export function computeLaunchReadiness({ phase1, contentItems, phase4, phase5, partnerItems, escalationCount }) {
  const today = todayISODate();
  const launchDate = phase1.launchDate || null;
  const daysToLaunch = launchDate ? daysBetweenISO(today, launchDate) : null;
  const items = contentItems || [];
  const partners = partnerItems || [];
  const s1 = computePhase1Status(phase1);
  const s4 = computePhase4Status(phase4, partners);
  const s5 = computePhase5Status(phase5);
  const pstats = computePartnerStats(partners);
  const contentDone = items.filter((it) => it.status === 'done').length;
  const designApproved = items.filter((it) => it.designStage === 'approved').length;

  // dueOffsetDays: negative = days BEFORE launch the check must be done by.
  const rules = [
    { id: 'p1-ready', phase: 'phase1', label: 'Product confirmed ready', dueOffsetDays: -21, done: s1.aDone && s1.bDone },
    { id: 'p1-date', phase: 'phase1', label: 'Launch date locked', dueOffsetDays: -21, done: s1.cDone },
    { id: 'p1-conflict', phase: 'phase1', label: 'Calendar conflict cleared', dueOffsetDays: -21, done: s1.dDone },
    { id: 'p2-content', phase: 'phase2', label: 'All content pieces completed', dueOffsetDays: -14,
      done: items.length > 0 && contentDone === items.length,
      detail: items.length ? contentDone + ' of ' + items.length + ' pieces done' : 'No content items added yet' },
    { id: 'p3-design', phase: 'phase3', label: 'All creative assets approved', dueOffsetDays: -10,
      done: items.length > 0 && designApproved === items.length,
      detail: items.length ? designApproved + ' of ' + items.length + ' assets approved' : 'No creative assets yet' },
    { id: 'p4-kickoff', phase: 'phase4', label: 'Distribution kickoff confirmed', dueOffsetDays: -10, done: s4.kickoffDone },
    { id: 'p4-partners', phase: 'phase4', label: 'Partner kit shared with every partner', dueOffsetDays: -7, done: s4.channelPartnerDone,
      detail: partners.length ? pstats.unsharedPartners + ' partner' + (pstats.unsharedPartners === 1 ? '' : 's') + ' not shared yet, ' + s4.partnersComplete + ' of ' + partners.length + ' fully confirmed' : 'No partners added yet' },
    { id: 'p4-b2c', phase: 'phase4', label: 'Direct B2C send scheduled', dueOffsetDays: -7, done: s4.b2cDone },
    { id: 'p4-b2b', phase: 'phase4', label: 'Direct B2B send scheduled', dueOffsetDays: -7, done: s4.b2bDone },
    { id: 'p4-social', phase: 'phase4', label: 'Social media push confirmed', dueOffsetDays: -7, done: s4.socialDone },
    { id: 'p4-posts', phase: 'phase4', label: 'Social posts confirmed live', dueOffsetDays: -5, done: s4.postsLiveDone },
    { id: 'p5-invites', phase: 'phase5', label: 'Invitations created', dueOffsetDays: -10, done: s5.invitesDone },
    { id: 'p5-planner', phase: 'phase5', label: 'Invite waves planned', dueOffsetDays: -10, done: s5.invitePlannerDone },
    { id: 'p5-page', phase: 'phase5', label: 'Landing page live', dueOffsetDays: -7, done: s5.landingPageDone },
    { id: 'p5-tested', phase: 'phase5', label: 'Landing page and registration link tested', dueOffsetDays: -5, done: s5.pageTestedDone },
    { id: 'p5-reminders', phase: 'phase5', label: 'Reminder wave confirmed sent', dueOffsetDays: -1, done: s5.reminderConfirmedDone },
  ];

  // Invite waves carry their own dates (T-10, T-7, ...), so they become
  // rules with an explicit due date instead of an offset.
  computeInviteMilestoneDates(launchDate).forEach((m) => {
    const st = (phase5.milestones || {})[m.key] || { confirmed: false };
    rules.push({ id: 'ms-' + m.key, phase: 'phase5', label: m.label + ' (' + m.short + ')', dueDate: m.date, done: !!st.confirmed });
  });

  const checks = rules.map((r) => {
    const dueDate = r.dueDate !== undefined ? r.dueDate : (launchDate ? addDaysISO(launchDate, r.dueOffsetDays) : null);
    let state = 'pending';
    let daysUntilDue = null;
    if (dueDate) daysUntilDue = daysBetweenISO(today, dueDate);
    if (r.done) state = 'done';
    else if (dueDate && daysUntilDue < 0) state = 'overdue';
    else if (dueDate && daysUntilDue <= 2) state = 'due_soon';
    return { id: r.id, phase: r.phase, label: r.label, detail: r.detail || '', dueDate, daysUntilDue, state };
  });

  const stateRank = { overdue: 0, due_soon: 1, pending: 2 };
  const missing = checks.filter((c) => c.state !== 'done').sort((a, b) => {
    if (stateRank[a.state] !== stateRank[b.state]) return stateRank[a.state] - stateRank[b.state];
    if (a.dueDate && b.dueDate) return a.dueDate < b.dueDate ? -1 : (a.dueDate > b.dueDate ? 1 : 0);
    return a.dueDate ? -1 : (b.dueDate ? 1 : 0);
  });
  const overdueCount = missing.filter((c) => c.state === 'overdue').length;
  const total = checks.length;
  const doneCount = total - missing.length;

  let status = 'on_track';
  if (!launchDate) status = 'unscheduled';
  else if (missing.length === 0) status = 'ready';
  else if (escalationCount > 0) status = 'blocked';
  else if (overdueCount > 0 || daysToLaunch <= 3) status = 'at_risk';

  let headline;
  if (!launchDate) headline = 'No launch date locked yet. Set one in Phase 1 to start the countdown.';
  else if (status === 'ready') headline = 'Every required check is complete. You are ready to launch.';
  else {
    const when = daysToLaunch > 0 ? 'in ' + daysToLaunch + ' day' + (daysToLaunch === 1 ? '' : 's')
      : (daysToLaunch === 0 ? 'today' : Math.abs(daysToLaunch) + ' day' + (Math.abs(daysToLaunch) === 1 ? '' : 's') + ' ago');
    headline = 'Launch is ' + when + ', and ' + missing.length + ' required check' + (missing.length === 1 ? ' is' : 's are') + ' incomplete.';
  }

  return { status, headline, checks, missing, total, doneCount, overdueCount, daysToLaunch, escalationCount: escalationCount || 0, pct: total ? Math.round((doneCount / total) * 100) : 0 };
}
