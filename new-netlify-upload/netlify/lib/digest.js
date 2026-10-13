// Turns the readiness verdict into an email (plain text + simple HTML).

const STATUS_LABEL = { on_track: 'On track', at_risk: 'At risk', blocked: 'Blocked', ready: 'Completed', unscheduled: 'Not scheduled' };
const STATUS_COLOR = { on_track: '#05a049', ready: '#05a049', at_risk: '#d98a00', blocked: '#d93636', unscheduled: '#6b7280' };
const PHASE_NUM = { phase1: 1, phase2: 2, phase3: 3, phase4: 4, phase5: 5 };

function esc(v) {
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function prettyDate(iso) {
  if (!iso) return 'no date';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function dueText(c) {
  if (c.state === 'overdue') return 'was due ' + prettyDate(c.dueDate) + ', ' + Math.abs(c.daysUntilDue) + 'd late';
  if (!c.dueDate) return 'no due date';
  if (c.daysUntilDue === 0) return 'due today';
  return 'due ' + prettyDate(c.dueDate) + (c.daysUntilDue > 0 ? ' (in ' + c.daysUntilDue + 'd)' : '');
}

function hoursSince(iso) {
  return iso ? (Date.now() - new Date(iso).getTime()) / 3600000 : null;
}

export function buildDigest(readiness, { savedAt, appUrl } = {}) {
  const r = readiness;
  const label = STATUS_LABEL[r.status] || r.status;
  const overdue = r.missing.filter((c) => c.state === 'overdue');
  const soon = r.missing.filter((c) => c.state === 'due_soon');
  const later = r.missing.filter((c) => c.state === 'pending').slice(0, 5);
  const age = hoursSince(savedAt);
  const stale = age !== null && age > 36
    ? 'Note: the app last synced ' + Math.round(age / 24 * 10) / 10 + ' days ago, so this may be out of date. Open the hub to refresh it.'
    : '';

  let subject = '[Marketing Hub] Launch readiness: ' + label;
  if (r.status === 'ready') subject += ', all checks complete';
  else if (r.status === 'unscheduled') subject += ', set a launch date';
  else subject += ', ' + r.missing.length + ' open check' + (r.missing.length === 1 ? '' : 's') + (r.daysToLaunch >= 0 ? ' (launch in ' + r.daysToLaunch + 'd)' : '');

  const facts = r.doneCount + ' of ' + r.total + ' checks done'
    + (r.overdueCount ? ', ' + r.overdueCount + ' overdue' : '')
    + (r.escalationCount ? ', ' + r.escalationCount + ' escalation' + (r.escalationCount === 1 ? '' : 's') + ' waiting' : '');

  const line = (c) => 'P' + (PHASE_NUM[c.phase] || '?') + '  ' + c.label + (c.detail ? ' (' + c.detail + ')' : '') + ' - ' + dueText(c);
  const section = (title, list) => (list.length ? '\n' + title + ' (' + list.length + ')\n' + list.map((c) => '  - ' + line(c)).join('\n') + '\n' : '');

  const text = [
    'Launch readiness: ' + label.toUpperCase(),
    r.headline,
    facts,
    stale,
  ].filter(Boolean).join('\n')
    + '\n' + section('OVERDUE', overdue) + section('DUE IN THE NEXT 2 DAYS', soon) + section('COMING UP', later)
    + (appUrl ? '\nOpen the hub: ' + appUrl + '\n' : '');

  const rowHtml = (c) => '<tr><td style="padding:6px 10px;color:#6b7280;font-family:monospace;font-size:12px">P' + (PHASE_NUM[c.phase] || '?') + '</td>'
    + '<td style="padding:6px 10px;font-size:14px;color:#111827">' + esc(c.label) + (c.detail ? '<br><span style="color:#6b7280;font-size:12px">' + esc(c.detail) + '</span>' : '') + '</td>'
    + '<td style="padding:6px 10px;font-size:12px;color:' + (c.state === 'overdue' ? '#d93636' : c.state === 'due_soon' ? '#d98a00' : '#6b7280') + ';white-space:nowrap">' + esc(dueText(c)) + '</td></tr>';
  const sectionHtml = (title, list) => (list.length
    ? '<h3 style="margin:20px 0 6px;font-size:13px;letter-spacing:.05em;text-transform:uppercase;color:#374151">' + esc(title) + ' (' + list.length + ')</h3>'
      + '<table style="border-collapse:collapse;width:100%">' + list.map(rowHtml).join('') + '</table>'
    : '');

  const html = '<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:620px;margin:0 auto;padding:20px;color:#111827">'
    + '<div style="border-left:4px solid ' + (STATUS_COLOR[r.status] || '#6b7280') + ';padding:4px 0 4px 14px">'
    + '<div style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#6b7280">Launch readiness</div>'
    + '<div style="font-size:20px;font-weight:700;color:' + (STATUS_COLOR[r.status] || '#111827') + '">' + esc(label) + '</div>'
    + '<div style="font-size:14px;margin-top:4px">' + esc(r.headline) + '</div>'
    + '<div style="font-size:12px;color:#6b7280;margin-top:4px">' + esc(facts) + '</div></div>'
    + (stale ? '<p style="font-size:12px;color:#d98a00">' + esc(stale) + '</p>' : '')
    + sectionHtml('Overdue', overdue) + sectionHtml('Due in the next 2 days', soon) + sectionHtml('Coming up', later)
    + (appUrl ? '<p style="margin-top:24px"><a href="' + esc(appUrl) + '" style="color:#05a049;font-weight:700">Open the hub</a></p>' : '')
    + '</div>';

  return { subject, text, html };
}
