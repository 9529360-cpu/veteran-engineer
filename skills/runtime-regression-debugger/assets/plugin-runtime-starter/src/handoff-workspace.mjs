const MAX_TIMELINE_ITEMS = 200;
const MAX_EVIDENCE_ITEMS = 100;
const MAX_TEXT = 4000;

function valueText(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  const text = typeof value === 'string' ? value : String(value);
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text;
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function escapeHtml(value) {
  return valueText(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeMarkdown(value) {
  return valueText(value)
    .replaceAll('\\', '\\\\')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replace(/([`*_{}\[\]()#+.!|>~-])/g, '\\$1')
    .replace(/\r?\n/g, ' ');
}

function statusOf(task) {
  return valueText(task?.status, 'unknown').trim().toLowerCase() || 'unknown';
}

const STATUS_ORDER = [
  'executing', 'in-progress', 'ready', 'pending', 'planned', 'blocked', 'failed', 'deferred',
  'done', 'completed', 'cancelled', 'superseded', 'unknown'
];

function groupedTasks(tasks) {
  const groups = new Map();
  for (const task of array(tasks)) {
    const status = statusOf(task);
    if (!groups.has(status)) groups.set(status, []);
    groups.get(status).push(task);
  }
  const rank = new Map(STATUS_ORDER.map((status, index) => [status, index]));
  return [...groups.entries()].sort(([left], [right]) => {
    const a = rank.has(left) ? rank.get(left) : STATUS_ORDER.length;
    const b = rank.has(right) ? rank.get(right) : STATUS_ORDER.length;
    return a - b || left.localeCompare(right);
  });
}

function taskMeta(task) {
  const meta = [];
  if (task?.owner) meta.push(`owner: ${valueText(task.owner)}`);
  if (task?.risk) meta.push(`risk: ${valueText(task.risk)}`);
  if (task?.worker) meta.push(`worker: ${valueText(task.worker)}`);
  if (task?.validationCapability) meta.push(`validation: ${valueText(task.validationCapability)}`);
  return meta;
}

function blockers(handoff) {
  return array(handoff?.readiness?.blockers);
}

function blockerText(blocker) {
  if (typeof blocker === 'string') return blocker;
  if (!blocker || typeof blocker !== 'object') return valueText(blocker, 'Unknown blocker');
  return [blocker.code, blocker.message || blocker.reason || blocker.summary].filter(Boolean).map(valueText).join(' — ') || 'Unknown blocker';
}

function timelineItems(handoff) {
  return array(handoff?.timeline).slice(-MAX_TIMELINE_ITEMS).reverse();
}

function timelineText(item) {
  if (typeof item === 'string') return item;
  if (!item || typeof item !== 'object') return valueText(item, 'event');
  const kind = item.type || item.event || item.action || item.status || 'event';
  const subject = item.taskId ? `task ${item.taskId}` : item.candidateId ? `candidate ${item.candidateId}` : '';
  const message = item.summary || item.message || item.reason || '';
  return [kind, subject, message].filter(Boolean).map(valueText).join(' · ');
}

function timelineAt(item) {
  if (!item || typeof item !== 'object') return '';
  return valueText(item.at || item.createdAt || item.timestamp || item.time || '');
}

function projectName(handoff) {
  return valueText(handoff?.project?.name || handoff?.project?.id || 'Project');
}

function missionTitle(handoff) {
  return valueText(handoff?.mission?.goal || handoff?.mission?.id || 'Mission');
}

function taskMarkdown(task) {
  const id = escapeMarkdown(task?.id || 'task');
  const contract = escapeMarkdown(task?.contract || task?.title || task?.summary || 'No contract recorded');
  const meta = taskMeta(task).map(escapeMarkdown).join(' · ');
  const dependencies = array(task?.dependencies).map(escapeMarkdown);
  return `- **${id}** — ${contract}${meta ? `  \n  ${meta}` : ''}${dependencies.length ? `  \n  depends on: ${dependencies.join(', ')}` : ''}`;
}

export function renderHandoffMarkdown(handoff = {}) {
  const groups = groupedTasks(handoff.tasks);
  const readiness = handoff.readiness || {};
  const lines = [
    `# ${escapeMarkdown(projectName(handoff))} — Mission workspace`,
    '',
    '> Read-only projection of Veteran Engineer Mission state. The JSON handoff and runtime Mission state remain authoritative.',
    '',
    `## ${escapeMarkdown(missionTitle(handoff))}`,
    '',
    `- Mission: ${escapeMarkdown(handoff?.mission?.id || 'unknown')}`,
    `- Status: ${escapeMarkdown(handoff?.mission?.status || 'unknown')}`,
    `- Phase: ${escapeMarkdown(handoff?.mission?.phase || 'unknown')}`,
    `- Ready: ${readiness.ready === true ? 'yes' : 'no'}`,
    `- Next safe action: ${escapeMarkdown(handoff.nextSafeAction || 'none')}`,
    ''
  ];
  const blocked = blockers(handoff);
  lines.push('## Blockers', '');
  if (!blocked.length) lines.push('- None reported');
  else for (const blocker of blocked) lines.push(`- ${escapeMarkdown(blockerText(blocker))}`);
  lines.push('', '## Task board', '');
  if (!groups.length) lines.push('_No tasks._');
  for (const [status, tasks] of groups) {
    lines.push(`### ${escapeMarkdown(status)} (${tasks.length})`, '');
    for (const task of tasks) lines.push(taskMarkdown(task));
    lines.push('');
  }
  lines.push('## Evidence', '');
  const evidence = array(handoff.evidence).slice(0, MAX_EVIDENCE_ITEMS);
  if (!evidence.length) lines.push('- No evidence records exported');
  for (const item of evidence) {
    const label = [item?.id, item?.type].filter(Boolean).map(escapeMarkdown).join(' · ') || 'evidence';
    const summary = escapeMarkdown(item?.summary || '');
    lines.push(`- **${label}**${summary ? ` — ${summary}` : ''}`);
  }
  lines.push('', '## Activity', '');
  const timeline = timelineItems(handoff);
  if (!timeline.length) lines.push('- No timeline events exported');
  for (const item of timeline) {
    const at = escapeMarkdown(timelineAt(item));
    lines.push(`- ${at ? `${at} — ` : ''}${escapeMarkdown(timelineText(item))}`);
  }
  lines.push('', `Exported: ${escapeMarkdown(handoff.exportedAt || '')}`, '');
  return `${lines.join('\n')}\n`;
}

function pill(label, value, extra = '') {
  return `<span class="pill ${extra}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></span>`;
}

function taskCard(task) {
  const meta = taskMeta(task);
  const dependencies = array(task?.dependencies);
  return `<article class="task-card">
    <div class="task-top"><code>${escapeHtml(task?.id || 'task')}</code>${task?.risk ? `<span class="risk">${escapeHtml(task.risk)}</span>` : ''}</div>
    <p class="contract">${escapeHtml(task?.contract || task?.title || task?.summary || 'No contract recorded')}</p>
    ${meta.length ? `<div class="meta">${meta.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}</div>` : ''}
    ${dependencies.length ? `<div class="dependencies"><span>Depends on</span>${dependencies.map((item) => `<code>${escapeHtml(item)}</code>`).join('')}</div>` : ''}
  </article>`;
}

function evidenceHtml(handoff) {
  const items = array(handoff.evidence).slice(0, MAX_EVIDENCE_ITEMS);
  if (!items.length) return '<p class="empty">No evidence records exported.</p>';
  return `<div class="evidence-list">${items.map((item) => `<article><div><code>${escapeHtml(item?.id || 'evidence')}</code>${item?.type ? `<span>${escapeHtml(item.type)}</span>` : ''}</div><p>${escapeHtml(item?.summary || 'No summary')}</p></article>`).join('')}</div>`;
}

function timelineHtml(handoff) {
  const items = timelineItems(handoff);
  if (!items.length) return '<p class="empty">No timeline events exported.</p>';
  return `<ol class="timeline">${items.map((item) => `<li><time>${escapeHtml(timelineAt(item))}</time><p>${escapeHtml(timelineText(item))}</p></li>`).join('')}</ol>`;
}

export function renderHandoffWorkspaceHtml(handoff = {}) {
  const groups = groupedTasks(handoff.tasks);
  const readiness = handoff.readiness || {};
  const blocked = blockers(handoff);
  const status = valueText(handoff?.mission?.status, 'unknown');
  const phase = valueText(handoff?.mission?.phase, 'unknown');
  const next = valueText(handoff.nextSafeAction, 'none');
  const board = groups.length
    ? groups.map(([name, tasks]) => `<section class="column"><header><h3>${escapeHtml(name)}</h3><span>${tasks.length}</span></header><div class="cards">${tasks.map(taskCard).join('')}</div></section>`).join('')
    : '<p class="empty">No tasks exported.</p>';
  const blockerMarkup = blocked.length
    ? `<ul class="blockers">${blocked.map((item) => `<li>${escapeHtml(blockerText(item))}</li>`).join('')}</ul>`
    : '<p class="empty">No blockers reported.</p>';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>${escapeHtml(projectName(handoff))} — Mission workspace</title>
<style>
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color-scheme:dark;--bg:#0b1020;--surface:#121a2f;--surface2:#18233d;--text:#f7f9fc;--muted:#aeb8cc;--border:#2a3758;--accent:#8aa4ff;--danger:#ff9b9b;--ok:#8ee3b1}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);line-height:1.5}a{color:inherit}.shell{width:min(1500px,calc(100% - 32px));margin:0 auto;padding:32px 0 64px}.top{display:grid;grid-template-columns:1fr auto;gap:24px;align-items:end;padding:24px 0 32px;border-bottom:1px solid var(--border)}.eyebrow{margin:0 0 8px;color:var(--accent);font-size:.78rem;font-weight:800;letter-spacing:.14em;text-transform:uppercase}h1{font-size:clamp(2rem,5vw,4.8rem);line-height:.98;letter-spacing:-.05em;margin:0;max-width:18ch}h2{margin:0 0 16px;font-size:1.5rem}h3{margin:0;font-size:.95rem;text-transform:capitalize}.pills{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.pill{display:flex;flex-direction:column;gap:2px;padding:9px 12px;border:1px solid var(--border);border-radius:12px;background:var(--surface)}.pill span{font-size:.7rem;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}.pill strong{font-size:.9rem}.pill.ready strong{color:var(--ok)}.pill.blocked strong{color:var(--danger)}.section{padding:28px 0;border-bottom:1px solid var(--border)}.next{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:20px;border-radius:18px;background:var(--surface);border:1px solid var(--border)}.next strong{font-size:1.15rem}.blockers{margin:16px 0 0;padding-left:20px;color:var(--danger)}.board{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(280px,340px);gap:16px;overflow:auto;padding:4px 2px 16px;scrollbar-width:thin}.column{background:var(--surface);border:1px solid var(--border);border-radius:18px;min-height:180px}.column>header{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--border)}.column>header span{display:grid;place-items:center;min-width:28px;height:28px;border-radius:999px;background:var(--surface2);color:var(--muted)}.cards{display:grid;gap:10px;padding:12px}.task-card{padding:14px;border-radius:14px;background:var(--bg);border:1px solid var(--border)}.task-top{display:flex;align-items:center;justify-content:space-between;gap:8px}.task-top code,.dependencies code,.evidence-list code{font:700 .78rem ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--accent)}.risk{font-size:.68rem;text-transform:uppercase;color:var(--muted)}.contract{margin:12px 0;font-weight:650}.meta{display:flex;flex-wrap:wrap;gap:6px}.meta span,.evidence-list article>div span{font-size:.72rem;color:var(--muted);padding:3px 6px;background:var(--surface2);border-radius:6px}.dependencies{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;align-items:center}.dependencies>span{font-size:.7rem;color:var(--muted)}.two{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:28px}.evidence-list{display:grid;gap:10px}.evidence-list article{padding:14px;border:1px solid var(--border);border-radius:14px;background:var(--surface)}.evidence-list article>div{display:flex;gap:8px;align-items:center}.evidence-list p{margin:8px 0 0;color:var(--muted)}.timeline{list-style:none;margin:0;padding:0;display:grid;gap:12px}.timeline li{display:grid;grid-template-columns:minmax(130px,.3fr) 1fr;gap:12px;padding-bottom:12px;border-bottom:1px solid var(--border)}.timeline time{font-size:.78rem;color:var(--muted)}.timeline p{margin:0}.empty{color:var(--muted)}.footer{padding:24px 0;color:var(--muted);font-size:.8rem}@media(max-width:820px){.top{grid-template-columns:1fr}.pills{justify-content:flex-start}.two{grid-template-columns:1fr}.timeline li{grid-template-columns:1fr}.shell{width:min(100% - 24px,1500px)}}
</style>
</head>
<body><main class="shell">
<header class="top"><div><p class="eyebrow">Veteran Engineer · read-only mission projection</p><h1>${escapeHtml(missionTitle(handoff))}</h1></div><div class="pills">${pill('status', status)}${pill('phase', phase)}${pill('ready', readiness.ready === true ? 'yes' : 'no', readiness.ready === true ? 'ready' : 'blocked')}</div></header>
<section class="section"><div class="next"><div><p class="eyebrow">Next safe action</p><strong>${escapeHtml(next)}</strong></div><code>${escapeHtml(handoff?.mission?.id || 'mission')}</code></div>${blocked.length ? `<h2 style="margin-top:24px">Blockers</h2>${blockerMarkup}` : ''}</section>
<section class="section"><h2>Task board</h2><div class="board">${board}</div></section>
<section class="section two"><div><h2>Evidence</h2>${evidenceHtml(handoff)}</div><div><h2>Activity</h2>${timelineHtml(handoff)}</div></section>
<footer class="footer">Exported ${escapeHtml(handoff.exportedAt || '')}. This workspace does not mutate Mission state; use Veteran Engineer Mission tools for changes.</footer>
</main></body></html>\n`;
}
