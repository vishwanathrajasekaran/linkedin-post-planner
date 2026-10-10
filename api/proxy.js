// Forwards the app's requests to the Apps Script web app and adds the secret API key.
// The key and the Apps Script URL exist only in Vercel environment variables, never in the browser.
const { isAuthed } = require('./_auth');

const ACTIONS = new Set(['list', 'save', 'delete', 'publishNow', 'authUrl']);

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  if (!isAuthed(req)) return res.status(401).json({ error: 'Not signed in.' });

  const url = (process.env.APPS_SCRIPT_URL || '').trim();
  const key = process.env.API_KEY;
  if (!url || !key) return res.status(500).json({ error: 'The server is missing APPS_SCRIPT_URL or API_KEY.' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || !ACTIONS.has(body.action)) return res.status(400).json({ error: 'Unknown action.' });

  try {
    // Apps Script answers a POST with a redirect to the result; fetch follows it automatically.
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...body, key }), // key last, so the browser can never override it
      redirect: 'follow',
    });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch (e) {
      return res.status(502).json({ error: 'Apps Script did not return data. Check that the web app is deployed with access set to Anyone.' });
    }
    return res.status(200).json(data);
  } catch (e) {
    return res.status(502).json({ error: 'Could not reach Apps Script: ' + e.message });
  }
};
