const { setSession } = require('./_auth');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  setSession(req, res, '', 0);
  return res.status(200).json({ ok: true });
};
