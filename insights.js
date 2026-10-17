/* Insights tab: impressions, reactions, comments and reposts for published posts.
   Loaded after app.js. It plugs into the app by wrapping setView, renderAll and renderCalendar,
   so app.js itself does not need to change. */
'use strict';

const ins = { rows: [], sync: { at: '', error: '' }, loaded: false, err: '', range: '30', sort: { k: 'pub', dir: -1 } };
const INS_METRICS = [
  { k: 'impressions', label: 'Impressions' },
  { k: 'reactions', label: 'Reactions' },
  { k: 'comments', label: 'Comments' },
  { k: 'reshares', label: 'Reposts' },
];

/* ---------- plug into the app ---------- */
const _setView = setView, _renderAll = renderAll, _renderCalendar = renderCalendar;
setView = function (v) {
  if (v !== 'insights') { _setView(v); return; }
  state.view = 'insights';
  $$('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.v === 'insights')));
  renderHeader();
  renderInsights();
  loadInsights();
};
renderAll = function () { if (state.view === 'insights') { renderHeader(); renderInsights(); } else _renderAll(); };
renderCalendar = function () { if (state.view === 'insights') renderInsights(); else _renderCalendar(); };

/* ---------- helpers ---------- */
const fmtN = n => (n == null || n === '' ? '—' : n >= 100000 ? Math.round(n / 1000) + 'K' : n >= 10000 ? (n / 1000).toFixed(1).replace('.0', '') + 'K' : n.toLocaleString('en-IN'));
const fmtPct = r => (r == null ? '—' : (r * 100).toFixed(r >= 0.1 ? 1 : 2).replace(/\.?0+$/, '') + '%');
function niceMax(v) { const p = Math.pow(10, Math.floor(Math.log10(v))); const f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; }
function ago(stamp) {
  const st = parseStamp(stamp); if (!st) return '';
  const m = Math.max(0, Math.round((Date.now() - toEpoch(st)) / 60000));
  if (m < 2) return 'just now';
  if (m < 60) return m + ' min ago';
  if (m < 1440) return Math.round(m / 60) + ' h ago';
  return Math.round(m / 1440) + ' d ago';
}
const engOf = s => {
  if (!s || !s.impressions) return null;
  return ((s.reactions || 0) + (s.comments || 0) + (s.reshares || 0)) / s.impressions;
};

/* newest snapshot per post (rows arrive oldest first) */
function latestByPost() {
  const m = {};
  ins.rows.forEach(r => { m[r.postId] = r; });
  return m;
}
function insData() {
  const latest = latestByPost();
  const days = ins.range === 'all' ? Infinity : Number(ins.range);
  return state.posts
    .filter(p => p.status === 'published' && p.publishedAt)
    .map(p => ({ p, s: latest[p.id] || null, pub: toEpoch(parseStamp(p.publishedAt)) }))
    .filter(x => (Date.now() - x.pub) / 864e5 <= days)
    .map(x => ({ ...x, eng: engOf(x.s) }));
}

/* ---------- loading ---------- */
async function loadInsights() {
  try {
    const first = !ins.loaded;
    const d = await (first ? busy('Loading insights...', () => api('statsList')) : api('statsList'));
    ins.rows = d.stats || []; ins.sync = d.sync || ins.sync; ins.loaded = true; ins.err = '';
  } catch (e) {
    ins.err = /unknown action/i.test(e.message)
      ? 'The Insights part of the backend is not installed yet. Add Insights.gs to your Apps Script project, paste the updated Code.gs and deploy a new version.'
      : e.message;
  }
  if (state.view === 'insights') renderInsights();
}

/* ---------- rendering ---------- */
function renderInsights() {
  const host = $('#view');
  if (ins.err) {
    host.innerHTML = `<section class="glass card ins"><h2>Insights</h2><p class="hint" style="color:var(--bad)">${esc(ins.err)}</p><button class="btn" type="button" data-act="ins-reload">Try again</button></section>`;
    return;
  }
  const data = insData();
  const withStats = data.filter(x => x.s && x.s.impressions != null);
  const sum = k => withStats.reduce((a, x) => a + (x.s[k] || 0), 0);
  const totImp = sum('impressions');
  const totEng = sum('reactions') + sum('comments') + sum('reshares');
  const hasApi = ins.rows.some(r => r.source === 'api');
  const tiles = [
    ['Impressions', fmtN(totImp)], ['Reactions', fmtN(sum('reactions'))], ['Comments', fmtN(sum('comments'))],
    ['Reposts', fmtN(sum('reshares'))], ['Engagement rate', totImp ? fmtPct(totEng / totImp) : '—'],
  ].map(([l, v]) => `<div class="tile glass"><span>${l}</span><strong>${v}</strong></div>`).join('');

  const rangeBtn = (r, l) => `<button type="button" data-act="ins-range" data-r="${r}" aria-pressed="${ins.range === r}">${l}</button>`;
  host.innerHTML = `<div class="ins">
    <div class="ins-head">
      <div><h2>Insights</h2>
        <p class="hint" style="margin:2px 0 0">${data.length} published post${data.length === 1 ? '' : 's'} in this range, ${withStats.length} with numbers.${ins.sync.at ? ` Last sync try: ${esc(ago(ins.sync.at))}.` : ''}</p></div>
      <span class="spacer"></span>
      <div class="seg" role="group" aria-label="Range">${rangeBtn('7', '7 days')}${rangeBtn('30', '30 days')}${rangeBtn('90', '90 days')}${rangeBtn('all', 'All')}</div>
      <button class="btn primary" type="button" data-act="ins-sync">Sync from LinkedIn</button>
    </div>
    ${ins.sync.error ? `<div class="banner bad glass"><span>${esc(ins.sync.error)}</span></div>` : ''}
    ${!hasApi && !ins.sync.error ? '<p class="hint">Automatic sync needs LinkedIn to approve analytics access for your app. Until then, use Update on a post to type in the numbers from LinkedIn.</p>' : ''}
    <div class="tiles">${tiles}</div>
    <section class="glass card"><h3 class="ins-h">Impressions per post</h3>${chartHtml(withStats)}</section>
    <section class="glass card"><h3 class="ins-h">Posts</h3>${tableHtml(data)}</section>
  </div>`;
}

function chartHtml(items) {
  const pts = items.slice().sort((a, b) => a.pub - b.pub);
  if (!pts.length) return '<p class="muted">No numbers yet. Sync from LinkedIn, or use Update on a post below.</p>';
  const avail = Math.max(280, ($('#view').clientWidth || 900) - 44);
  const n = pts.length, W = Math.max(avail, n * 34 + 50), H = 200, L = 46, B = 28, T = 10;
  const max = niceMax(Math.max(1, ...pts.map(x => x.s.impressions)));
  const step = (W - L - 8) / n, bw = Math.min(22, step * 0.62), ph = H - B - T;
  const y = v => T + ph - (v / max) * ph;
  let g = '';
  [0, 0.5, 1].forEach(f => {
    const v = max * f;
    g += `<line x1="${L}" x2="${W - 4}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" class="ax">${fmtN(v)}</text>`;
  });
  const bars = pts.map((x, i) => {
    const cx = L + step * i + step / 2, v = x.s.impressions, h = Math.max(1.5, ph - (y(v) - T));
    const lab = x.p.day !== '' ? 'D' + x.p.day : (() => { const st = parseStamp(x.p.publishedAt); return st.d + '/' + st.m; })();
    return `<g><title>${esc((x.p.day !== '' ? 'Day ' + x.p.day + ': ' : '') + (x.p.title || 'Untitled'))}: ${v.toLocaleString('en-IN')} impressions</title>
      <rect class="bar" x="${cx - bw / 2}" y="${T + ph - h}" width="${bw}" height="${h}" rx="4"/>
      <text x="${cx}" y="${H - 9}" text-anchor="middle" class="ax">${esc(lab)}</text></g>`;
  }).join('');
  return `<div class="ins-chart"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Impressions per post">${g}${bars}</svg></div>`;
}

function tableHtml(data) {
  if (!data.length) return '<p class="muted">Published posts show up here.</p>';
  const { k, dir } = ins.sort;
  const val = x => (k === 'pub' ? x.pub : k === 'eng' ? x.eng : x.s ? x.s[k] : null);
  const rows = data.slice().sort((a, b) => {
    const va = val(a), vb = val(b);
    return ((va == null ? -1 : va) - (vb == null ? -1 : vb)) * dir;
  });
  const th = (key, label, cls = '') => `<th class="${cls}"><button type="button" data-act="ins-sort" data-k="${key}" class="sortb">${label}${k === key ? (dir > 0 ? ' ▲' : ' ▼') : ''}</button></th>`;
  const body = rows.map(x => {
    const st = parseStamp(x.p.publishedAt), url = liUrl(x.p.linkedinUrn);
    const note = x.s ? `Updated ${ago(x.s.capturedAt)} (${x.s.source === 'api' ? 'from LinkedIn' : 'entered by hand'})` : 'No numbers yet';
    return `<tr title="${esc(note)}">
      <td class="pt"><strong>${x.p.day !== '' ? 'Day ' + esc(x.p.day) : ''}</strong> ${esc(x.p.title || 'Untitled')}</td>
      <td class="nw">${esc(dateLabel(st))}</td>
      ${INS_METRICS.map(m => `<td class="num">${fmtN(x.s ? x.s[m.k] : null)}</td>`).join('')}
      <td class="num">${fmtPct(x.eng)}</td>
      <td class="nw acts"><button type="button" class="btn" data-act="ins-edit" data-id="${esc(x.p.id)}">Update</button>${url ? ` <a class="btn" target="_blank" rel="noopener" href="${esc(url)}">View</a>` : ''}</td>
    </tr>`;
  }).join('');
  return `<div class="ins-table"><table><thead><tr><th class="pt">Post</th>${th('pub', 'Published')}${INS_METRICS.map(m => th(m.k, m.label, 'num')).join('')}${th('eng', 'Engagement', 'num')}<th></th></tr></thead><tbody>${body}</tbody></table></div>`;
}

/* ---------- actions ---------- */
async function insSync() {
  if (!state.token.connected) { toast('LinkedIn is not connected. Reconnect first.', { type: 'err' }); return; }
  let synced = 0;
  try {
    await busy('Syncing from LinkedIn...', async () => {
      for (let i = 0; i < 10; i++) {
        const r = await api('statsSync');
        synced += r.synced || 0;
        if (!r.remaining) break;
        $('#busyLabel').textContent = `Syncing from LinkedIn... ${synced} done, ${r.remaining} to go`;
      }
    });
    toast(synced ? `Updated ${synced} post${synced === 1 ? '' : 's'} from LinkedIn.` : 'Already up to date. Posts are re-read at most every 6 hours.', { type: synced ? 'ok' : 'info' });
  } catch (e) { toast(e.message, { type: 'err', ms: 10000 }); }
  await loadInsights();
}

function insEdit(id) {
  const p = state.posts.find(x => x.id === id); if (!p) return;
  const s = latestByPost()[id] || {};
  const m = $('#modal'), prev = document.activeElement;
  const f = (k, label, hint = '') => `<label class="field" style="margin-top:0"><span>${label}${hint ? ` <em>${hint}</em>` : ''}</span><input type="number" min="0" step="1" inputmode="numeric" name="${k}" value="${s[k] == null ? '' : s[k]}"></label>`;
  m.innerHTML = `<form class="glass dialog" role="dialog" aria-modal="true" aria-labelledby="insT">
    <h2 id="insT">Update numbers</h2>
    <p class="muted" style="margin:0">${p.day !== '' ? 'Day ' + esc(p.day) + ': ' : ''}${esc(p.title || 'Untitled')}</p>
    <div class="ins-form">${f('impressions', 'Impressions')}${f('reach', 'Members reached', '(optional)')}${f('reactions', 'Reactions')}${f('comments', 'Comments')}${f('reshares', 'Reposts')}</div>
    <p class="err" id="insErr" role="alert"></p>
    <div class="actions"><button class="btn" type="button" data-r="0">Cancel</button><button class="btn primary" type="submit">Save</button></div></form>`;
  m.classList.remove('hidden');
  const done = () => { m.classList.add('hidden'); m.innerHTML = ''; m.onclick = null; document.removeEventListener('keydown', onKey); if (prev && prev.focus) prev.focus(); };
  const onKey = e => { if (e.key === 'Escape') done(); };
  document.addEventListener('keydown', onKey);
  m.onclick = e => { if (e.target === m || e.target.closest('[data-r="0"]')) done(); };
  $('input', m).focus();
  $('form', m).addEventListener('submit', async e => {
    e.preventDefault();
    const stat = { postId: id };
    $$('input', m).forEach(i => { stat[i.name] = i.value.trim() === '' ? '' : Number(i.value); });
    const vals = Object.values(stat).slice(1);
    if (vals.every(v => v === '')) { $('#insErr').textContent = 'Enter at least one number.'; return; }
    if (vals.some(v => v !== '' && (!Number.isInteger(v) || v < 0))) { $('#insErr').textContent = 'Use whole numbers, zero or more.'; return; }
    try {
      const d = await busy('Saving...', () => api('statsSave', { stat }));
      ins.rows.push(d.stat); done(); renderInsights(); toast('Numbers saved.');
    } catch (x) { $('#insErr').textContent = x.message; }
  });
}

document.addEventListener('click', e => {
  const t = e.target.closest('[data-act^="ins-"]'); if (!t) return;
  switch (t.dataset.act) {
    case 'ins-sync': insSync(); break;
    case 'ins-reload': ins.err = ''; ins.loaded = false; loadInsights(); break;
    case 'ins-range': ins.range = t.dataset.r; renderInsights(); break;
    case 'ins-sort': ins.sort = { k: t.dataset.k, dir: ins.sort.k === t.dataset.k ? -ins.sort.dir : -1 }; renderInsights(); break;
    case 'ins-edit': insEdit(t.dataset.id); break;
    default: break;
  }
});

let insRz = 0;
window.addEventListener('resize', () => { clearTimeout(insRz); insRz = setTimeout(() => { if (state.view === 'insights' && !ins.err) renderInsights(); }, 200); });
