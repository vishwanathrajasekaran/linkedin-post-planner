'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { root, source, backend, fixtures } = require('./helpers.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
let browser, server, origin;
const assets = new Set(['index.html', 'app.js', 'lib.js', 'styles.css', 'insights.js', 'insights.css']);

before(async () => {
  server = http.createServer((req, res) => {
    const name = req.url === '/' ? 'index.html' : req.url.slice(1);
    if (!assets.has(name)) { res.writeHead(404); res.end(); return; }
    // Optional baseline proves layout assertions also detect the original bugs.
    const body = process.env.TEST_BASELINE && ['styles.css', 'app.js'].includes(name)
      ? execFileSync('git', ['show', 'HEAD:' + name], { cwd: root }) : source(name);
    res.setHeader('Content-Type', name.endsWith('.css') ? 'text/css' : name.endsWith('.js') ? 'text/javascript' : 'text/html');
    res.end(body);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
});
after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});

async function setup(t, width = 1440, posts = fixtures()) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width <= 520, hasTouch: width <= 520, reducedMotion: 'reduce', timezoneId: 'Asia/Kolkata' });
  const page = await context.newPage(), store = backend(posts), calls = [], errors = [];
  page.setDefaultTimeout(7000);
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin !== origin) return route.abort();
    return route.continue();
  });
  await page.route('**/api/proxy', async route => {
    const body = route.request().postDataJSON(); calls.push(body);
    await route.fulfill({ json: store.request(body) });
  });
  await page.goto(origin);
  await page.locator('#app:not(.hidden)').waitFor();
  t.after(async () => { await context.close(); assert.deepEqual(errors, [], 'no uncaught browser errors'); });
  return { page, store, calls };
}

async function series(page) {
  await page.locator('details[data-series]').evaluateAll(nodes => nodes.forEach(node => { node.open = true; }));
}
async function selectPost(page, id) { await series(page); await page.locator(`.bulk-check[data-id="${id}"]`).check(); }
const submit = page => page.locator('.bulk-action-form button[type=submit]').click();
const notice = (page, text) => page.waitForFunction(text => document.querySelector('#toasts').textContent.includes(text), text);

async function layoutFits(page, selector) {
  const result = await page.locator(selector).evaluateAll(nodes => nodes.filter(n => n.getClientRects().length).map(n => ({
    selector: n.className || n.id, client: n.clientWidth, scroll: n.scrollWidth,
  })).filter(n => n.scroll > n.client + 1));
  assert.deepEqual(result, [], 'visible layout elements must not overflow horizontally');
  const pageSize = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(pageSize.scroll <= pageSize.width + 1, JSON.stringify(pageSize));
}

async function screenshot(page, name) {
  if (!process.env.TEST_SCREENSHOTS_DIR) return;
  fs.mkdirSync(process.env.TEST_SCREENSHOTS_DIR, { recursive: true });
  await page.screenshot({ path: path.join(process.env.TEST_SCREENSHOTS_DIR, name + '.png'), fullPage: true });
}

for (const width of [320, 375, 390, 768, 900, 1024, 1280, 1440, 1920]) {
  test(`Planner and Calendar layout at ${width}px`, async t => {
    const { page } = await setup(t, width);
    await series(page);
    await layoutFits(page, '.bar, .planner, .side, .side > *, .row, .row-main, .series-group summary, .series-posts, #editor, #previewCard');
    if (width <= 900) {
      const editor = await page.locator('#editor').boundingBox(), sidebar = await page.locator('.side').boundingBox();
      assert.ok(editor.y < sidebar.y, 'mobile editor/empty state is before the post list');
    }
    await page.locator('.row-main[data-id=p1]').first().click();
    await page.locator('#f-body').waitFor();
    await layoutFits(page, '.planner, .side, .work, #editor, #previewCard, .toolbar, .assistant, .assistant-controls');
    await page.locator('[data-act=add-media][data-type=image]').click();
    await layoutFits(page, '.media-row, #editor, .work');
    await page.locator('[data-v=calendar]').click();
    await page.locator('.cell[data-day="2026-10-23"] > .n').click();
    await layoutFits(page, '.cal-wrap, .cal-side, .day-list, .day-list .row-main');
    const day = await page.locator('.day-list .day').first().evaluate(n => ({ height: n.clientHeight, line: parseFloat(getComputedStyle(n).lineHeight) }));
    assert.ok(day.height <= day.line + 1, 'Day 30 stays on one line');
    const titleStyle = await page.locator('.day-list .t').last().evaluate(n => getComputedStyle(n).whiteSpace);
    assert.equal(titleStyle, 'normal', 'calendar titles can wrap');
    if ([390, 1440].includes(width)) await screenshot(page, 'calendar-' + width);
  });
}

test('Calendar right pane keeps each day label on one line and time chips aligned', async t => {
  const { page } = await setup(t);
  await page.locator('[data-v=calendar]').click();
  await page.locator('.cell[data-day="2026-10-23"] > .n').click();
  const rows = await page.locator('.day-list .row-main').evaluateAll(nodes => nodes.map(row => {
    const day = row.querySelector('.day'), title = row.querySelector('.t'), chip = row.querySelector('.chip');
    return { dayHeight: day.clientHeight, lineHeight: parseFloat(getComputedStyle(day).lineHeight), titleWhiteSpace: getComputedStyle(title).whiteSpace, chipRight: chip.getBoundingClientRect().right };
  }));
  assert.equal(rows.length, 4);
  assert.ok(rows.every(r => r.dayHeight <= r.lineHeight + 1), 'day and day number do not split');
  assert.ok(rows.every(r => r.titleWhiteSpace === 'normal'), 'full title is readable');
  assert.ok(Math.max(...rows.map(r => r.chipRight)) - Math.min(...rows.map(r => r.chipRight)) <= 1, 'times share a right edge');
});

test('bulk dropdown changes are inert; Draft/Ready/Scheduled run only on Submit', async t => {
  const { page, store, calls } = await setup(t);
  const button = page.locator('.bulk-action-form button[type=submit]');
  assert.equal(await button.isDisabled(), true);
  assert.deepEqual(await page.locator('#bulkAction option').allTextContents(), ['Choose an action', 'Draft', 'Ready', 'Scheduled', 'Publish', 'Delete']);
  await selectPost(page, 'p1');
  assert.equal(await button.isEnabled(), true);
  assert.equal(await page.locator('#selectAll').evaluate(n => n.indeterminate), true);
  await page.locator('#bulkAction').selectOption('scheduled');
  assert.equal(await page.locator('#bulkScheduledAt').isVisible(), true);
  assert.equal(await page.locator('#bulkScheduledAt').evaluate(n => n.required), true);
  await submit(page);
  assert.equal(calls.filter(c => c.action === 'bulk').length, 0, 'missing schedule prevents submission');
  await page.locator('#bulkScheduledAt').fill('2026-10-25T13:45');
  await page.locator('#bulkAction').selectOption('ready');
  assert.equal(await page.locator('#bulkScheduledAt').isVisible(), false);
  assert.equal(await page.locator('#bulkScheduledAt').isDisabled(), true);
  assert.equal(calls.filter(c => c.action === 'bulk').length, 0, 'selecting actions makes no mutations');
  await submit(page); await notice(page, '1 post updated.');
  assert.equal(store.posts().find(p => p.id === 'p1').status, 'ready');
  assert.equal(store.posts().find(p => p.id === 'p1').scheduledAt, '');
  assert.equal(await button.isDisabled(), true);
  await selectPost(page, 'p1');
  await page.locator('#bulkAction').selectOption('draft');
  await submit(page);
  await page.waitForFunction(() => document.querySelector('#selCount').textContent === '0 selected');
  assert.equal(store.posts().find(p => p.id === 'p1').status, 'draft');
  await selectPost(page, 'p1');
  await page.locator('#bulkAction').selectOption('scheduled');
  assert.equal(await page.locator('#bulkScheduledAt').inputValue(), '2026-10-25T13:45');
  await submit(page);
  await page.waitForFunction(() => document.querySelector('#selCount').textContent === '0 selected');
  const post = store.posts().find(p => p.id === 'p1');
  assert.equal(post.status, 'scheduled'); assert.equal(post.scheduledAt, '2026-10-25 13:45');
  assert.equal(calls.filter(c => c.action === 'bulk').length, 3);
});

test('Publish and Delete require confirmation; final deletion clears controls/editor', async t => {
  const { page, store, calls } = await setup(t);
  await selectPost(page, 'p1');
  await page.locator('#bulkAction').selectOption('publish'); await submit(page);
  await page.locator('#modal [data-r="0"]').click();
  assert.equal(calls.filter(c => c.action === 'bulk').length, 0);
  await submit(page); await page.locator('#modal [data-r="1"]').click();
  await notice(page, 'Published 1 post.');
  assert.equal(store.posts().find(p => p.id === 'p1').status, 'published');
  await page.locator('.row-main[data-id=p1]').first().click();
  await page.locator('#f-body:disabled').waitFor();
  await page.locator('#selectAll').check();
  await page.locator('#bulkAction').selectOption('delete'); await submit(page);
  await page.locator('#modal [data-r="0"]').click();
  assert.equal(store.posts().length, fixtures().length);
  await submit(page); await page.locator('#modal [data-r="1"]').click();
  await notice(page, `${fixtures().length} posts deleted.`);
  assert.equal(store.posts().length, 0);
  assert.equal(await page.locator('#selCount').textContent(), '0 selected');
  assert.equal(await page.locator('#selectAll').isChecked(), false);
  assert.equal(await page.locator('#selectAll').isDisabled(), true);
  assert.equal(await page.locator('.bulk-action-form button[type=submit]').isDisabled(), true);
  assert.match(await page.locator('#editor').textContent(), /Pick a post to edit/);
});

test('Export reveals JSON/CSV, downloads valid files and restores keyboard focus', async t => {
  const { page } = await setup(t);
  assert.equal(await page.locator('[data-act=import]').count(), 1);
  assert.equal(await page.locator('#importFile').count(), 1);
  assert.equal(await page.locator('#exportOptions').isVisible(), false);
  await page.locator('#exportToggle').focus(); await page.keyboard.press('Enter');
  assert.equal(await page.locator('#exportToggle').getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#exportOptions').isVisible(), false);
  assert.equal(await page.locator('#exportToggle').evaluate(n => n === document.activeElement), true);
  for (const format of ['json', 'csv']) {
    await page.locator('#exportToggle').click();
    const promise = page.waitForEvent('download');
    await page.locator(`[data-act=export-${format}]`).click();
    const download = await promise;
    assert.equal(download.suggestedFilename(), `post-planner.${format}`);
    const text = fs.readFileSync(await download.path(), 'utf8');
    const parsed = await page.evaluate(({ text, format }) => parseImport(text, `download.${format}`), { text, format });
    assert.equal(parsed.length, fixtures().length);
    assert.equal(parsed[0].body, fixtures()[0].body);
    assert.equal(parsed.find(p => p.status === 'published').publishedAt, '2026-10-18 09:05');
    assert.equal(await page.locator('#exportOptions').isVisible(), false);
    assert.equal(await page.locator('#exportToggle').evaluate(n => n === document.activeElement), true);
  }
  await page.locator('#exportToggle').click(); await page.locator('#today h2').click();
  assert.equal(await page.locator('#exportOptions').isVisible(), false);
});

test('Import opens a file picker, rejects invalid rows without saves, and saves JSON/CSV', async t => {
  const { page, store, calls } = await setup(t, 1440, []);
  const chooser = page.waitForEvent('filechooser');
  await page.locator('[data-act=import]').click();
  await (await chooser).setFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('[{"body":"Valid"},{"body":""}]') });
  await notice(page, 'Row 2, body');
  assert.equal(calls.filter(c => c.action === 'save').length, 0);
  assert.equal(store.posts().length, 0);
  const json = [{ title: 'Imported JSON', body: 'Hello 🚀', media: [{ driveId: '01234567890123456789', type: 'image', altText: 'First image' }] }];
  await page.locator('#importFile').setInputFiles({ name: 'posts.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(json)) });
  await notice(page, 'Imported 1 post.');
  assert.equal(store.posts().length, 1);
  assert.equal(store.posts()[0].media[0].altText, 'First image');
  await series(page);
  await page.locator('.series-posts .row-main').first().click();
  assert.equal(await page.locator('#f-body').inputValue(), 'Hello 🚀');
  await page.locator('#importFile').setInputFiles({ name: 'posts.csv', mimeType: 'text/csv', buffer: Buffer.from('title,body\nCSV,"Comma, quote ""example""\nand newline"\n') });
  await page.waitForFunction(() => document.querySelectorAll('.series-posts .row-main').length === 2);
  assert.equal(store.posts().length, 2);
  assert.equal(store.posts()[1].body, 'Comma, quote "example"\nand newline');
  await series(page);
  await page.locator(`.series-posts .row-main[data-id="${store.posts()[1].id}"]`).click();
  assert.equal(await page.locator('#f-body').inputValue(), store.posts()[1].body);
  await page.reload(); await page.locator('#app:not(.hidden)').waitFor();
  assert.equal(await page.locator('.series-posts .row-main').count(), 2, 'saved imports survive reload');
});

test('mobile New/Edit/Calendar clicks reveal editor and focus post body; published stays read-only', async t => {
  const { page } = await setup(t, 390);
  await page.locator('#editor [data-act=new-post]').click();
  assert.equal(await page.locator('#f-body').evaluate(n => n === document.activeElement), true);
  assert.ok((await page.locator('#editor').boundingBox()).y >= 0);
  await page.locator('#f-body').fill('Unsaved mobile text');
  await series(page);
  await page.locator('.row-main[data-id=p1]').first().click();
  await page.locator('#modal [data-r="0"]').click();
  assert.equal(await page.locator('#f-body').inputValue(), 'Unsaved mobile text', 'cancel keeps current editor');
  await page.locator('.row-main[data-id=p1]').first().click();
  await page.locator('#modal [data-r="1"]').click();
  assert.equal(await page.locator('#f-body').inputValue(), fixtures()[0].body);
  assert.equal(await page.locator('#f-body').evaluate(n => n === document.activeElement), true);
  let rect = await page.locator('#editor').boundingBox();
  assert.ok(rect.y >= 0 && rect.y <= 20, `editor scrolled into view: ${rect.y}`);
  await screenshot(page, 'planner-edit-mobile');
  await page.locator('[data-v=calendar]').click();
  await page.locator('.cell[data-day="2026-10-23"] > .n').click();
  await page.locator('.day-list .row-main[data-id=p2]').click();
  assert.equal(await page.locator('#f-body').evaluate(n => n === document.activeElement), true);
  await page.locator('[data-v=calendar]').click();
  await page.locator('.cell[data-day="2026-10-23"] > .n').click();
  await page.locator('[data-act=cal-new]').click();
  assert.equal(await page.locator('#f-body').inputValue(), '');
  assert.equal(await page.locator('#f-body').evaluate(n => n === document.activeElement), true);
  assert.match(await page.locator('.picker-btn').textContent(), /23 Oct 2026/);
  await series(page);
  await page.locator('.series-posts .row-main[data-id=p6]').click();
  assert.equal(await page.locator('#f-body').isDisabled(), true);
  assert.equal(await page.locator('#editor .ed-head h2').evaluate(n => n === document.activeElement), true);
  rect = await page.locator('#editor').boundingBox();
  assert.ok(rect.y >= 0 && rect.y <= 20);
});

test('Planner dark theme and mobile preview remain within the card', async t => {
  const { page } = await setup(t, 1440);
  await series(page);
  await page.locator('.row-main[data-id=p1]').first().click();
  await page.locator('[data-act=device][data-d=mobile]').click();
  assert.equal(await page.locator('#li').evaluate(n => n.classList.contains('mobile')), true);
  await page.locator('#themeBtn').click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  await layoutFits(page, '.planner, .side, .work, #editor, #previewCard, .li-card');
  await screenshot(page, 'planner-desktop-dark');
  await page.locator('[data-v=calendar]').click();
  await page.locator('.cell[data-day="2026-10-23"] > .n').click();
  await layoutFits(page, '.cal-wrap, .cal-side, .day-list, .day-list .row-main');
});
