/**
 * LinkedIn Post Planner - Apps Script backend (v2)
 *
 * Data lives in the "Posts" tab of this Google Sheet.
 * All dates in the sheet and in the app are IST (Asia/Kolkata), stored as "yyyy-MM-dd HH:mm".
 * Setup and update steps are at the bottom of this file.
 */
const COLS = ['id','series','day','title','body','imageDriveId','status','scheduledAt','publishedAt','linkedinUrn','error'];
const LI_VERSION = '202608';
const TZ = 'Asia/Kolkata';
const STAMP = 'yyyy-MM-dd HH:mm';
const MAX_POST_CHARS = 3000;
const P = PropertiesService.getScriptProperties();

/* ---------- one-time setup (run from the editor) ---------- */
function setup() {
  const ss = SpreadsheetApp.getActive();
  P.setProperty('SHEET_ID', ss.getId());
  let sh = ss.getSheetByName('Posts') || ss.insertSheet('Posts');
  if (sh.getLastRow() === 0) sh.appendRow(COLS);
  sh.getRange('H:I').setNumberFormat('@'); // keep date stamps as text
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('publishDue').timeBased().everyMinutes(15).create();
}

/* ---------- time helpers (always IST) ---------- */
function toDate_(s) {
  if (!s) return null;
  if (s instanceof Date) return s;
  s = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s)) return Utilities.parseDate(s, TZ, STAMP);
  const d = new Date(s); // older rows may hold ISO/UTC text
  return isNaN(d.getTime()) ? null : d;
}
function stamp_(d) { return Utilities.formatDate(d, TZ, STAMP); }

/* ---------- sheet helpers ---------- */
function sheet_() { return SpreadsheetApp.openById(P.getProperty('SHEET_ID')).getSheetByName('Posts'); }
function cell_(v) { return v instanceof Date ? stamp_(v) : v; }
function rowToObj_(r) { const o = {}; COLS.forEach((c, i) => o[c] = cell_(r[i])); return o; }
function readAll_() {
  const v = sheet_().getDataRange().getValues(); v.shift();
  return v.filter(r => r[0]).map(rowToObj_);
}
function driveId_(s) {
  s = String(s || '').trim();
  if (!s) return '';
  const m = s.match(/\/d\/([A-Za-z0-9_-]{10,})/) || s.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{20,}$/.test(s) ? s : '';
}
function validateForPublish_(p) {
  if (!String(p.body || '').trim()) throw new Error('The post text is empty.');
  if (Array.from(String(p.body)).length > MAX_POST_CHARS) throw new Error('The post is longer than ' + MAX_POST_CHARS + ' characters.');
}
function save_(input) {
  const sh = sheet_();
  const p = Object.assign({}, input);
  if (p.imageDriveId !== undefined) p.imageDriveId = driveId_(p.imageDriveId);
  if (p.scheduledAt !== undefined) { const d = toDate_(p.scheduledAt); p.scheduledAt = d ? stamp_(d) : ''; }
  const vals = sh.getDataRange().getValues();
  let idx = -1;
  if (p.id) idx = vals.findIndex((r, i) => i > 0 && r[0] === p.id);
  if (!p.id) { p.id = Utilities.getUuid().slice(0, 8); p.status = p.status || 'draft'; }
  const old = idx > 0 ? rowToObj_(vals[idx]) : {};
  const merged = Object.assign({}, old, p);
  if (merged.status === 'scheduled') {
    if (!merged.scheduledAt) throw new Error('Pick a publish date and time first.');
    validateForPublish_(merged);
  }
  const row = COLS.map(c => (merged[c] === undefined || merged[c] === null) ? '' : merged[c]);
  if (idx > 0) sh.getRange(idx + 1, 1, 1, COLS.length).setValues([row]);
  else sh.appendRow(row);
  return merged;
}
function delete_(id) {
  const sh = sheet_();
  const vals = sh.getDataRange().getValues();
  const idx = vals.findIndex((r, i) => i > 0 && r[0] === id);
  if (idx > 0) sh.deleteRow(idx + 1);
}

/* ---------- web app ---------- */
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function h_(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function page_(title, message) {
  return HtmlService.createHtmlOutput(
    '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0b1422;color:#eef4fb;font-family:-apple-system,Segoe UI,sans-serif">' +
    '<div style="max-width:420px;padding:28px;text-align:center"><h2 style="margin:0 0 10px">' + h_(title) + '</h2>' +
    '<p style="margin:0;color:#b6c6d8;line-height:1.5">' + h_(message) + '</p></div>' +
    '<script>setTimeout(function(){try{window.top.close()}catch(e){}},2500)</script>'
  ).setTitle(title);
}

// GET is used only by LinkedIn's OAuth redirect. The app itself talks to doPost.
function doGet(e) {
  const q = (e && e.parameter) || {};
  if (q.error) return page_('LinkedIn returned an error', q.error + (q.error_description ? ': ' + q.error_description : ''));
  if (q.code) return oauthCallback_(q);
  return page_('Post Planner backend', 'This address is used by the Post Planner app.');
}
function doPost(e) {
  let b;
  try { b = JSON.parse(e.postData.contents); } catch (err) { return json_({ error: 'Bad request' }); }
  if (!b || b.key !== P.getProperty('API_KEY')) return json_({ error: 'unauthorized' });
  return json_(route_(b.action, b));
}
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) throw new Error('The scheduler is busy. Try again in a moment.');
  try { return fn(); } finally { lock.releaseLock(); }
}
function route_(action, b) {
  try {
    if (action === 'list') return { posts: readAll_(), token: tokenInfo_() };
    if (action === 'save') return { post: save_(b.post) };
    if (action === 'delete') { delete_(b.id); return { ok: true }; }
    if (action === 'publishNow') return withLock_(() => ({ post: publish_(readAll_().find(x => x.id === b.id)) }));
    if (action === 'authUrl') return { url: authUrl_() };
    const s = statsRoute_(action, b); // Insights.gs
    if (s) return s;
    return { error: 'Unknown action' };
  } catch (err) { return { error: String(err.message || err) }; }
}

/* ---------- LinkedIn OAuth (personal profile, w_member_social) ---------- */
function redirectUri_() { return (P.getProperty('REDIRECT_URI') || ScriptApp.getService().getUrl()).trim(); }
function authUrl_() {
  const state = Utilities.getUuid();
  CacheService.getScriptCache().put('state_' + state, '1', 600);
  return 'https://www.linkedin.com/oauth/v2/authorization?response_type=code' +
    '&client_id=' + P.getProperty('CLIENT_ID') +
    '&redirect_uri=' + encodeURIComponent(redirectUri_()) +
    '&scope=' + encodeURIComponent('openid profile w_member_social' + (P.getProperty('EXTRA_SCOPES') ? ' ' + P.getProperty('EXTRA_SCOPES').trim() : '')) + '&state=' + state;
}
function oauthCallback_(q) {
  if (!CacheService.getScriptCache().get('state_' + q.state)) return page_('Link expired', 'Go back to Post Planner and click Connect LinkedIn again.');
  const r = UrlFetchApp.fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'post', muteHttpExceptions: true,
    payload: { grant_type: 'authorization_code', code: q.code, redirect_uri: redirectUri_(),
      client_id: P.getProperty('CLIENT_ID'), client_secret: P.getProperty('CLIENT_SECRET') }
  });
  const t = JSON.parse(r.getContentText());
  if (!t.access_token) return page_('Could not connect', 'Token exchange failed: ' + r.getContentText());
  const u = JSON.parse(UrlFetchApp.fetch('https://api.linkedin.com/v2/userinfo',
    { headers: { Authorization: 'Bearer ' + t.access_token } }).getContentText());
  P.setProperties({
    ACCESS_TOKEN: t.access_token, EXPIRES_AT: String(Date.now() + t.expires_in * 1000),
    PERSON_URN: 'urn:li:person:' + u.sub, NAME: u.name || 'LinkedIn member', PICTURE: u.picture || ''
  });
  return page_('LinkedIn connected', 'Connected as ' + (u.name || 'you') + '. You can close this tab and return to Post Planner.');
}
function loadProfile_() {
  const u = JSON.parse(UrlFetchApp.fetch('https://api.linkedin.com/v2/userinfo',
    { headers: { Authorization: 'Bearer ' + P.getProperty('ACCESS_TOKEN') } }).getContentText());
  P.setProperties({ NAME: u.name || 'LinkedIn member', PICTURE: u.picture || '' });
}
function tokenInfo_() {
  const exp = Number(P.getProperty('EXPIRES_AT') || 0);
  const connected = !!P.getProperty('ACCESS_TOKEN') && exp > Date.now();
  if (connected && !P.getProperty('NAME')) { try { loadProfile_(); } catch (e) { /* name stays blank */ } }
  const pic = P.getProperty('PICTURE') || '';
  return { connected: connected, expiresAt: exp, name: P.getProperty('NAME') || '', picture: /^https?:/.test(pic) ? pic : '' };
}

/* ---------- publishing ---------- */
function liHeaders_() {
  return { Authorization: 'Bearer ' + P.getProperty('ACCESS_TOKEN'), 'LinkedIn-Version': LI_VERSION, 'X-Restli-Protocol-Version': '2.0.0' };
}
function escapeText_(s) { return String(s).replace(/([\\|{}@\[\]()<>*_~])/g, '\\$1'); }

function uploadImage_(fileId) {
  const owner = P.getProperty('PERSON_URN');
  const ir = UrlFetchApp.fetch('https://api.linkedin.com/rest/images?action=initializeUpload', {
    method: 'post', contentType: 'application/json', headers: liHeaders_(), muteHttpExceptions: true,
    payload: JSON.stringify({ initializeUploadRequest: { owner } })
  });
  if (ir.getResponseCode() !== 200) throw new Error('LinkedIn image setup failed: ' + ir.getContentText().slice(0, 200));
  const init = JSON.parse(ir.getContentText()).value;
  let blob;
  try { blob = DriveApp.getFileById(fileId).getBlob(); }
  catch (e) { throw new Error('Could not read the image from Google Drive. Check the link and that your account can open the file.'); }
  const up = UrlFetchApp.fetch(init.uploadUrl, {
    method: 'put', headers: { Authorization: 'Bearer ' + P.getProperty('ACCESS_TOKEN') },
    payload: blob.getBytes(), contentType: blob.getContentType(), muteHttpExceptions: true
  });
  if (up.getResponseCode() >= 300) throw new Error('LinkedIn rejected the image (' + up.getResponseCode() + '). Use a JPG, PNG or GIF under 5 MB.');
  return init.image;
}

function publish_(post) {
  if (!post) throw new Error('Post not found.');
  if (post.status === 'published') throw new Error('This post is already published.');
  if (!tokenInfo_().connected) throw new Error('LinkedIn sign-in expired. Reconnect LinkedIn first.');
  validateForPublish_(post);
  try {
    const body = {
      author: P.getProperty('PERSON_URN'), commentary: escapeText_(post.body),
      visibility: 'PUBLIC', lifecycleState: 'PUBLISHED', isReshareDisabledByAuthor: false,
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] }
    };
    if (post.imageDriveId) body.content = { media: { id: uploadImage_(post.imageDriveId), altText: post.title || '' } };
    const r = UrlFetchApp.fetch('https://api.linkedin.com/rest/posts', {
      method: 'post', contentType: 'application/json', headers: liHeaders_(), payload: JSON.stringify(body), muteHttpExceptions: true
    });
    if (r.getResponseCode() !== 201) throw new Error('LinkedIn said: ' + r.getContentText().slice(0, 300));
    const h = r.getAllHeaders(); const urn = h['x-restli-id'] || h['X-RestLi-Id'] || '';
    return save_({ id: post.id, status: 'published', publishedAt: stamp_(new Date()), linkedinUrn: urn, error: '' });
  } catch (err) {
    return save_({ id: post.id, status: 'failed', error: String(err.message || err).slice(0, 300) });
  }
}

/* runs every 15 minutes via trigger */
function publishDue() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;
  try {
    if (!tokenInfo_().connected) return; // hold scheduled posts until you reconnect
    const now = new Date();
    readAll_().filter(p => {
      const d = toDate_(p.scheduledAt);
      return p.status === 'scheduled' && d && d <= now;
    }).forEach(p => publish_(p));
  } finally { lock.releaseLock(); }
}

/*
SETUP (first time)
1. Create a Google Sheet, Extensions > Apps Script, paste this file. Run setup() once.
2. Project Settings > Script properties: CLIENT_ID, CLIENT_SECRET (from your LinkedIn app) and API_KEY (a long random string).
3. Deploy > New deployment > Web app (execute as: Me, access: Anyone). Copy the /exec URL.
4. In the LinkedIn app's Auth tab, add that /exec URL as an Authorized redirect URL.
5. Put the /exec URL and API_KEY into the Vercel environment variables (see the README in the site folder).

UPDATING an existing deployment
Paste this file over the old one, save, then Deploy > Manage deployments > pencil icon > Version: New version > Deploy.
Editing the existing deployment keeps the same /exec URL, so nothing else changes.
*/
