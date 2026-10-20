'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID, webcrypto } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const source = name => fs.readFileSync(path.join(root, name), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

// Load the actual frontend functions without booting a browser. DOM behavior is
// covered separately by browser.test.cjs; these tests need no dependencies.
function frontend() {
  const nodes = new Map();
  const context = vm.createContext({
    console, crypto: webcrypto, Uint8Array, Blob, URL,
    document: {
      addEventListener() {},
      querySelector(selector) { return nodes.get(selector) || { addEventListener() {} }; },
      querySelectorAll() { return []; },
    },
    window: { addEventListener() {} }, setInterval() {}, setTimeout() {},
  });
  vm.runInContext(source('lib.js'), context);
  vm.runInContext(source('app.js').split('/* ---------- start ---------- */')[0], context);
  return { context, nodes, run: code => vm.runInContext(code, context) };
}

// In-memory Apps Script adapters. save_, readAll_, and bulk_ are the real project
// implementations; no Google or LinkedIn calls can leave this sandbox.
function backend(initial = []) {
  const cols = ['id', 'series', 'day', 'title', 'body', 'imageDriveId', 'media', 'status', 'scheduledAt', 'publishedAt', 'linkedinUrn', 'error'];
  const table = [cols, ...initial.map(p => cols.map(c => c === 'media' ? JSON.stringify(p[c] || []) : (p[c] ?? '')))];
  const sheet = {
    getLastRow: () => table.length,
    getLastColumn: () => cols.length,
    getDataRange: () => ({ getValues: () => table.map(row => [...row]) }),
    getRange(row, col, count = 1, width = 1) {
      return {
        getValues: () => table.slice(row - 1, row - 1 + count).map(r => r.slice(col - 1, col - 1 + width)),
        setValues(values) { values.forEach((r, i) => r.forEach((v, j) => { table[row - 1 + i][col - 1 + j] = v; })); },
      };
    },
    appendRow: row => table.push([...row]),
    deleteRow: row => table.splice(row - 1, 1),
  };
  const lib = require('../lib.js');
  const token = { connected: true, expiresAt: Date.now() + 57 * 864e5, name: 'Test Author' };
  const context = vm.createContext({
    Date, console,
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'test-only' }) },
    SpreadsheetApp: { openById: () => ({ getSheetByName: () => sheet }) },
    Utilities: {
      getUuid: randomUUID,
      parseDate: text => new Date(lib.toEpoch(lib.parseStamp(text))),
      formatDate: date => lib.fmtStamp(lib.fromEpoch(date.getTime())),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  });
  vm.runInContext(source('Files/Code.gs'), context);
  context.testToken = token;
  vm.runInContext(`
    tokenInfo_ = () => testToken;
    statsRoute_ = () => ({ stats: [], sync: {} });
    publish_ = post => save_({ id: post.id, status: 'published', publishedAt: '2026-10-20 12:00', linkedinUrn: 'urn:li:share:12345', error: '' });
  `, context);
  return {
    token,
    request(body) { context.request = plain(body); return plain(vm.runInContext('route_(request.action, request)', context)); },
    posts() { return plain(vm.runInContext('readAll_()', context)); },
  };
}

function fixtures() {
  const base = { series: 'Test Automation — a long series title', body: 'Useful post text with a comma, a "quote" and\na second line. 🚀', media: [], status: 'scheduled', scheduledAt: '2026-10-23 08:00', day: 29 };
  return [
    { ...base, id: 'p1', title: 'API Chaining' },
    { ...base, id: 'p2', day: 30, title: 'UI + API Automation', scheduledAt: '2026-10-23 12:00' },
    { ...base, id: 'p3', day: 30, title: 'Database Validation', scheduledAt: '2026-10-23 17:00' },
    { ...base, id: 'p4', day: 30, title: 'SQL for Test Automation and a much longer title to verify readable wrapping', scheduledAt: '2026-10-23 19:30' },
    { ...base, id: 'p5', day: '', title: 'AReallyLongUnbrokenTitle'.repeat(5), status: 'draft', scheduledAt: '', series: 'AnUnbrokenSeriesName'.repeat(5) },
    { ...base, id: 'p6', title: 'Published example', status: 'published', scheduledAt: '', publishedAt: '2026-10-18 09:05', linkedinUrn: 'urn:li:share:67890', media: [{ driveId: '01234567890123456789', type: 'document', altText: 'Report' }] },
  ];
}

module.exports = { root, source, plain, frontend, backend, fixtures };
