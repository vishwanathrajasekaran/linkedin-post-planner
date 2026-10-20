'use strict';
/* Post Planner front end. Pure helpers (IST time, text styling, Drive links) live in lib.js. */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = escHtml;

const ICONS = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  close: '<path d="M18 6L6 18M6 6l12 12"/>',
  cal: '<rect x="3" y="4" width="18" height="18" rx="3"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  send: '<path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>',
  prev: '<path d="M15 18l-6-6 6-6"/>',
  next: '<path d="M9 18l6-6-6-6"/>',
};
function icon(name, size = 18) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

const state = {
  posts: [],
  token: { connected: false, expiresAt: 0, name: '', picture: '' },
  view: 'planner',
  sel: null,        // id of the post open in the editor
  ed: null,         // working copy of that post
  dirty: false,
  device: 'desktop',
  expanded: false,  // "see more" in the preview
  cal: { y: 2026, m: 1 },
  calDay: '',
  selected: new Set(),
  collapsedSeries: new Set(),
  seriesInitialized: false,
  bulkAction: '',
  bulkScheduledAt: '',
};
let destroyPicker = null;
let bulkRunning = false;
let importRunning = false;
let importSession = null;

/* ---------- server calls ---------- */
async function api(action, body = {}) {
  let res;
  try {
    res = await fetch('/api/proxy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...body }) });
  } catch (e) { throw new Error('Could not reach the server. Check your connection.'); }
  if (res.status === 401) { showLogin(); throw new Error('Please sign in again.'); }
  let data;
  try { data = await res.json(); } catch (e) { throw new Error('Unexpected reply from the server (' + res.status + ').'); }
  if (data.error) throw new Error(data.error);
  return data;
}

let busyCount = 0;
async function busy(label, fn) {
  busyCount += 1;
  $('#busyLabel').textContent = label;
  $('#busy').classList.remove('hidden');
  try { return await fn(); }
  finally { busyCount -= 1; if (busyCount === 0) $('#busy').classList.add('hidden'); }
}

/* ---------- toasts and dialogs ---------- */
function toast(msg, opts = {}) {
  const { type = 'ok', link = null, ms = 6000 } = opts;
  const el = document.createElement('div');
  el.className = 'toast' + (type === 'ok' ? '' : ' ' + type);
  el.innerHTML = `<i>${type === 'err' ? '!' : type === 'info' ? 'i' : '✓'}</i><div><span></span>${link ? ` <a target="_blank" rel="noopener" href="${esc(link.href)}">${esc(link.text)}</a>` : ''}</div>`;
  $('span', el).textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), ms);
}

function confirmDialog({ title, message, ok = 'Confirm', cancel = 'Cancel', danger = false }) {
  return new Promise(resolve => {
    const m = $('#modal');
    const prev = document.activeElement;
    m.innerHTML = `<div class="glass dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlgT" aria-describedby="dlgM">
      <h2 id="dlgT">${esc(title)}</h2><p id="dlgM" class="muted">${esc(message)}</p>
      <div class="actions"><button class="btn" data-r="0">${esc(cancel)}</button><button class="btn ${danger ? 'danger' : 'primary'}" data-r="1">${esc(ok)}</button></div></div>`;
    m.classList.remove('hidden');
    const done = v => {
      m.classList.add('hidden'); m.innerHTML = ''; m.onclick = null;
      document.removeEventListener('keydown', onKey);
      if (prev && prev.focus) prev.focus();
      resolve(v);
    };
    const onKey = e => { if (e.key === 'Escape') done(false); };
    document.addEventListener('keydown', onKey);
    m.onclick = e => {
      const b = e.target.closest('[data-r]');
      if (b) done(b.dataset.r === '1'); else if (e.target === m) done(false);
    };
    $('[data-r="1"]', m).focus();
  });
}

/* ---------- data helpers ---------- */
function normalizePost(p) {
  const sc = parseStamp(p.scheduledAt), pu = parseStamp(p.publishedAt);
  let media = p.media;
  if (typeof media === 'string') { try { media = JSON.parse(media); } catch (e) { media = []; } }
  if (!Array.isArray(media) || !media.length) media = p.imageDriveId ? [{ driveId: p.imageDriveId, type: 'image', altText: p.title || '' }] : [];
  return {
    ...p,
    day: p.day === '' || p.day == null ? '' : Number(p.day),
    series: p.series ?? '', title: p.title ?? '', body: p.body ?? '', error: p.error ?? '',
    imageDriveId: p.imageDriveId ?? '', linkedinUrn: p.linkedinUrn ?? '',
    media,
    scheduledAt: sc ? fmtStamp(sc) : '', publishedAt: pu ? fmtStamp(pu) : '',
  };
}
function isLate(p) {
  if (p.status === 'published' || !p.scheduledAt) return false;
  if (p.status === 'failed') return true;
  const over = (Date.now() - toEpoch(parseStamp(p.scheduledAt))) / 60000;
  return p.status === 'scheduled' ? over > 25 : over > 0;
}
const stClass = p => (isLate(p) ? (p.status === 'failed' ? 'failed' : 'late') : (p.status || 'draft'));
const bySeriesDay = (a, b) => String(a.series).localeCompare(String(b.series)) || (a.day || 0) - (b.day || 0);
const liUrl = urn => (/^urn:li:[A-Za-z]+:\d+$/.test(urn || '') ? `https://www.linkedin.com/feed/update/${urn}/` : '');
function blankPost(over = {}) {
  return { id: '', series: '', day: '', title: '', body: '', imageDriveId: '', media: [], status: 'draft', scheduledAt: '', publishedAt: '', linkedinUrn: '', error: '', ...over };
}
function workingCopy(post) { return { ...post, media: (post.media || []).map(m => ({ ...m })) }; }
function postStamp(p) {
  return parseStamp(p.status === 'published' ? (p.publishedAt || p.scheduledAt) : p.scheduledAt);
}

/* ---------- theme ---------- */
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('pp_theme', t); } catch (e) { /* private mode */ }
  const b = $('#themeBtn');
  b.innerHTML = icon(t === 'dark' ? 'sun' : 'moon');
  b.setAttribute('aria-label', t === 'dark' ? 'Switch to day mode' : 'Switch to night mode');
  b.title = t === 'dark' ? 'Day mode' : 'Night mode';
}

/* ---------- login ---------- */
function showLogin() {
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
  setTimeout(() => $('#pw').focus(), 0);
}
function showApp() {
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  setView(state.view);
}
async function logout() {
  try { await fetch('/api/logout', { method: 'POST' }); } catch (e) { /* ignore */ }
  state.posts = []; state.ed = null; state.sel = null; state.dirty = false; state.selected.clear();
  importSession = null;
  showLogin();
}

/* ---------- loading ---------- */
async function loadAll() {
  const d = await api('list');
  state.token = d.token || state.token;
  state.posts = (d.posts || []).map(normalizePost);
}
async function refresh() {
  try {
    const d = await api('list');
    state.token = d.token || state.token;
    state.posts = (d.posts || []).map(normalizePost);
    let reopened = false;
    if (state.ed && state.ed.id && !state.dirty) {
      const p = state.posts.find(x => x.id === state.ed.id);
      if (p && (p.status !== state.ed.status || p.error !== state.ed.error || p.publishedAt !== state.ed.publishedAt)) { state.ed = workingCopy(p); reopened = true; }
    }
    renderHeader();
    if (state.view === 'planner') {
      renderSidebar();
      if (reopened) { renderEditorPane(); updatePreview(); }
    } else renderCalendar();
  } catch (e) { /* silent: the next refresh will try again */ }
}

/* ---------- header and banner ---------- */
function renderHeader() {
  const t = state.token;
  const days = t.connected ? Math.max(0, Math.ceil((t.expiresAt - Date.now()) / 864e5)) : 0;
  const pill = $('#liPill');
  pill.className = 'pill ' + (!t.connected ? 'bad' : days <= 7 ? 'warn' : 'ok');
  pill.innerHTML = `<i class="dot"></i><span>${t.connected ? `LinkedIn, ${days} days left` : 'Connect LinkedIn'}</span>`;
  pill.title = t.connected ? `Connected${t.name ? ' as ' + t.name : ''}. Click to reconnect.` : 'Connect your LinkedIn account';
  const b = $('#banner');
  if (!t.connected) {
    b.innerHTML = '<div class="banner bad glass"><span>LinkedIn is not connected. Scheduled posts wait until you connect.</span><button class="btn primary" data-act="connect" type="button">Connect LinkedIn</button></div>';
  } else if (days <= 7) {
    b.innerHTML = `<div class="banner warn glass"><span>Your LinkedIn sign-in expires on ${esc(dateLabel(fromEpoch(t.expiresAt)))}. Reconnect to keep scheduled posts going out.</span><button class="btn primary" data-act="connect" type="button">Reconnect</button></div>`;
  } else b.innerHTML = '';
}

async function connectLinkedIn() {
  if (state.token.connected) {
    const ok = await confirmDialog({ title: 'Reconnect LinkedIn?', message: 'A new tab opens so you can sign in to LinkedIn again. This app stays open here.', ok: 'Open LinkedIn' });
    if (!ok) return;
  }
  // Open the tab straight from the click so pop-up blockers allow it, then point it at LinkedIn.
  const w = window.open('about:blank', '_blank');
  if (!w) { toast('Your browser blocked the new tab. Allow pop-ups for this site and try again.', { type: 'err' }); return; }
  try { w.document.title = 'Connecting to LinkedIn'; w.document.body.textContent = 'Opening LinkedIn...'; } catch (e) { /* ignore */ }
  try {
    const { url } = await busy('Contacting LinkedIn...', () => api('authUrl'));
    w.location.href = url;
    waitForConnection(state.token.expiresAt || 0);
  } catch (e) { try { w.close(); } catch (x) { /* ignore */ } toast(e.message, { type: 'err' }); }
}
function waitForConnection(prevExpiry) {
  const started = Date.now();
  const timer = setInterval(async () => {
    if (Date.now() - started > 180000) { clearInterval(timer); return; }
    try {
      const d = await api('list');
      if (d.token.connected && d.token.expiresAt > prevExpiry) {
        clearInterval(timer);
        state.token = d.token; state.posts = (d.posts || []).map(normalizePost);
        renderHeader();
        toast('LinkedIn connected' + (d.token.name ? ' as ' + d.token.name : '') + '.');
        if (state.view === 'planner') updatePreview();
      }
    } catch (e) { /* keep waiting */ }
  }, 3000);
}

/* ---------- views ---------- */
function setView(v) {
  state.view = v;
  $$('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.v === v)));
  renderHeader();
  if (v === 'planner') renderPlanner(); else renderCalendar();
}
function renderAll() { if (state.view === 'planner') { renderHeader(); renderPlanner(); } else { renderHeader(); renderCalendar(); } }

/* ---------- planner: sidebar ---------- */
function renderPlanner() {
  $('#view').innerHTML = `<div class="planner">
    <aside class="side">
      <section class="glass card" id="today"></section>
      <button class="btn primary wide" type="button" data-act="new-post">${icon('plus')} New post</button>
      <section class="glass card bulk-tools"><div class="bulk-head"><div><h2>Bulk actions</h2><p class="hint">Select posts below, then apply one action.</p></div><span id="selCount" class="muted">0 selected</span></div>
        <label class="bulk-select-all"><input id="selectAll" type="checkbox"> Select all posts</label>
        <form class="bulk-action-form">
          <div class="bulk-action-controls"><label class="field"><span>Action</span><select id="bulkAction" required>
            <option value="">Choose an action</option><option value="draft">Draft</option><option value="ready">Ready</option><option value="scheduled">Scheduled</option><option value="publish">Publish</option><option value="delete">Delete</option>
          </select></label><button class="btn primary" type="submit" disabled>Submit</button></div>
          <label class="field bulk-schedule-field hidden" id="bulkScheduleField"><span>Schedule selected for <em>(IST)</em></span><input id="bulkScheduledAt" type="datetime-local" disabled></label>
        </form>
      </section>
      <section class="glass card transfer-tools"><h2>Import / Export</h2><p class="hint">Transfer posts as JSON or CSV, including attachment metadata.</p>
        <div class="transfer-actions"><button class="btn" type="button" data-act="import">Import</button><div class="export-tools">
          <button class="btn" id="exportToggle" type="button" data-act="toggle-export" aria-expanded="false" aria-controls="exportOptions">Export</button>
          <div id="exportOptions" class="hidden"><button class="btn" type="button" data-act="export-json">Export JSON</button><button class="btn" type="button" data-act="export-csv">Export CSV</button></div>
        </div></div><input id="importFile" class="hidden" type="file" accept=".json,.csv,application/json,text/csv">
      </section>
       <div id="seriesList" class="stack"></div>
    </aside>
    <section class="work">
      <div class="glass card" id="editor"></div>
      <div class="glass card" id="previewCard"></div>
    </section>
  </div>`;
  $('#bulkAction').value = state.bulkAction;
  $('#bulkScheduledAt').value = state.bulkScheduledAt;
  renderSidebar();
  renderEditorPane();
  renderPreviewShell();
}
function renderSidebar() { renderToday(); renderSeries(); }
function renderToday() {
  const host = $('#today'); if (!host) return;
  const n = nowIST(), key = dayKey(n);
  const dueToday = state.posts.filter(p => p.status !== 'published' && p.scheduledAt && dayKey(parseStamp(p.scheduledAt)) === key);
  const late = state.posts.filter(p => isLate(p) && !dueToday.includes(p));
  const next = state.posts.filter(p => ['draft', 'ready'].includes(p.status) && !p.scheduledAt).sort(bySeriesDay)[0];
  let h = `<h2>Today</h2><p class="today-date">${esc(dateLabel(n))} (IST)</p>`;
  h += dueToday.length
    ? dueToday.map(p => postRow(p, `<span class="chip st-${stClass(p)}">${esc(timeLabel(parseStamp(p.scheduledAt)))}</span>`)).join('')
    : '<p class="muted">Nothing is due today.</p>';
  if (late.length) h += '<p class="sub">Needs attention</p>' + late.map(p => postRow(p, `<span class="chip st-${stClass(p)}">${p.status === 'failed' ? 'failed' : 'late'}</span>`)).join('');
  if (next) h += '<p class="sub">Next to schedule</p>' + postRow(next, `<span class="chip st-${next.status}">${esc(next.status)}</span>`);
  host.innerHTML = h;
}
function postRow(p, extra = '', options = {}) {
  const main = `<button type="button" class="row-main ${state.sel === p.id ? 'sel' : ''}" data-act="open-post" data-id="${esc(p.id)}"><span class="day">${p.day !== '' ? 'Day ' + esc(p.day) : ''}</span><span class="t">${esc(p.title || 'Untitled')}</span>${extra}</button>`;
  return options.selectable ? `<div class="row row-selectable"><input class="bulk-check" type="checkbox" data-id="${esc(p.id)}" ${state.selected.has(p.id) ? 'checked' : ''} aria-label="Select ${esc(p.title || 'Untitled')}">${main}</div>` : main;
}
function visiblePostIds() { return state.posts.map(p => p.id); }
function syncBulkControls() {
  const ids = visiblePostIds(), existing = new Set(ids);
  state.selected.forEach(id => { if (!existing.has(id)) state.selected.delete(id); });
  const count = $('#selCount'); if (count) count.textContent = `${state.selected.size} selected`;
  const all = $('#selectAll');
  if (all) { all.checked = ids.length > 0 && ids.every(id => state.selected.has(id)); all.indeterminate = state.selected.size > 0 && !all.checked; all.disabled = !ids.length; }
  const submit = $('.bulk-action-form button[type="submit"]');
  if (submit) submit.disabled = !state.selected.size || bulkRunning;
  const scheduled = $('#bulkAction')?.value === 'scheduled';
  $('#bulkScheduleField')?.classList.toggle('hidden', !scheduled);
  const input = $('#bulkScheduledAt');
  if (input) { input.disabled = !scheduled; input.required = scheduled; }
}
function renderSeries() {
  const host = $('#seriesList'); if (!host) return;
  syncBulkControls();
  const by = {};
  state.posts.forEach(p => (by[p.series || 'No series'] ||= []).push(p));
  const names = Object.keys(by);
  if (!names.length) { host.innerHTML = '<p class="muted" style="padding:6px 4px">No posts yet. Create your first one.</p>'; return; }
  if (!state.seriesInitialized) { names.forEach(name => state.collapsedSeries.add(name)); state.seriesInitialized = true; }
  host.innerHTML = names.map(name => {
    const list = by[name].sort((a, b) => (a.day || 0) - (b.day || 0));
    const done = list.filter(p => p.status === 'published').length;
    const counts = ['draft', 'ready', 'scheduled', 'published'].filter(s => list.some(p => p.status === s)).map(s => `${list.filter(p => p.status === s).length} ${s}`).join(' · ');
    return `<details class="glass card series-group" data-series="${esc(name)}" ${state.collapsedSeries.has(name) ? '' : 'open'}><summary><span><strong>${esc(name)}</strong><small>${counts || 'No posts'}</small></span><span class="series-progress">${done}/${list.length} published</span></summary><div class="bar-track" role="img" aria-label="${done} of ${list.length} published"><i style="width:${(done / list.length) * 100}%"></i></div>
      <div class="series-posts">${list.map(p => postRow(p, `<span class="chip st-${stClass(p)}">${esc(isLate(p) && p.status !== 'failed' ? 'late' : p.status)}</span>`, { selectable: true })).join('')}</div></details>`;
  }).join('');
}

/* ---------- planner: editor ---------- */
function updateCount() {
  const el = $('#count'); if (!el || !state.ed) return;
  const n = cpLength(state.ed.body || '');
  el.textContent = `${n.toLocaleString()} / 3,000`;
  el.style.color = n > 3000 ? 'var(--bad)' : '';
}

function renderEditorPane() {
  if (destroyPicker) { destroyPicker(); destroyPicker = null; }
  const host = $('#editor'); if (!host) return;
  const ed = state.ed;
  if (!ed) {
    host.innerHTML = `<div class="empty"><h2>Pick a post to edit</h2><p class="muted">Choose one from the list, or start a new one.</p>
      <button class="btn primary" type="button" data-act="new-post">${icon('plus')} New post</button></div>`;
    return;
  }
  const locked = ed.status === 'published';
  const dis = locked ? 'disabled' : '';
  const names = [...new Set(state.posts.map(p => p.series).filter(Boolean))];
  const url = liUrl(ed.linkedinUrn);
  const actions = locked
    ? `${url ? `<a class="btn" target="_blank" rel="noopener" href="${esc(url)}">View on LinkedIn</a>` : ''}<button class="btn" type="button" data-act="duplicate">Duplicate as draft</button><span class="spacer"></span><button class="btn danger" type="button" data-act="delete">Delete</button>`
    : `<button class="btn" type="button" data-act="save-draft">Save draft</button><button class="btn" type="button" data-act="save-ready">Mark ready</button><button class="btn primary" type="button" data-act="schedule">Schedule</button><button class="btn" type="button" data-act="publish">Publish now</button><span class="spacer"></span>${ed.id ? '<button class="btn danger" type="button" data-act="delete">Delete</button>' : ''}`;
  host.innerHTML = `
    <div class="ed-head"><h2 tabindex="-1">${ed.id ? 'Edit post' : 'New post'}</h2><div class="ed-head-actions">${ed.id ? `<span class="chip st-${stClass(ed)}">${esc(ed.status)}</span>` : ''}<button type="button" class="icon-btn" data-act="close-editor" aria-label="Close post editor" title="Close">${icon('close')}</button></div></div>
    <div class="grid2">
      <label class="field"><span>Series</span><input id="f-series" list="series-dl" autocomplete="off" value="${esc(ed.series)}" ${dis}>
        <datalist id="series-dl">${names.map(s => `<option value="${esc(s)}">`).join('')}</datalist></label>
      <label class="field"><span>Day</span><input id="f-day" type="number" min="1" inputmode="numeric" value="${esc(ed.day)}" ${dis}></label>
    </div>
    <label class="field"><span>Title <em>(only you see this)</em></span><input id="f-title" autocomplete="off" value="${esc(ed.title)}" ${dis}></label>
    <div class="field">
      <div class="field-head"><span id="lbl-body">Post</span><span id="count" class="muted"></span></div>
      ${locked ? '' : `<div class="toolbar" role="toolbar" aria-label="Text formatting">
        <button type="button" data-fmt="bold" title="Bold (Ctrl or Cmd+B)" aria-label="Bold"><b>B</b></button>
        <button type="button" data-fmt="italic" title="Italic (Ctrl or Cmd+I)" aria-label="Italic"><i>I</i></button>
        <button type="button" data-fmt="underline" title="Underline (Ctrl or Cmd+U)" aria-label="Underline"><u>U</u></button>
        <button type="button" data-fmt="strike" title="Strikethrough" aria-label="Strikethrough"><s>S</s></button>
        <button type="button" data-fmt="mono" title="Monospace" aria-label="Monospace"><code>M</code></button>
        <span class="sep"></span>
        <button type="button" data-fmt="bullets" title="Bullet list" aria-label="Bullet list">•</button>
        <button type="button" data-fmt="numbers" title="Numbered list" aria-label="Numbered list">1.</button>
        <button type="button" data-fmt="indent" title="Indent" aria-label="Indent">⇥</button>
        <button type="button" data-fmt="outdent" title="Outdent" aria-label="Outdent">⇤</button>
        <span class="sep"></span>
        <button type="button" data-fmt="clear" title="Clear formatting" aria-label="Clear formatting">Clear</button>
      </div>`}
      <textarea id="f-body" aria-labelledby="lbl-body" ${dis}>${esc(ed.body)}</textarea>
     ${locked ? '' : '<p class="hint">Select text, then pick a style. LinkedIn has no rich text, so styles are special Unicode characters. They look right everywhere but screen readers may read them oddly, so use them sparingly.</p>'}
    </div>
    ${locked ? '' : `<section class="assistant" aria-labelledby="assistant-title"><div class="assistant-head"><div><h3 id="assistant-title">Writing assistant</h3><p class="hint">Draft or improve this post without leaving the editor. Your text is only sent to the configured server-side AI provider when you run it.</p></div><span class="assistant-badge">AI</span></div><div class="assistant-controls"><label class="field"><span>Action</span><select id="ai-operation" aria-label="Writing assistant action"><option value="generate">Generate a post</option><option value="rewrite">Rewrite current post</option><option value="shorten">Shorten current post</option><option value="expand">Expand current post</option><option value="hook">Suggest opening hooks</option></select></label><label class="field"><span>Direction <em>(optional)</em></span><input id="ai-instruction" placeholder="e.g. sound more practical and direct" maxlength="300"></label></div><button class="btn primary" type="button" data-act="ai-assist">Run writing assistant</button><div id="ai-output" class="assistant-output hidden" aria-live="polite"></div></section>`}
     <div class="field"><div class="field-head"><span>Attachments <em>(Google Drive)</em></span>${locked ? '' : '<span class="media-add-actions"><button class="btn" type="button" data-act="add-media" data-type="image">Add image</button><button class="btn" type="button" data-act="add-media" data-type="document">Add PDF</button></span>'}</div>
       <div id="media-list">${(ed.media || []).map((m, i) => `<div class="media-row"><span class="media-number">${i + 1}</span><select data-media="type" data-i="${i}" ${dis}><option value="image" ${m.type === 'image' ? 'selected' : ''}>Image</option><option value="document" ${m.type === 'document' ? 'selected' : ''}>PDF document</option><option value="video" ${m.type === 'video' ? 'selected' : ''}>Video (unsupported)</option></select><input data-media="driveId" data-i="${i}" placeholder="Paste Google Drive share link" value="${esc(driveLink(m.driveId))}" ${dis}><input data-media="altText" data-i="${i}" placeholder="Alt text (recommended for images)" value="${esc(m.altText || '')}" ${dis}>${locked ? '' : '<button class="icon-btn" type="button" data-act="remove-media" data-i="' + i + '" aria-label="Remove attachment">×</button>'}</div>`).join('')}</div>
       <p class="hint">Add as many images as needed, or one PDF document. The file stays private in Drive; the backend reads it when publishing.</p></div>
    <div class="field"><span>Publish at <em>(IST)</em></span><div class="picker" id="picker"></div></div>
    ${ed.error ? `<div class="alert err" role="alert">${esc(ed.error)}</div>` : ''}
    ${locked ? `<div class="alert note">This post is published, so it is read-only.${ed.publishedAt ? ' Published ' + esc(human(parseStamp(ed.publishedAt))) + '.' : ''}</div>` : ''}
    <div class="actions">${actions}</div>`;
  bindEditor(locked);
  updateCount();
}

function bindEditor(locked) {
  const ed = state.ed;
  const touch = (k, v) => { ed[k] = v; state.dirty = true; };
  $('#f-series').addEventListener('input', e => touch('series', e.target.value));
  $('#f-day').addEventListener('input', e => touch('day', e.target.value === '' ? '' : Number(e.target.value)));
  $('#f-title').addEventListener('input', e => touch('title', e.target.value));
  const ta = $('#f-body');
  ta.addEventListener('input', () => { touch('body', ta.value); updateCount(); updatePreview(); });
  ta.addEventListener('keydown', e => {
    if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
    const map = { b: 'bold', i: 'italic', u: 'underline' };
    const kind = map[e.key.toLowerCase()];
    if (kind) { e.preventDefault(); applyFormat(kind); }
  });
  $$('.toolbar [data-fmt]').forEach(b => {
    b.addEventListener('mousedown', e => e.preventDefault()); // keep the text selection
    b.addEventListener('click', () => applyFormat(b.dataset.fmt));
  });
  $$('#media-list [data-media]').forEach(input => input.addEventListener('input', e => {
    const i = Number(e.target.dataset.i), key = e.target.dataset.media;
    ed.media ||= []; ed.media[i] ||= { driveId: '', type: 'image', altText: '' };
    ed.media[i][key] = key === 'driveId' ? driveId(e.target.value) : e.target.value; ed.imageDriveId = ed.media[0]?.driveId || ''; touch('media', ed.media); updatePreview();
  }));
  destroyPicker = mountPicker($('#picker'), ed.scheduledAt, v => touch('scheduledAt', v), locked);
}

/* ---------- formatting ---------- */
function applyFormat(kind) {
  const ta = $('#f-body');
  if (!ta || ta.disabled) return;
  const textOps = {
    bold: s => toggleBoldItalic(s, 'bold'),
    italic: s => toggleBoldItalic(s, 'italic'),
    underline: s => toggleMark(s, MARK_UNDERLINE),
    strike: s => toggleMark(s, MARK_STRIKE),
    mono: toggleMono,
    clear: clearFormatting,
  };
  const lineOps = { bullets: toggleBullets, numbers: toggleNumbers, indent: indentLines, outdent: outdentLines };
  if (textOps[kind]) transformSelection(ta, textOps[kind], false);
  else if (lineOps[kind]) transformSelection(ta, lineOps[kind], true);
}
function transformSelection(ta, fn, wholeLines) {
  const v = ta.value;
  let s = ta.selectionStart, e = ta.selectionEnd;
  if (wholeLines) {
    s = s === 0 ? 0 : v.lastIndexOf('\n', s - 1) + 1;
    let end = e; if (end > s && v[end - 1] === '\n') end -= 1;
    const nl = v.indexOf('\n', end);
    e = nl === -1 ? v.length : nl;
  } else if (s === e) {
    toast('Select some text first, then choose a style.', { type: 'info' });
    return;
  }
  const seg = v.slice(s, e);
  const out = fn(seg);
  ta.focus();
  ta.setSelectionRange(s, e);
  // insertText keeps the browser's undo history; fall back if it did not apply cleanly.
  let ok = false;
  try { ok = document.execCommand('insertText', false, out); } catch (x) { ok = false; }
  if (!ok || ta.value.slice(s, s + out.length) !== out) { ta.value = v; ta.setRangeText(out, s, e, 'end'); }
  ta.setSelectionRange(s, s + out.length);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

/* ---------- planner: LinkedIn-style preview ---------- */
function renderPreviewShell() {
  const host = $('#previewCard'); if (!host) return;
  host.innerHTML = `<div class="ed-head"><h2>Preview</h2>
    <div class="seg" role="group" aria-label="Preview size">
      <button type="button" data-act="device" data-d="desktop" aria-pressed="${state.device === 'desktop'}">Desktop</button>
      <button type="button" data-act="device" data-d="mobile" aria-pressed="${state.device === 'mobile'}">Mobile</button></div></div>
    <div id="li" class="li-wrap ${state.device}"></div>
    <p class="hint">An approximation of the LinkedIn feed. The exact "see more" cut-off varies a little.</p>`;
  updatePreview();
}
function updatePreview() {
  const host = $('#li'); if (!host) return;
  host.className = 'li-wrap ' + state.device;
  const ed = state.ed || { body: '', imageDriveId: '' };
  const t = state.token;
  const name = t.name || 'Your name';
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || 'Y';
  const body = ed.body || '';
  const cut = previewCut(body, state.device === 'mobile' ? 140 : 210);
  const full = state.expanded || !cut.more;
  const text = body.trim() ? previewHtml(full ? body : cut.shown) : '<span class="li-ph">Your post appears here as you type.</span>';
  const more = body.trim() && cut.more
    ? (state.expanded ? ' <button type="button" class="li-more" data-act="expand">see less</button>' : '… <button type="button" class="li-more" data-act="expand">see more</button>')
    : '';
  const media = ed.media || (ed.imageDriveId ? [{ driveId: ed.imageDriveId, type: 'image', altText: '' }] : []);
  const img = media.length ? `<div class="li-media">${media.map(m => m.type === 'image' ? `<div class="li-img"><img src="https://drive.google.com/thumbnail?id=${encodeURIComponent(m.driveId)}&sz=w1000" alt="${esc(m.altText || 'Image attached to the post')}" referrerpolicy="no-referrer"></div>` : `<div class="li-doc">📄 ${esc(m.type === 'video' ? 'Video (unsupported for publishing)' : 'PDF document attached')}</div>`).join('')}</div>` : '';
  host.innerHTML = `<article class="li-card">
    <div class="li-head"><span class="av">${esc(initials)}${t.picture ? `<img src="${esc(t.picture)}" alt="" referrerpolicy="no-referrer">` : ''}</span>
      <div class="li-who"><b>${esc(name)}</b><span>Just now 🌐</span></div></div>
    <div class="li-text">${text}${more}</div>${img}
    <div class="li-acts"><span>Like</span><span>Comment</span><span>Repost</span><span>Send</span></div></article>`;
  const av = $('.av img', host);
  if (av) av.addEventListener('error', () => av.remove());
  const im = $('.li-img img', host);
  if (im) im.addEventListener('error', () => {
    $('.li-img', host).innerHTML = '<div class="miss">The image preview is not available here. Google only shows it when the file is shared by link. The post still uses the file from your Drive.</div>';
  });
}

/* ---------- date and time picker (IST) ---------- */
function mountPicker(host, initial, onChange, disabled) {
  let val = parseStamp(initial);
  let view = val ? { y: val.y, m: val.m } : (({ y, m }) => ({ y, m }))(nowIST());
  let open = false;
  let presetVals = [];
  host.innerHTML = `<button type="button" class="picker-btn" aria-haspopup="dialog" aria-expanded="false" ${disabled ? 'disabled' : ''}>${icon('cal')}<span class="pv"></span></button>
    <div class="pop hidden" role="dialog" aria-label="Choose publish date and time"></div>`;
  const btn = $('.picker-btn', host), pop = $('.pop', host), pv = $('.pv', host);

  const paintBtn = () => { pv.textContent = val ? human(val) : 'Pick a date and time'; pv.classList.toggle('muted', !val); };
  const emit = () => { paintBtn(); onChange(val ? fmtStamp(val) : ''); };
  const roundUp5 = st => (st.mi % 5 ? addMinutes(st, 5 - (st.mi % 5)) : st);
  const defaultFor = (y, m, d) => {
    const n = nowIST();
    if (dayKey({ y, m, d }) === dayKey(n)) return { y, m, d, h: Math.min(23, n.h + 1), mi: 0 };
    return { y, m, d, h: 9, mi: 0 };
  };

  function paintPop() {
    const n = nowIST(), todayKey = dayKey(n);
    const first = dowOf(view.y, view.m, 1), dim = daysIn(view.y, view.m);
    let cells = '<span></span>'.repeat(first);
    for (let d = 1; d <= dim; d++) {
      const k = dayKey({ y: view.y, m: view.m, d });
      const sel = val && k === dayKey(val);
      cells += `<button type="button" data-d="${d}" class="${k === todayKey ? 'today' : ''} ${sel ? 'sel' : ''}" ${k < todayKey ? 'disabled' : ''} aria-label="${d} ${MONTHS[view.m - 1]} ${view.y}" ${sel ? 'aria-pressed="true"' : ''}>${d}</button>`;
    }
    const h12 = val ? (val.h % 12 || 12) : 9, mi = val ? val.mi : 0, pm = val ? val.h >= 12 : false;
    const hours = Array.from({ length: 12 }, (_, i) => i + 1).map(h => `<option ${h === h12 ? 'selected' : ''}>${h}</option>`).join('');
    const mins = [...new Set(Array.from({ length: 12 }, (_, i) => i * 5).concat([mi]))].sort((a, b) => a - b)
      .map(x => `<option value="${x}" ${x === mi ? 'selected' : ''}>${pad2(x)}</option>`).join('');
    const tm = addDays(n, 1);
    presetVals = [['In 30 minutes', roundUp5(addMinutes(n, 30))]];
    if (n.h < 18) presetVals.push(['Today 6:00 PM', { y: n.y, m: n.m, d: n.d, h: 18, mi: 0 }]);
    presetVals.push(['Tomorrow 9:00 AM', { y: tm.y, m: tm.m, d: tm.d, h: 9, mi: 0 }], ['Tomorrow 6:00 PM', { y: tm.y, m: tm.m, d: tm.d, h: 18, mi: 0 }]);
    pop.innerHTML = `
      <div class="pop-head"><button type="button" data-p="prev" aria-label="Previous month">${icon('prev')}</button><strong>${MONTHS[view.m - 1]} ${view.y}</strong><button type="button" data-p="next" aria-label="Next month">${icon('next')}</button></div>
      <div class="pop-dow">${DOW.map(d => `<span>${d.slice(0, 2)}</span>`).join('')}</div>
      <div class="pop-grid">${cells}</div>
      <div class="pop-time"><select aria-label="Hour" data-t="h">${hours}</select><b>:</b><select aria-label="Minute" data-t="m">${mins}</select>
        <select aria-label="AM or PM" data-t="p"><option ${pm ? '' : 'selected'}>AM</option><option ${pm ? 'selected' : ''}>PM</option></select></div>
      <div class="pop-presets">${presetVals.map((p, i) => `<button type="button" data-p="preset" data-i="${i}">${p[0]}</button>`).join('')}</div>
      <div class="pop-foot"><button type="button" class="btn" data-p="clear">Clear</button><button type="button" class="btn primary" data-p="done">Done</button></div>`;
  }
  const shift = dir => { view.m += dir; if (view.m < 1) { view.m = 12; view.y -= 1; } if (view.m > 12) { view.m = 1; view.y += 1; } paintPop(); };

  pop.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.d) {
      const d = +b.dataset.d;
      val = val ? { ...val, y: view.y, m: view.m, d } : defaultFor(view.y, view.m, d);
      emit(); paintPop();
      const again = $(`[data-d="${d}"]`, pop); if (again) again.focus();
      return;
    }
    switch (b.dataset.p) {
      case 'prev': shift(-1); break;
      case 'next': shift(1); break;
      case 'preset': val = { ...presetVals[+b.dataset.i][1] }; view = { y: val.y, m: val.m }; emit(); paintPop(); break;
      case 'clear': val = null; emit(); paintPop(); break;
      case 'done': close(); btn.focus(); break;
      default: break;
    }
  });
  pop.addEventListener('change', e => {
    if (!e.target.matches('select')) return;
    const h = +$('[data-t="h"]', pop).value, mi = +$('[data-t="m"]', pop).value, pm = $('[data-t="p"]', pop).value === 'PM';
    const h24 = (h % 12) + (pm ? 12 : 0);
    const wasEmpty = !val;
    if (!val) { const n = nowIST(); val = { y: n.y, m: n.m, d: n.d, h: h24, mi }; view = { y: n.y, m: n.m }; }
    val = { ...val, h: h24, mi };
    emit();
    if (wasEmpty) paintPop();
  });

  function openPop() { open = true; pop.classList.remove('hidden'); btn.setAttribute('aria-expanded', 'true'); paintPop(); }
  function close() { open = false; pop.classList.add('hidden'); btn.setAttribute('aria-expanded', 'false'); }
  btn.addEventListener('click', () => (open ? close() : openPop()));
  const onDown = e => { if (open && !host.contains(e.target)) close(); };
  const onKey = e => { if (e.key === 'Escape' && open) { close(); btn.focus(); } };
  document.addEventListener('pointerdown', onDown);
  document.addEventListener('keydown', onKey);
  paintBtn();
  return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
}

/* ---------- opening, creating, saving ---------- */
async function guardDirty() {
  if (!state.dirty) return true;
  return confirmDialog({ title: 'Discard unsaved changes?', message: 'Your edits to this post have not been saved.', ok: 'Discard', danger: true });
}
function focusEditor() {
  const host = $('#editor'); if (!host || !state.ed) return;
  const target = $('#f-body:not(:disabled)', host) || $('.ed-head h2', host);
  if (target) target.focus({ preventScroll: true });
  if (window.matchMedia('(max-width: 900px)').matches) host.scrollIntoView({ block: 'start', behavior: 'auto' });
}
async function openPost(id) {
  if (!(await guardDirty())) return;
  const p = state.posts.find(x => x.id === id); if (!p) return;
  state.sel = id; state.ed = workingCopy(p); state.dirty = false; state.expanded = false;
  setView('planner');
  focusEditor();
}
async function newPost(opts = {}) {
  if (!(await guardDirty())) return;
  const last = state.posts[state.posts.length - 1];
  let series = opts.from ? opts.from.series : (last ? last.series : '');
  const inSeries = state.posts.filter(p => p.series === series).map(p => p.day || 0);
  const day = series || inSeries.length ? Math.max(0, ...inSeries) + 1 : (last ? '' : 1);
  const ed = blankPost({ series, day });
  if (opts.from) { ed.title = opts.from.title; ed.body = opts.from.body; ed.imageDriveId = opts.from.imageDriveId; ed.media = (opts.from.media || []).map(m => ({ ...m })); }
  if (opts.date) {
    const n = nowIST();
    if (opts.date >= dayKey(n)) {
      const st = parseStamp(opts.date + ' 09:00');
      ed.scheduledAt = opts.date === dayKey(n) && n.h >= 9 ? fmtStamp({ ...st, h: Math.min(23, n.h + 1), mi: 0 }) : fmtStamp(st);
    }
  }
  state.sel = null; state.ed = ed; state.dirty = false; state.expanded = false;
  setView('planner');
  focusEditor();
}

function toPayload(ed, status) {
  const p = {
    series: String(ed.series || '').trim(), day: ed.day === '' ? '' : Number(ed.day), title: String(ed.title || '').trim(), body: String(ed.body || ''),
    imageDriveId: ed.imageDriveId, media: (ed.media || []).filter(m => m.driveId).map(m => ({ driveId: m.driveId, type: m.type, altText: m.altText || '' })), status, scheduledAt: ed.scheduledAt || '', error: '',
  };
  if (ed.id) p.id = ed.id;
  return p;
}
function validateBody(ed) {
  const body = ed.body || '';
  if (!body.trim()) return 'Write the post text first.';
  const n = cpLength(body);
  if (n > 3000) return `The post is ${n.toLocaleString()} characters. LinkedIn allows 3,000.`;
  return '';
}
function afterSave(post) {
  const np = normalizePost(post);
  const i = state.posts.findIndex(p => p.id === np.id);
  if (i >= 0) state.posts[i] = np; else state.posts.push(np);
  state.ed = workingCopy(np); state.sel = np.id; state.dirty = false;
  renderAll();
}

function closeEditor() {
  state.ed = null; state.sel = null; state.dirty = false; state.expanded = false;
  renderEditorPane();
  renderSidebar();
  updatePreview();
}

async function persist(status) {
  const ed = state.ed; if (!ed) return;
  if (status === 'draft' && !ed.title.trim() && !ed.body.trim()) { toast('Add a title or some text before saving.', { type: 'info' }); return; }
  if (status !== 'draft') { const err = validateBody(ed); if (err) { toast(err, { type: 'err' }); return; } }
  if (status === 'scheduled') {
    if (!ed.scheduledAt) { toast('Pick a publish date and time first.', { type: 'err' }); return; }
    if (toEpoch(parseStamp(ed.scheduledAt)) <= Date.now()) {
      const ok = await confirmDialog({ title: 'That time has passed', message: 'The post will go out on the next scheduler run, within about 15 minutes. Schedule it anyway?', ok: 'Schedule' });
      if (!ok) return;
    }
    if (!state.token.connected) {
      const ok = await confirmDialog({ title: 'LinkedIn is not connected', message: 'The post is saved as scheduled, but it waits until you connect LinkedIn.', ok: 'Schedule anyway' });
      if (!ok) return;
    }
  }
  try {
    const d = await busy(status === 'scheduled' ? 'Scheduling...' : 'Saving...', () => api('save', { post: toPayload(ed, status) }));
    afterSave(d.post);
    const when = d.post.scheduledAt ? human(parseStamp(d.post.scheduledAt)) : '';
    if (status === 'scheduled') {
      toast(`Scheduled for ${when}. It goes out within 15 minutes of that time.`);
      closeEditor();
    }
    else if (status === 'ready') toast('Marked ready.');
    else toast('Draft saved.');
  } catch (e) { toast(e.message, { type: 'err' }); }
}

async function aiAssist() {
  const ed = state.ed; if (!ed) return;
  const operation = $('#ai-operation').value, instruction = $('#ai-instruction').value.trim();
  if (operation === 'generate' && !ed.body.trim() && !instruction) { toast('Add a short brief in Direction before generating a post.', { type: 'info' }); $('#ai-instruction').focus(); return; }
  try {
    const d = await busy('Writing...', () => api('aiAssist', { operation, text: ed.body, instruction }));
    const output = $('#ai-output'); output.innerHTML = `<div class="assistant-result"></div><div class="assistant-actions"><button class="btn primary" type="button" data-act="use-ai">Replace post</button><button class="btn" type="button" data-act="insert-ai">Insert below</button></div>`; $('.assistant-result', output).textContent = d.text; output.classList.remove('hidden');
  } catch (e) { toast(e.message, { type: 'err' }); }
}
function useAi(mode) {
  const output = $('#ai-output'); const text = $('.assistant-result', output)?.textContent || ''; const ta = $('#f-body');
  if (!text || !ta || !state.ed) return;
  const value = mode === 'replace' ? text : (ta.value.trim() ? ta.value.trimEnd() + '\n\n' + text : text);
  ta.value = value; state.ed.body = value; state.dirty = true; updateCount(); updatePreview();
}
async function publishNow() {
  const ed = state.ed; if (!ed) return;
  const err = validateBody(ed);
  if (err) { toast(err, { type: 'err' }); return; }
  if (!state.token.connected) { toast('LinkedIn is not connected. Connect it first.', { type: 'err' }); return; }
  const ok = await confirmDialog({ title: 'Publish to LinkedIn now?', message: 'The post goes live on your profile straight away.', ok: 'Publish now' });
  if (!ok) return;
  try {
    const post = await busy(ed.imageDriveId ? 'Publishing with your image. This can take up to 20 seconds...' : 'Publishing to LinkedIn...', async () => {
      const saved = await api('save', { post: toPayload(ed, 'draft') });
      ed.id = saved.post.id; state.sel = saved.post.id; // a retry updates this row instead of adding another
      const r = await api('publishNow', { id: saved.post.id });
      return r.post;
    });
    afterSave(post);
    const link = liUrl(post.linkedinUrn);
    if (post.status === 'published') toast('Published to LinkedIn.', { link: link ? { href: link, text: 'View post' } : null, ms: 12000 });
    else toast('Publishing failed: ' + (post.error || 'unknown error'), { type: 'err', ms: 10000 });
  } catch (e) {
    toast(e.message, { type: 'err', ms: 8000 });
    refresh();
  }
}

async function deletePost() {
  const ed = state.ed; if (!ed || !ed.id) return;
  const ok = await confirmDialog({
    title: 'Delete this post?', danger: true, ok: 'Delete',
    message: ed.status === 'published' ? 'This removes it from the planner only. The post stays on LinkedIn.' : 'This removes it from your planner.',
  });
  if (!ok) return;
  try {
    await busy('Deleting...', () => api('delete', { id: ed.id }));
    state.posts = state.posts.filter(p => p.id !== ed.id);
    state.ed = null; state.sel = null; state.dirty = false;
    renderAll();
    toast('Post deleted.', { type: 'info' });
  } catch (e) { toast(e.message, { type: 'err' }); }
}

function selectedPosts() { return state.posts.filter(p => state.selected.has(p.id)); }
function bulkScheduleValue() { const value = $('#bulkScheduledAt')?.value || ''; return value ? value.replace('T', ' ') : ''; }
async function submitBulkAction() {
  if (bulkRunning) return;
  if (!selectedPosts().length) { syncBulkControls(); toast('Select one or more posts first.', { type: 'info' }); return; }
  const action = $('#bulkAction')?.value;
  if (!['draft', 'ready', 'scheduled', 'publish', 'delete'].includes(action)) { toast('Choose a bulk action first.', { type: 'info' }); $('#bulkAction')?.focus(); return; }
  bulkRunning = true; syncBulkControls();
  try {
    if (action === 'publish') await bulkPublish();
    else if (action === 'delete') await bulkDelete();
    else await bulkStatus(action);
  } finally { bulkRunning = false; syncBulkControls(); }
}
async function bulkStatus(status) {
  const posts = selectedPosts(); if (!posts.length) { toast('Select one or more posts first.', { type: 'info' }); return; }
  const scheduledAt = status === 'scheduled' ? bulkScheduleValue() : '';
  if (status === 'scheduled') {
    if (!validStamp(scheduledAt)) { toast('Choose a valid date and time before scheduling selected posts.', { type: 'err' }); $('#bulkScheduledAt')?.focus(); return; }
    const invalid = posts.find(p => validateBody(p));
    if (invalid) { toast(`${invalid.title || 'Untitled'}: ${validateBody(invalid)}`, { type: 'err' }); return; }
  }
  try { const d = await busy(`Marking selected posts ${status}...`, () => api('bulk', { operation: 'status', status, scheduledAt, ids: posts.map(p => p.id) })); state.selected.clear(); await refresh(); toast(`${d.count} post${d.count === 1 ? '' : 's'} updated.`); } catch (e) { toast(e.message, { type: 'err' }); }
}
async function bulkPublish() {
  const posts = selectedPosts(); if (!posts.length) { toast('Select one or more posts first.', { type: 'info' }); return; }
  if (!state.token.connected) { toast('LinkedIn is not connected. Connect it first.', { type: 'err' }); return; }
  if (!(await confirmDialog({ title: 'Publish selected posts?', message: `${posts.length} post${posts.length === 1 ? '' : 's'} will be sent to LinkedIn now.`, ok: 'Publish', danger: true }))) return;
  try { const d = await busy('Publishing selected posts...', () => api('bulk', { operation: 'publish', ids: posts.map(p => p.id) })); state.selected.clear(); await refresh(); const failed = (d.posts || []).filter(p => p.status !== 'published').length; toast(failed ? `Published ${posts.length - failed}; ${failed} failed.` : `Published ${posts.length} post${posts.length === 1 ? '' : 's'}.`, { type: failed ? 'err' : 'ok' }); } catch (e) { toast(e.message, { type: 'err' }); }
}
async function bulkDelete() {
  const posts = selectedPosts(); if (!posts.length) { toast('Select one or more posts first.', { type: 'info' }); return; }
  if (!(await confirmDialog({ title: 'Delete selected posts?', message: `This removes ${posts.length} post${posts.length === 1 ? '' : 's'} from the planner.`, ok: 'Delete', danger: true }))) return;
  try {
    const d = await busy('Deleting selected posts...', () => api('bulk', { operation: 'delete', ids: posts.map(p => p.id) }));
    const ids = new Set(posts.map(p => p.id));
    state.posts = state.posts.filter(p => !ids.has(p.id)); state.selected.clear();
    if (ids.has(state.sel)) { state.ed = null; state.sel = null; state.dirty = false; }
    renderAll(); await refresh();
    toast(`${d.count} post${d.count === 1 ? '' : 's'} deleted.`, { type: 'info' });
  } catch (e) { toast(e.message, { type: 'err' }); }
}
function download(name, content, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([content], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
function exportPosts(format) {
  const rows = state.posts.map(p => ({ series: p.series, day: p.day, title: p.title, body: p.body, imageDriveId: p.imageDriveId, media: p.media || [], status: p.status, scheduledAt: p.scheduledAt, publishedAt: p.publishedAt, linkedinUrn: p.linkedinUrn, error: p.error }));
  if (format === 'json') download('post-planner.json', JSON.stringify(rows, null, 2), 'application/json');
  else { const cols = ['series','day','title','body','imageDriveId','media','status','scheduledAt','publishedAt','linkedinUrn','error']; const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"'; download('post-planner.csv', [cols.join(','), ...rows.map(r => cols.map(c => q(c === 'media' ? JSON.stringify(r[c]) : r[c])).join(','))].join('\n'), 'text/csv'); }
  setExportOpen(false, true);
}
function setExportOpen(open, restoreFocus = false) {
  const toggle = $('#exportToggle'), options = $('#exportOptions');
  if (!toggle || !options) return;
  toggle.setAttribute('aria-expanded', String(open)); options.classList.toggle('hidden', !open);
  if (restoreFocus) toggle.focus();
}
function parseCsv(text) {
  text = text.replace(/^\uFEFF/, '');
  const table = [], row = []; let cell = '', mode = 'start';
  const fail = message => { throw new Error(`CSV row ${table.length + 1}, column ${row.length + 1}: ${message}`); };
  const finishCell = () => { row.push(cell); cell = ''; mode = 'start'; };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (mode === 'quoted') {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') mode = 'closed';
      else cell += ch;
    } else if (ch === ',') finishCell();
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      finishCell(); table.push(row.splice(0));
    } else if (ch === '"') {
      if (mode !== 'start') fail('unexpected quote; quote the entire field and double embedded quotes.');
      mode = 'quoted';
    } else {
      if (mode === 'closed') fail('unexpected text after a closing quote.');
      cell += ch; mode = 'unquoted';
    }
  }
  if (mode === 'quoted') fail('unclosed quoted field.');
  if (cell || row.length || mode !== 'start') { finishCell(); table.push(row); }
  const cols = (table.shift() || []).map(c => c.trim());
  if (!cols.length || cols.some(c => !c)) throw new Error('CSV header: every column needs a field name.');
  if (new Set(cols).size !== cols.length) throw new Error('CSV header: duplicate field names are not allowed.');
  if (!cols.includes('body')) throw new Error('CSV header: missing required body field.');
  return table.flatMap((r, i) => {
    if (r.length === 1 && r[0] === '') return [];
    if (r.length !== cols.length) throw new Error(`CSV row ${i + 2}: expected ${cols.length} fields but found ${r.length}.`);
    return [Object.fromEntries(cols.map((c, j) => [c, r[j]]))];
  });
}
function validStamp(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(raw);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(v => Number(v || 0));
  if (y < 1000 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo) || h > 23 || mi > 59 || s > 59) return null;
  const stamp = parseStamp(raw);
  return stamp && Number.isFinite(toEpoch(stamp)) ? fmtStamp(stamp) : null;
}
function parseImport(text, name) {
  if (!/\.(json|csv)$/i.test(name)) throw new Error('Choose a .json or .csv file to import.');
  text = text.replace(/^\uFEFF/, '');
  if (!text.trim()) throw new Error('The import file is empty.');
  let rows;
  if (name.toLowerCase().endsWith('.json')) { try { rows = JSON.parse(text); } catch (e) { throw new Error('Import JSON is invalid.'); } if (!Array.isArray(rows)) throw new Error('JSON import must be an array of posts.'); }
  else rows = parseCsv(text);
  if (!rows.length) throw new Error('The import file contains no posts.');
  if (rows.length > 500) throw new Error('Import is limited to 500 posts at a time.');
  const ids = new Set();
  return rows.map((r, i) => {
    const fail = (field, message) => { throw new Error(`Row ${i + 1}, ${field}: ${message}`); };
    if (!r || typeof r !== 'object' || Array.isArray(r)) fail('post', 'use an object with named fields.');
    const string = (field, fallback = '') => {
      if (r[field] == null) return fallback;
      if (typeof r[field] !== 'string') fail(field, 'must be text.');
      return r[field];
    };
    const body = string('body');
    if (!body.trim()) fail('body', 'post text is required.');
    if (cpLength(body) > 3000) fail('body', 'must be at most 3,000 characters.');
    const status = string('status').trim() || 'draft';
    if (!['draft', 'ready', 'scheduled', 'published', 'failed'].includes(status)) fail('status', 'use draft, ready, scheduled, published, or failed.');
    const scheduled = string('scheduledAt').trim(), published = string('publishedAt').trim();
    const scheduledAt = scheduled ? validStamp(scheduled) : '';
    const publishedAt = published ? validStamp(published) : '';
    if (scheduled && !scheduledAt) fail('scheduledAt', 'use a real date/time in YYYY-MM-DD HH:mm (IST) or ISO format with a time zone.');
    if (status === 'scheduled' && !scheduledAt) fail('scheduledAt', 'is required for scheduled posts.');
    if (published && !publishedAt) fail('publishedAt', 'use a real date/time in YYYY-MM-DD HH:mm (IST) or ISO format with a time zone.');
    const day = r.day == null || r.day === '' ? '' : Number(r.day);
    if (day !== '' && (!['number', 'string'].includes(typeof r.day) || !Number.isSafeInteger(day) || day < 1)) fail('day', 'must be a positive whole number or empty.');
    const image = string('imageDriveId').trim(), imageDriveId = image ? driveId(image) : '';
    if (image && !imageDriveId) fail('imageDriveId', 'use a valid Google Drive ID or share link.');
    let media = r.media == null || r.media === '' ? [] : r.media;
    if (typeof media === 'string') { try { media = JSON.parse(media); } catch (e) { fail('media', 'must contain valid JSON for an array of attachments.'); } }
    if (!Array.isArray(media)) fail('media', 'must be an array of attachments.');
    media = media.map((m, j) => {
      const field = `media[${j + 1}]`;
      if (!m || typeof m !== 'object' || Array.isArray(m)) fail(field, 'must be an attachment object.');
      const raw = m.driveId || m.id || '';
      if (typeof raw !== 'string' || !driveId(raw)) fail(`${field}.driveId`, 'use a valid Google Drive ID or share link.');
      if (m.type != null && typeof m.type !== 'string') fail(`${field}.type`, 'must be text.');
      const type = String(m.type || 'image').toLowerCase();
      if (!['image', 'document', 'video'].includes(type)) fail(`${field}.type`, 'use image, document, or video (planning only).');
      if (m.altText != null && typeof m.altText !== 'string') fail(`${field}.altText`, 'must be text.');
      return { driveId: driveId(raw), type, altText: m.altText || '' };
    });
    const title = string('title');
    if (!media.length && imageDriveId) media = [{ driveId: imageDriveId, type: 'image', altText: title }];
    if (status === 'scheduled') {
      if (media.length > 9) fail('media', 'scheduled posts support at most 9 attachments.');
      if (media.some(m => m.type === 'video')) fail('media', 'video is for planning only; it cannot be scheduled for publishing.');
      if (media.length > 1 && media.some(m => m.type !== 'image')) fail('media', 'use multiple images or one PDF document.');
    }
    const post = { series: string('series').trim(), day, title: title.trim(), body, imageDriveId: imageDriveId || media[0]?.driveId || '', media, status, scheduledAt, publishedAt, linkedinUrn: string('linkedinUrn'), error: string('error') };
    const id = string('id').trim();
    if (id) { if (ids.has(id)) fail('id', 'duplicate post ID in this file.'); ids.add(id); post.id = id; }
    return post;
  });
}
function importId() {
  return 'import-' + (typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join(''));
}
async function importPosts(file) {
  if (importRunning) return;
  importRunning = true;
  try {
    const text = await busy('Reading import file...', () => file.text());
    const rows = parseImport(text, file.name); // Validate every row before the first save.
    if (importSession?.text === text && importSession.name === file.name && importSession.completed.size === rows.length) { toast('This file has already been imported in this tab.', { type: 'info' }); return; }
    if (!(await guardDirty())) return;
    if (!importSession || importSession.text !== text || importSession.name !== file.name) {
      importSession = { text, name: file.name, rows: rows.map(post => ({ ...post, id: post.id || importId() })), completed: new Set() };
    }
    const session = importSession;
    let failure = null, failedRow = 0, refreshFailed = false;
    await busy('Importing posts...', async () => {
      for (let i = 0; i < session.rows.length; i += 1) {
        if (session.completed.has(i)) continue;
        $('#busyLabel').textContent = `Importing post ${i + 1} of ${session.rows.length}...`;
        try {
          const d = await api('save', { post: session.rows[i] });
          if (!d.post || d.post.id !== session.rows[i].id) throw new Error('The server did not confirm the saved post.');
          session.completed.add(i);
          const post = normalizePost(d.post), existing = state.posts.findIndex(p => p.id === post.id);
          if (existing < 0) state.posts.push(post); else state.posts[existing] = post;
        } catch (e) { failure = e; failedRow = i + 1; break; }
      }
      try { await loadAll(); } catch (e) { refreshFailed = true; }
    });
    if (session.completed.size) { state.ed = null; state.sel = null; state.dirty = false; }
    renderAll();
    const count = session.completed.size;
    if (failure) toast(`Imported ${count} of ${session.rows.length} posts. Row ${failedRow} was not confirmed: ${failure.message} Re-select the same unchanged file in this tab to resume safely.${refreshFailed ? ' Refresh also failed; the list may be incomplete.' : ''}`, { type: 'err', ms: 18000 });
    else toast(`Imported ${count} post${count === 1 ? '' : 's'}.${refreshFailed ? ' Refresh failed; reload to confirm the full list.' : ''}`, { type: refreshFailed ? 'info' : 'ok', ms: 9000 });
  } catch (e) { toast(e.message || 'Import failed.', { type: 'err', ms: 9000 }); }
  finally { importRunning = false; }
}

/* ---------- calendar ---------- */
function renderCalendar() {
  const { y, m } = state.cal;
  const byDay = {}; let undated = 0;
  state.posts.forEach(p => {
    const st = postStamp(p);
    if (!st) { if (p.status !== 'published') undated += 1; return; }
    (byDay[dayKey(st)] ||= []).push({ p, st });
  });
  Object.values(byDay).forEach(l => l.sort((a, b) => toEpoch(a.st) - toEpoch(b.st)));
  const first = dowOf(y, m, 1);
  const weeks = Math.ceil((first + daysIn(y, m)) / 7);
  const start = addDays({ y, m, d: 1, h: 0, mi: 0 }, -first);
  const todayKey = dayKey(nowIST());
  let cells = '';
  for (let i = 0; i < weeks * 7; i++) {
    const day = addDays(start, i), k = dayKey(day), list = byDay[k] || [];
    const chips = list.slice(0, 3).map(({ p, st }) =>
      `<button type="button" class="cp st-${stClass(p)}" data-act="open-post" data-id="${esc(p.id)}" title="${esc(timeLabel(st) + ' ' + (p.title || 'Untitled'))}">${esc(timeLabel(st))} ${esc(p.title || 'Untitled')}</button>`).join('');
    cells += `<div class="cell ${day.m !== m ? 'dim' : ''} ${k === todayKey ? 'today' : ''} ${k === state.calDay ? 'sel' : ''}" role="button" tabindex="0" data-act="cal-day" data-day="${k}"
      aria-label="${esc(dateLabel(day))}, ${list.length} post${list.length === 1 ? '' : 's'}"><span class="n">${day.d}</span>${chips}${list.length > 3 ? `<span class="more">+${list.length - 3} more</span>` : ''}</div>`;
  }
  const selSt = parseStamp(state.calDay + ' 00:00');
  const dayPosts = byDay[state.calDay] || [];
  $('#view').innerHTML = `<div class="cal-wrap">
    <section class="glass card">
      <div class="cal-top"><h2>${MONTHS[m - 1]} ${y}</h2>
        <button type="button" class="icon-btn" data-act="cal-prev" aria-label="Previous month">${icon('prev')}</button>
        <button type="button" class="icon-btn" data-act="cal-next" aria-label="Next month">${icon('next')}</button>
        <button type="button" class="btn" data-act="cal-today">Today</button><span class="spacer"></span>
        <button type="button" class="btn primary" data-act="new-post">${icon('plus')} New post</button></div>
      <div class="cal-dow">${DOW.map(d => `<span>${d}</span>`).join('')}</div>
      <div class="cal-grid">${cells}</div>
    </section>
    <div class="cal-side">
      <aside class="glass card">
        <h2>${esc(dateLabel(selSt))}</h2>
        <div class="day-list">${dayPosts.length
          ? dayPosts.map(({ p, st }) => postRow(p, `<span class="chip st-${stClass(p)}">${esc(timeLabel(st))}</span>`)).join('')
          : '<p class="muted">Nothing planned for this day.</p>'}</div>
        <button type="button" class="btn primary wide" data-act="cal-new" data-day="${state.calDay}">${icon('plus')} New post on this day</button>
        ${undated ? `<p class="hint">${undated} post${undated === 1 ? ' has' : 's have'} no date yet, so ${undated === 1 ? 'it is' : 'they are'} not on the calendar.</p>` : ''}
        <div class="legend"><span class="chip st-scheduled">scheduled</span><span class="chip st-published">published</span><span class="chip st-ready">ready</span><span class="chip">draft</span><span class="chip st-late">late or failed</span></div>
      </aside>
    </div></div>`;
}
function shiftMonth(dir) {
  let { y, m } = state.cal; m += dir;
  if (m < 1) { m = 12; y -= 1; } if (m > 12) { m = 1; y += 1; }
  state.cal = { y, m }; renderCalendar();
}

/* ---------- events ---------- */
document.addEventListener('click', e => {
  if (!e.target.closest('.export-tools')) setExportOpen(false);
  const t = e.target.closest('[data-act]'); if (!t) return;
  switch (t.dataset.act) {
    case 'view': setView(t.dataset.v); break;
    case 'theme': applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); break;
    case 'logout': logout(); break;
    case 'connect': connectLinkedIn(); break;
    case 'new-post': newPost(); break;
    case 'open-post': openPost(t.dataset.id); break;
    case 'close-editor': closeEditor(); break;
    case 'duplicate': newPost({ from: state.ed }); break;
    case 'device':
      state.device = t.dataset.d;
      $$('.seg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.d === state.device)));
      updatePreview(); break;
    case 'expand': state.expanded = !state.expanded; updatePreview(); break;
    case 'save-draft': persist('draft'); break;
    case 'save-ready': persist('ready'); break;
    case 'schedule': persist('scheduled'); break;
    case 'publish': publishNow(); break;
    case 'ai-assist': aiAssist(); break;
    case 'use-ai': useAi('replace'); break;
    case 'insert-ai': useAi('insert'); break;
    case 'delete': deletePost(); break;
    case 'add-media': if (state.ed) { state.ed.media ||= []; state.ed.media.push({ driveId: '', type: t.dataset.type || 'image', altText: '' }); state.dirty = true; renderEditorPane(); updatePreview(); } break;
    case 'remove-media': if (state.ed) { state.ed.media.splice(Number(t.dataset.i), 1); state.ed.imageDriveId = state.ed.media[0]?.driveId || ''; state.dirty = true; renderEditorPane(); updatePreview(); } break;
    case 'toggle-export': setExportOpen(t.getAttribute('aria-expanded') !== 'true'); break;
    case 'export-json': exportPosts('json'); break;
    case 'export-csv': exportPosts('csv'); break;
    case 'import': $('#importFile')?.click(); break;
    case 'cal-prev': shiftMonth(-1); break;
    case 'cal-next': shiftMonth(1); break;
    case 'cal-today': { const n = nowIST(); state.cal = { y: n.y, m: n.m }; state.calDay = dayKey(n); renderCalendar(); break; }
    case 'cal-day': state.calDay = t.dataset.day; renderCalendar(); break;
    case 'cal-new': newPost({ date: t.dataset.day }); break;
    default: break;
  }
});
document.addEventListener('change', e => { if (e.target.id === 'importFile' && e.target.files[0]) { importPosts(e.target.files[0]); e.target.value = ''; } });
document.addEventListener('change', e => {
  if (e.target.matches('.bulk-check')) {
    if (e.target.checked) state.selected.add(e.target.dataset.id); else state.selected.delete(e.target.dataset.id);
    syncBulkControls();
  }
  if (e.target.id === 'bulkAction') { state.bulkAction = e.target.value; syncBulkControls(); }
  if (e.target.id === 'bulkScheduledAt') state.bulkScheduledAt = e.target.value;
  if (e.target.id === 'selectAll') {
    visiblePostIds().forEach(id => e.target.checked ? state.selected.add(id) : state.selected.delete(id));
    renderSeries();
  }
});
document.addEventListener('input', e => { if (e.target.id === 'bulkScheduledAt') state.bulkScheduledAt = e.target.value; });
document.addEventListener('submit', e => {
  if (e.target.matches('.bulk-action-form')) { e.preventDefault(); submitBulkAction(); }
});
document.addEventListener('toggle', e => {
  if (e.target.matches('details[data-series]')) {
    const name = e.target.dataset.series;
    if (e.target.open) state.collapsedSeries.delete(name); else state.collapsedSeries.add(name);
  }
}, true);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && $('#exportToggle')?.getAttribute('aria-expanded') === 'true') { e.preventDefault(); setExportOpen(false, true); return; }
  if (e.key === 'Escape' && state.view === 'planner' && state.ed && $('#modal').classList.contains('hidden') && !$('#picker .pop:not(.hidden)')) {
    closeEditor();
    return;
  }
  const c = e.target.closest && e.target.closest('.cell');
  if (c && e.target === c && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); c.click(); }
});
window.addEventListener('beforeunload', e => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });

$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('#loginErr'); err.textContent = '';
  try {
    const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: $('#pw').value }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Sign in failed.');
    $('#pw').value = '';
    await busy('Loading your posts...', loadAll);
    showApp();
  } catch (x) { err.textContent = x.message; }
});

setInterval(() => {
  if (document.visibilityState === 'visible' && !busyCount && !$('#app').classList.contains('hidden')) refresh();
}, 60000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !busyCount && !$('#app').classList.contains('hidden')) refresh();
});

/* ---------- start ---------- */
(async function boot() {
  $('#brandLogo').innerHTML = icon('send', 18);
  $('#loginLogo').innerHTML = icon('send', 22);
  $('#logoutBtn').innerHTML = icon('logout');
  applyTheme(document.documentElement.dataset.theme);
  const n = nowIST();
  state.cal = { y: n.y, m: n.m }; state.calDay = dayKey(n);
  try {
    await busy('Loading your posts...', loadAll);
    showApp();
  } catch (e) {
    if ($('#login').classList.contains('hidden')) toast(e.message, { type: 'err', ms: 10000 });
  }
})();
