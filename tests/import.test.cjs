'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { frontend, backend, fixtures, plain } = require('./helpers.cjs');

function parser() {
  const app = frontend();
  return {
    parse(text, name = 'posts.json') {
      app.context.text = text; app.context.name = name;
      return plain(app.run('parseImport(text, name)'));
    },
  };
}

test('JSON import normalizes IST times, emoji, media, and published metadata', () => {
  const { parse } = parser();
  const [p] = parse('\uFEFF' + JSON.stringify([{
    body: 'Hello 🚀', day: '30', status: 'published', title: ' Report ', series: ' Series ',
    scheduledAt: '2026-10-23T02:30:00Z', publishedAt: '2026-10-23 08:05',
    linkedinUrn: 'urn:li:share:123', error: '',
    media: [{ driveId: 'https://drive.google.com/file/d/01234567890123456789/view', type: 'document', altText: 'PDF' }],
  }]), 'POSTS.JSON');
  assert.equal(p.day, 30);
  assert.equal(p.scheduledAt, '2026-10-23 08:00');
  assert.equal(p.publishedAt, '2026-10-23 08:05');
  assert.equal(p.linkedinUrn, 'urn:li:share:123');
  assert.equal(p.title, 'Report');
  assert.equal(p.media[0].driveId, '01234567890123456789');
  assert.equal(p.media[0].type, 'document');
});

test('CSV import accepts BOM, CRLF, quotes, commas, multiline fields and JSON media', () => {
  const { parse } = parser();
  const [p] = parse('\uFEFFtitle,body,media,day\r\n"A, B","First ""quote""\r\nSecond line 🚀","[{""driveId"":""01234567890123456789"",""type"":""image""}]",30\r\n', 'posts.csv');
  assert.equal(p.title, 'A, B');
  assert.equal(p.body, 'First "quote"\r\nSecond line 🚀');
  assert.equal(p.day, 30);
  assert.equal(p.media[0].driveId, '01234567890123456789');
});

test('legacy imageDriveId is retained as an image attachment', () => {
  const [p] = parser().parse(JSON.stringify([{ body: 'Legacy', imageDriveId: '01234567890123456789', title: 'Alt' }]));
  assert.deepEqual(p.media, [{ driveId: '01234567890123456789', type: 'image', altText: 'Alt' }]);
});

const invalidFiles = [
  ['unsupported extension', '[]', 'posts.txt', /\.json or \.csv/],
  ['empty text', '', 'posts.json', /empty/],
  ['bad JSON', '[{', 'posts.json', /JSON is invalid/],
  ['JSON object', '{}', 'posts.json', /array of posts/],
  ['empty JSON array', '[]', 'posts.json', /no posts/],
  ['missing body header', 'title\nHello', 'posts.csv', /missing required body/],
  ['empty header', 'body,\nHello,World', 'posts.csv', /every column/],
  ['duplicate header', 'body,body\nHello,World', 'posts.csv', /duplicate/],
  ['unclosed CSV quote', 'body\n"Hello', 'posts.csv', /unclosed quoted field/],
  ['CSV stray quote', 'body\nHe"llo', 'posts.csv', /unexpected quote/],
  ['text after closing quote', 'body\n"Hello"oops', 'posts.csv', /unexpected text/],
  ['too many CSV fields', 'body\nHello,World', 'posts.csv', /expected 1 fields/],
  ['too few CSV fields', 'body,title\nHello', 'posts.csv', /expected 2 fields/],
  ['CSV header without posts', 'body,title\n', 'posts.csv', /no posts/],
];
for (const [name, text, file, error] of invalidFiles) {
  test(`import rejects ${name}`, () => assert.throws(() => parser().parse(text, file), error));
}

const invalidRows = [
  ['null post', null, /Row 1, post/],
  ['array post', [], /Row 1, post/],
  ['missing body', {}, /Row 1, body/],
  ['blank body', { body: '  ' }, /Row 1, body/],
  ['numeric body', { body: 42 }, /Row 1, body/],
  ['overlong body', { body: '🚀'.repeat(3001) }, /3,000/],
  ['unknown status', { body: 'Hello', status: 'publish' }, /Row 1, status/],
  ['scheduled without time', { body: 'Hello', status: 'scheduled' }, /scheduledAt/],
  ['impossible date', { body: 'Hello', scheduledAt: '2026-02-30 12:00' }, /scheduledAt/],
  ['impossible hour', { body: 'Hello', scheduledAt: '2026-10-23 24:00' }, /scheduledAt/],
  ['impossible minute', { body: 'Hello', scheduledAt: '2026-10-23 12:60' }, /scheduledAt/],
  ['invalid published date', { body: 'Hello', publishedAt: '2026-02-29 12:00' }, /publishedAt/],
  ['negative day', { body: 'Hello', day: -1 }, /Row 1, day/],
  ['fractional day', { body: 'Hello', day: 1.5 }, /Row 1, day/],
  ['boolean day', { body: 'Hello', day: true }, /Row 1, day/],
  ['bad legacy image', { body: 'Hello', imageDriveId: 'invalid' }, /imageDriveId/],
  ['malformed media JSON', { body: 'Hello', media: '[oops' }, /Row 1, media/],
  ['media object', { body: 'Hello', media: {} }, /Row 1, media/],
  ['invalid media ID', { body: 'Hello', media: [{ driveId: 'invalid' }] }, /media\[1\].driveId/],
  ['invalid media type', { body: 'Hello', media: [{ driveId: '01234567890123456789', type: 'audio' }] }, /media\[1\].type/],
  ['invalid alt text', { body: 'Hello', media: [{ driveId: '01234567890123456789', altText: 42 }] }, /media\[1\].altText/],
  ['scheduled video', { body: 'Hello', status: 'scheduled', scheduledAt: '2026-10-23 12:00', media: [{ driveId: '01234567890123456789', type: 'video' }] }, /video is for planning/],
];
for (const [name, row, error] of invalidRows) {
  test(`import rejects ${name} with a field-specific error`, () => assert.throws(() => parser().parse(JSON.stringify([row])), error));
}

test('500-row boundary, Unicode length and duplicate IDs are validated', () => {
  const { parse } = parser();
  assert.equal(parse(JSON.stringify(Array.from({ length: 500 }, () => ({ body: 'Hello' })))).length, 500);
  assert.throws(() => parse(JSON.stringify(Array.from({ length: 501 }, () => ({ body: 'Hello' })))), /500/);
  assert.equal(parse(JSON.stringify([{ body: '🚀'.repeat(3000) }]))[0].body.length, 6000);
  assert.throws(() => parse(JSON.stringify([{ id: 'same', body: 'A' }, { id: 'same', body: 'B' }])), /Row 2, id/);
});

function importer() {
  const app = frontend(), store = backend();
  app.context.calls = [];
  app.context.notices = [];
  app.context.allowed = true;
  app.context.transport = body => store.request(plain(body));
  app.run(`
    toast = message => notices.push(message);
    busy = async (label, fn) => fn();
    guardDirty = async () => allowed;
    renderAll = () => {};
    loadAll = async () => { state.posts = (await transport({ action: 'list' })).posts.map(normalizePost); };
    api = async (action, body) => { calls.push({ action, ...body }); return transport({ action, ...body }); };
  `);
  return {
    app, store,
    async import(rows) {
      app.context.file = { name: 'posts.json', text: async () => JSON.stringify(rows) };
      await app.run('importPosts(file)');
    },
  };
}

test('every row validates before the first save', async () => {
  const { app, store, import: runImport } = importer();
  await runImport([{ body: 'Valid' }, { body: '' }]);
  assert.equal(app.context.calls.length, 0);
  assert.equal(store.posts().length, 0);
  assert.match(app.context.notices[0], /Row 2, body/);
});

test('cancelling unsaved-change guard imports nothing', async () => {
  const flow = importer(); flow.app.context.allowed = false;
  await flow.import([{ body: 'Hello' }]);
  assert.equal(flow.app.context.calls.length, 0);
  assert.equal(flow.store.posts().length, 0);
});

test('ambiguous partial import resumes with stable IDs instead of duplicating saved rows', async () => {
  const flow = importer(), original = flow.app.context.transport;
  let saves = 0;
  flow.app.context.transport = body => {
    const result = original(body);
    if (body.action === 'save' && ++saves === 2) throw new Error('Response lost after the server saved this row.');
    return result;
  };
  const rows = [{ body: 'First' }, { body: 'Second' }, { body: 'Third' }];
  await flow.import(rows);
  assert.equal(flow.store.posts().length, 2);
  assert.match(flow.app.context.notices.at(-1), /Imported 1 of 3.*Row 2 was not confirmed/);
  const firstIds = flow.store.posts().map(p => p.id);
  await flow.import(rows);
  assert.equal(flow.store.posts().length, 3);
  assert.deepEqual(flow.store.posts().slice(0, 2).map(p => p.id), firstIds);
  assert.equal(flow.app.context.calls.filter(c => c.action === 'save' && c.post.body === 'First').length, 1);
  assert.match(flow.app.context.notices.at(-1), /Imported 3 posts/);
  const before = flow.app.context.calls.length;
  await flow.import(rows);
  assert.equal(flow.app.context.calls.length, before);
  assert.match(flow.app.context.notices.at(-1), /already been imported/);
});

test('JSON/CSV exports both re-import through the actual Apps Script save_ implementation', async () => {
  const app = frontend();
  app.context.input = fixtures();
  app.context.downloads = [];
  app.run(`state.posts = input.map(normalizePost); download = (name, text) => downloads.push({ name, text }); setExportOpen = () => {}; exportPosts('json'); exportPosts('csv');`);
  const { parse } = parser();
  for (const file of app.context.downloads) {
    const store = backend();
    const posts = parse(file.text, file.name);
    posts.forEach((post, i) => {
      const saved = store.request({ action: 'save', post: { ...post, id: 'roundtrip-' + i } });
      assert.equal(saved.error, undefined);
    });
    assert.equal(store.posts().length, fixtures().length);
    const published = store.posts().find(p => p.status === 'published');
    assert.equal(published.publishedAt, '2026-10-18 09:05');
    assert.equal(published.linkedinUrn, 'urn:li:share:67890');
    assert.equal(published.media[0].type, 'document');
    assert.equal(store.posts()[0].body, fixtures()[0].body);
  }
});

test('working-copy attachment edits do not mutate a saved post', () => {
  const app = frontend();
  app.run(`state.posts = [normalizePost({ id: 'a', body: 'Hello', media: [{ driveId: '01234567890123456789', type: 'image', altText: 'Original' }] })]; state.ed = workingCopy(state.posts[0]); state.ed.media[0].altText = 'Changed';`);
  assert.equal(app.run('state.posts[0].media[0].altText'), 'Original');
});
