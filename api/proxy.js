// Forwards the app's requests to the Apps Script web app and adds the secret API key.
// The key and the Apps Script URL exist only in Vercel environment variables, never in the browser.
const { isAuthed } = require('./_auth');

const ACTIONS = new Set(['list', 'save', 'delete', 'bulk', 'publishNow', 'authUrl', 'statsList', 'statsSave', 'statsSync', 'topicList', 'topicSave', 'topicDelete', 'aiAssist']);

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  if (!isAuthed(req)) return res.status(401).json({ error: 'Not signed in.' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || !ACTIONS.has(body.action)) return res.status(400).json({ error: 'Unknown action.' });

  if (body.action === 'aiAssist') {
    const base = (process.env.AI_BASE_URL || '').trim().replace(/\/$/, '');
    const apiKey = (process.env.AI_API_KEY || '').trim();
    const model = (process.env.AI_MODEL || '').trim();
    if (!base || !apiKey || !model) return res.status(503).json({ error: 'AI writing is not configured. Set AI_BASE_URL, AI_API_KEY and AI_MODEL on the server.' });
    const prompts = { generate: 'Write a polished LinkedIn post from the topic or brief below.', rewrite: 'Rewrite the post to be clearer, more engaging and natural while preserving its meaning.', shorten: 'Shorten the post substantially while keeping the main point and a strong close.', expand: 'Expand the post with useful context and a compelling narrative without adding unsupported claims.', hook: 'Suggest three strong opening hooks for this post. Return one hook per line.' };
    const task = prompts[String(body.operation || 'rewrite')] || prompts.rewrite;
    const user = [task, body.instruction && `Additional direction: ${String(body.instruction).trim()}`, body.text ? `Current post:\n${String(body.text).trim()}` : 'Topic or brief: none provided.'].filter(Boolean).join('\n\n');
    try {
      const r = await fetch(base + '/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey }, body: JSON.stringify({ model, temperature: 0.7, messages: [{ role: 'system', content: 'You are a concise LinkedIn writing assistant. Return only the requested post text or hooks, with no preamble.' }, { role: 'user', content: user }] }) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return res.status(502).json({ error: data.error?.message || `AI provider returned HTTP ${r.status}.` });
      const text = data.choices?.[0]?.message?.content?.trim();
      if (!text) return res.status(502).json({ error: 'AI provider returned an empty response.' });
      return res.status(200).json({ text });
    } catch (e) { return res.status(502).json({ error: 'Could not reach the AI provider: ' + e.message }); }
  }

  const url = (process.env.APPS_SCRIPT_URL || '').trim();
  const key = process.env.API_KEY;
  if (!url || !key) return res.status(500).json({ error: 'The server is missing APPS_SCRIPT_URL or API_KEY.' });

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
