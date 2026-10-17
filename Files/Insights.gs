/**
 * Post Planner - Insights (post statistics)
 *
 * Add this as a SECOND file in the same Apps Script project (File + > Script, name it Insights).
 * It shares everything with Code.gs, so there is nothing to import.
 *
 * Stats live in their own "Stats" tab, one row per snapshot, so you also get a history
 * (impressions on day 1, day 3, day 7 ...). Two ways to fill it:
 *   1. Manual: type the numbers from LinkedIn into the Insights tab of the app.
 *   2. Automatic: LinkedIn's Member Post Analytics API, once LinkedIn approves the
 *      r_member_postAnalytics permission for your app (see README, "Insights").
 */
const STATS_COLS = ['postId', 'capturedAt', 'impressions', 'reach', 'reactions', 'comments', 'reshares', 'source'];
const STATS_METRICS = { impressions: 'IMPRESSION', reach: 'MEMBERS_REACHED', reactions: 'REACTION', comments: 'COMMENT', reshares: 'RESHARE' };
const STATS_MIN_GAP_MS = 6 * 3600 * 1000; // do not re-read the same post from the API more than every 6 hours
const STATS_WINDOW_DAYS = 60;             // only keep refreshing posts published in the last 60 days
const STATS_BATCH = 12;                   // posts per sync call, keeps each call well inside the time limit

/* ---------- routing (called from route_ in Code.gs) ---------- */
function statsRoute_(action, b) {
  if (action === 'statsList') return { stats: statsRows_().slice(-3000), sync: { at: P.getProperty('STATS_SYNC_AT') || '', error: P.getProperty('STATS_SYNC_ERR') || '' } };
  if (action === 'statsSave') return withLock_(() => ({ stat: statsSave_(b.stat) }));
  if (action === 'statsSync') return withLock_(() => syncStats_());
  return null;
}

/* ---------- sheet ---------- */
function statsSheet_() {
  const ss = SpreadsheetApp.openById(P.getProperty('SHEET_ID'));
  let sh = ss.getSheetByName('Stats');
  if (!sh) {
    sh = ss.insertSheet('Stats');
    sh.appendRow(STATS_COLS);
    sh.getRange('B:B').setNumberFormat('@'); // keep the timestamps as text
    sh.setFrozenRows(1);
  }
  return sh;
}
function statNum_(v) { return v === '' || v == null || isNaN(Number(v)) ? null : Number(v); }
function statsRows_() {
  const v = statsSheet_().getDataRange().getValues(); v.shift();
  return v.filter(r => r[0]).map(r => ({
    postId: String(r[0]), capturedAt: cell_(r[1]), impressions: statNum_(r[2]), reach: statNum_(r[3]),
    reactions: statNum_(r[4]), comments: statNum_(r[5]), reshares: statNum_(r[6]), source: String(r[7] || '')
  }));
}
function appendStats_(rows) {
  if (!rows.length) return;
  const sh = statsSheet_();
  const data = rows.map(s => STATS_COLS.map(c => (s[c] === null || s[c] === undefined) ? '' : s[c]));
  sh.getRange(sh.getLastRow() + 1, 1, data.length, STATS_COLS.length).setValues(data);
}

/* ---------- manual entry ---------- */
function statsSave_(s) {
  if (!s || !s.postId) throw new Error('Missing post.');
  if (!readAll_().some(p => p.id === s.postId)) throw new Error('Post not found.');
  const row = { postId: s.postId, capturedAt: stamp_(new Date()), source: 'manual' };
  ['impressions', 'reach', 'reactions', 'comments', 'reshares'].forEach(k => {
    const raw = s[k];
    if (raw === '' || raw === null || raw === undefined) { row[k] = null; return; }
    const n = Number(raw);
    if (!isFinite(n) || n < 0 || Math.floor(n) !== n) throw new Error('Numbers must be whole numbers, zero or more.');
    row[k] = n;
  });
  if (row.impressions === null && row.reactions === null && row.comments === null && row.reshares === null && row.reach === null) throw new Error('Enter at least one number.');
  appendStats_([row]);
  return row;
}

/* ---------- LinkedIn Member Post Analytics API ---------- */
function statsToken_() { return P.getProperty('STATS_ACCESS_TOKEN') || P.getProperty('ACCESS_TOKEN'); }
function statsEntity_(urn) {
  const m = /^urn:li:(share|ugcPost):(\d+)$/.exec(String(urn || ''));
  return m ? '(' + m[1] + ':' + encodeURIComponent('urn:li:' + m[1] + ':' + m[2]) + ')' : null;
}
function metricRequests_(urn) {
  const ent = statsEntity_(urn);
  return Object.keys(STATS_METRICS).map(k => ({
    url: 'https://api.linkedin.com/rest/memberCreatorPostAnalytics?q=entity&entity=' + ent + '&queryType=' + STATS_METRICS[k] + '&aggregation=TOTAL',
    method: 'get', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + statsToken_(), 'LinkedIn-Version': LI_VERSION, 'X-Restli-Protocol-Version': '2.0.0' }
  }));
}
function readMetrics_(urn) {
  const keys = Object.keys(STATS_METRICS);
  const res = UrlFetchApp.fetchAll(metricRequests_(urn));
  const out = {};
  res.forEach((r, i) => {
    const code = r.getResponseCode();
    if (code === 401) throw new Error('LinkedIn sign-in expired. Reconnect LinkedIn first.');
    if (code === 403) throw new Error('LinkedIn has not given this app permission to read post analytics yet (needs the r_member_postAnalytics scope). Until then, enter the numbers by hand.');
    if (code === 429) throw new Error('LinkedIn rate limit reached. Try again later.');
    if (code === 404) { out.missing = true; return; }
    if (code >= 300) throw new Error('LinkedIn said (' + code + '): ' + r.getContentText().slice(0, 200));
    let el = null;
    try { el = (JSON.parse(r.getContentText()).elements || [])[0]; } catch (e) { /* leave null */ }
    out[keys[i]] = el && typeof el.count === 'number' ? el.count : 0;
  });
  return out;
}
function syncStats_() {
  if (!tokenInfo_().connected) throw new Error('LinkedIn sign-in expired. Reconnect LinkedIn first.');
  const now = Date.now(), cutoff = now - STATS_WINDOW_DAYS * 864e5;
  const lastApi = {};
  statsRows_().forEach(s => { if (s.source === 'api') { const d = toDate_(s.capturedAt); if (d) lastApi[s.postId] = Math.max(lastApi[s.postId] || 0, d.getTime()); } });
  const due = readAll_().filter(p => {
    if (p.status !== 'published' || !statsEntity_(p.linkedinUrn)) return false;
    const pub = toDate_(p.publishedAt);
    return pub && pub.getTime() >= cutoff && now - (lastApi[p.id] || 0) >= STATS_MIN_GAP_MS;
  }).sort((a, b) => (lastApi[a.id] || 0) - (lastApi[b.id] || 0));
  const batch = due.slice(0, STATS_BATCH), rows = [];
  try {
    batch.forEach(p => {
      const m = readMetrics_(p.linkedinUrn);
      if (m.missing) return;
      rows.push({ postId: p.id, capturedAt: stamp_(new Date()), impressions: m.impressions, reach: m.reach, reactions: m.reactions, comments: m.comments, reshares: m.reshares, source: 'api' });
    });
  } catch (err) {
    appendStats_(rows);
    P.setProperties({ STATS_SYNC_AT: stamp_(new Date()), STATS_SYNC_ERR: String(err.message || err).slice(0, 300) });
    throw err;
  }
  appendStats_(rows);
  P.setProperties({ STATS_SYNC_AT: stamp_(new Date()), STATS_SYNC_ERR: '' });
  return { synced: rows.length, remaining: due.length - batch.length };
}

/* ---------- optional daily automatic sync ---------- */
// Run enableStatsSync() once from the editor AFTER LinkedIn has approved analytics access.
// Note: setup() deletes all triggers, so run this again if you ever re-run setup().
function enableStatsSync() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'syncStatsDaily').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncStatsDaily').timeBased().everyDays(1).atHour(21).create(); // about 9 PM in the script time zone
}
function syncStatsDaily() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;
  try {
    for (let i = 0; i < 6; i++) { if (syncStats_().remaining <= 0) break; }
  } catch (err) { /* already recorded in STATS_SYNC_ERR */ } finally { lock.releaseLock(); }
}
