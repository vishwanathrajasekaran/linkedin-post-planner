/* Pure helpers: IST time, LinkedIn text styling, Google Drive links, preview text.
   No DOM access, so the same file runs in the browser and in Node tests. */

/* ---------- time: everything is IST (UTC+05:30, no daylight saving) ---------- */
const IST_MS = 330 * 60000;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad2 = n => String(n).padStart(2, '0');

function fromEpoch(ms) {
  const d = new Date(ms + IST_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes() };
}
function toEpoch(st) { return Date.UTC(st.y, st.m - 1, st.d, st.h, st.mi) - IST_MS; }
function nowIST() { return fromEpoch(Date.now()); }

// Accepts "yyyy-MM-dd HH:mm" (read as IST) or any ISO string with a zone (converted to IST).
function parseStamp(s) {
  if (!s) return null;
  s = String(s).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::\d{2})?$/.exec(s);
  if (m) return { y: +m[1], m: +m[2], d: +m[3], h: +m[4], mi: +m[5] };
  const t = Date.parse(s);
  return isNaN(t) ? null : fromEpoch(t);
}
function fmtStamp(st) { return `${st.y}-${pad2(st.m)}-${pad2(st.d)} ${pad2(st.h)}:${pad2(st.mi)}`; }
function dayKey(st) { return `${st.y}-${pad2(st.m)}-${pad2(st.d)}`; }
function dowOf(y, m, d) { return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); }
function daysIn(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
function addMinutes(st, n) { return fromEpoch(toEpoch(st) + n * 60000); }
function addDays(st, n) { return addMinutes(st, n * 1440); }
function timeLabel(st) { return `${st.h % 12 || 12}:${pad2(st.mi)} ${st.h < 12 ? 'AM' : 'PM'}`; }
function dateLabel(st) { return `${DOW[dowOf(st.y, st.m, st.d)]}, ${st.d} ${MONTHS[st.m - 1].slice(0, 3)} ${st.y}`; }
function human(st) { return `${dateLabel(st)}, ${timeLabel(st)} IST`; }

/* ---------- LinkedIn text styling (Unicode lookalikes) ---------- */
// [uppercase start, lowercase start, digit start or null]
const STYLE_BASES = {
  bold: [0x1D400, 0x1D41A, 0x1D7CE],
  italic: [0x1D434, 0x1D44E, null],
  boldItalic: [0x1D468, 0x1D482, null],
  mono: [0x1D670, 0x1D68A, 0x1D7F6],
};
const FWD = {};
const REV = {};
for (const [style, [U, L, D]] of Object.entries(STYLE_BASES)) {
  FWD[style] = {};
  for (let i = 0; i < 26; i++) {
    FWD[style][String.fromCharCode(65 + i)] = String.fromCodePoint(U + i);
    FWD[style][String.fromCharCode(97 + i)] = String.fromCodePoint(L + i);
  }
  if (D !== null) for (let i = 0; i < 10; i++) FWD[style][String(i)] = String.fromCodePoint(D + i);
}
FWD.italic.h = 'ℎ'; // italic small h lives at a different code point
for (const style of Object.keys(FWD)) {
  for (const [plain, styled] of Object.entries(FWD[style])) REV[styled] = { plain, style };
}

const MARK_UNDERLINE = '̲';
const MARK_STRIKE = '̶';
const INDENT = '  '; // two em spaces; LinkedIn trims ordinary leading spaces

const isAlnum = ch => /^[A-Za-z0-9]$/.test(ch);
const plainOf = ch => (REV[ch] ? REV[ch].plain : ch);
const styleOf = ch => (REV[ch] ? REV[ch].style : (isAlnum(ch) ? 'plain' : null));

function restyle(str, style) {
  let out = '';
  for (const ch of str) {
    const p = plainOf(ch);
    out += style === 'plain' ? p : ((FWD[style] && FWD[style][p]) || p);
  }
  return out;
}
function dominantStyle(str) {
  for (const ch of str) { const s = styleOf(ch); if (s) return s; }
  return null;
}
// kind: 'bold' or 'italic'. Bold + italic combine into bold italic.
function toggleBoldItalic(str, kind) {
  const cur = dominantStyle(str) || 'plain';
  let b = cur === 'bold' || cur === 'boldItalic';
  let i = cur === 'italic' || cur === 'boldItalic';
  if (kind === 'bold') b = !b; else i = !i;
  return restyle(str, b && i ? 'boldItalic' : b ? 'bold' : i ? 'italic' : 'plain');
}
function toggleMono(str) {
  return restyle(str, dominantStyle(str) === 'mono' ? 'plain' : 'mono');
}
function clusters(str) {
  const out = [];
  for (const ch of str) {
    if ((ch === MARK_UNDERLINE || ch === MARK_STRIKE) && out.length) out[out.length - 1].marks.add(ch);
    else out.push({ base: ch, marks: new Set() });
  }
  return out;
}
function toggleMark(str, mark) {
  const cl = clusters(str);
  const targets = cl.filter(c => !/\s/.test(c.base));
  if (!targets.length) return str;
  const all = targets.every(c => c.marks.has(mark));
  targets.forEach(c => (all ? c.marks.delete(mark) : c.marks.add(mark)));
  return cl.map(c => c.base + [...c.marks].sort().join('')).join('');
}
function clearFormatting(str) {
  return restyle(str, 'plain').replace(/[̶̲]/g, '');
}

/* line-based tools: each takes and returns the full text of the selected lines */
function indentLines(text) {
  return text.split('\n').map(l => (l.trim() === '' ? l : INDENT + l)).join('\n');
}
function outdentLines(text) {
  return text.split('\n').map(l => (l.startsWith(INDENT) ? l.slice(INDENT.length) : l.replace(/^[ \t ]{1,2}/, ''))).join('\n');
}
function toggleBullets(text) {
  const lines = text.split('\n');
  const filled = lines.filter(l => l.trim() !== '');
  const all = filled.length > 0 && filled.every(l => /^\s*•\s/.test(l));
  return lines.map(l => {
    if (l.trim() === '') return l;
    return all ? l.replace(/^(\s*)•\s/, '$1') : l.replace(/^(\s*)(?:•\s|\d+\.\s)?/, '$1• ');
  }).join('\n');
}
function toggleNumbers(text) {
  const lines = text.split('\n');
  const filled = lines.filter(l => l.trim() !== '');
  const all = filled.length > 0 && filled.every(l => /^\s*\d+\.\s/.test(l));
  let n = 0;
  return lines.map(l => {
    if (l.trim() === '') return l;
    if (all) return l.replace(/^(\s*)\d+\.\s/, '$1');
    n += 1;
    return l.replace(/^(\s*)(?:•\s|\d+\.\s)?/, `$1${n}. `);
  }).join('\n');
}
const cpLength = s => Array.from(s).length;

/* ---------- Google Drive links ---------- */
function driveId(input) {
  const s = String(input || '').trim();
  if (!s) return '';
  const m = s.match(/\/d\/([A-Za-z0-9_-]{10,})/) || s.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{20,}$/.test(s) ? s : '';
}
const driveLink = id => (id ? `https://drive.google.com/file/d/${id}/view` : '');

/* ---------- preview text ---------- */
const escHtml = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Shows the first few lines or characters, like the feed does before "see more".
function previewCut(text, limit, maxLines = 3) {
  const chars = Array.from(text);
  let cut = chars.length > limit ? limit : chars.length;
  let newlines = 0;
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === '\n' && ++newlines >= maxLines) { cut = Math.min(cut, i); break; }
  }
  if (cut >= chars.length) return { shown: text, more: false };
  return { shown: chars.slice(0, cut).join('').replace(/\s+$/, ''), more: true };
}
function previewHtml(text) {
  return escHtml(text).replace(/(^|[\s(])(#[\p{L}\p{N}_]+)/gu, '$1<span class="li-tag">$2</span>');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    IST_MS, MONTHS, DOW, pad2, fromEpoch, toEpoch, nowIST, parseStamp, fmtStamp, dayKey, dowOf, daysIn, addMinutes, addDays,
    timeLabel, dateLabel, human, restyle, dominantStyle, toggleBoldItalic, toggleMono, toggleMark, clearFormatting,
    indentLines, outdentLines, toggleBullets, toggleNumbers, cpLength, driveId, driveLink, previewCut, previewHtml,
    MARK_UNDERLINE, MARK_STRIKE, INDENT,
  };
}
