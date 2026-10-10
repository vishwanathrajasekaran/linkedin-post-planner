// Shared helpers for the password gate. Files starting with "_" are not exposed as routes by Vercel.
const crypto = require('crypto');

const COOKIE = 'pp_session';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error('SESSION_SECRET is not set (use at least 16 random characters).');
  return s;
}

function sign(value) {
  return crypto.createHmac('sha256', secret()).update(value).digest('base64url');
}

function makeToken() {
  const exp = String(Math.floor(Date.now() / 1000) + MAX_AGE);
  return exp + '.' + sign(exp);
}

function verifyToken(token) {
  if (!token) return false;
  const [exp, sig] = String(token).split('.');
  if (!exp || !sig) return false;
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(exp));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  return Number(exp) > Date.now() / 1000;
}

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  });
  return out;
}

function isAuthed(req) {
  try { return verifyToken(parseCookies(req.headers.cookie)[COOKIE]); } catch (e) { return false; }
}

function setSession(req, res, value, maxAge) {
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`);
}

function sameText(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

module.exports = { MAX_AGE, makeToken, isAuthed, setSession, sameText };
