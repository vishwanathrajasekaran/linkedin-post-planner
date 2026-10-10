const { MAX_AGE, makeToken, setSession, sameText } = require('./_auth');

const sleep = ms => new Promise(r => setTimeout(r, ms));

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });

  const expected = process.env.APP_PASSWORD;
  if (!expected) return res.status(500).json({ error: 'APP_PASSWORD is not set on the server.' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const password = body && typeof body.password === 'string' ? body.password : '';

  if (!password || !sameText(password, expected)) {
    await sleep(800); // slows down guessing
    return res.status(401).json({ error: 'Wrong password.' });
  }

  try {
    setSession(req, res, makeToken(), MAX_AGE);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
  return res.status(200).json({ ok: true });
};
