#!/usr/bin/env node
// Browser end-to-end check (Playwright + Chromium, phone viewport).
// Verifies: entry via autocomplete, invalid submit keeps attempts, locking, swapping across
// locked rows, refresh preserves the game, Paste Lineup, reveal + share text, daily mode.
// Usage: node tests/e2e.mjs   (needs `playwright` installed: npm i -D playwright && npx playwright install chromium)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { start } from '../scripts/serve.mjs';

const require = createRequire(import.meta.url);
let chromium, devices;
try { ({ chromium, devices } = require('playwright')); } catch {
  console.log('SKIP: playwright is not installed (npm i -D playwright && npx playwright install chromium)');
  process.exit(0);
}

const puzzles = JSON.parse(readFileSync(new URL('../app/data/puzzles.json', import.meta.url)));
const players = JSON.parse(readFileSync(new URL('../app/data/players.json', import.meta.url)));
const name = Object.fromEntries(players.rows.map((r) => [r[0], `${r[1]} ${r[2]}`]));
const z = puzzles.find((p) => p.id === '2009-PHI');
const key = z.lineup.map(([pid, pos]) => ({ name: name[pid], pos }));

const server = await start(0);
const base = `http://localhost:${server.address().port}/`;
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const shots = process.env.SHOTS;

const row = (i) => page.locator(`#board .row[data-i="${i}"]`);
async function enter(i, text, pos) {
  const input = row(i).locator('.pname');
  await input.fill(text);
  await page.locator('#suggest li[data-k="0"]').waitFor();
  await input.press('Enter');
  if (pos) await row(i).locator('.pos').selectOption(pos);
}
const ok = (msg) => console.log(`ok - ${msg}`);

try {
  await page.goto(`${base}#practice-${z.id}`);
  await page.waitForSelector('#board .row');
  assert.equal(await page.locator('#dlg-help[open]').count(), 0, 'rules stay behind the How to play button');
  await page.click('#btn-help');
  await page.waitForSelector('#dlg-help[open]');
  await page.locator('#dlg-help').evaluate((d) => d.close());
  assert.equal(await page.locator('#p-team').textContent(), 'Philadelphia Phillies');

  // Attempt 1: rows 1-7 right, rows 8 and 9 swapped.
  const order = [0, 1, 2, 3, 4, 5, 6, 8, 7];
  for (let i = 0; i < 9; i++) {
    const k = key[order[i]];
    if (i === 8) await enter(i, k.name); else await enter(i, k.name, k.pos);
  }
  await page.click('#btn-submit');
  assert.match(await page.locator('#msg').textContent(), /no attempt used/);
  assert.equal(await page.locator('.pip.used').count(), 0);
  assert.equal(await row(8).evaluate((n) => n.classList.contains('invalid')), true);
  ok('invalid submission (missing position) does not use an attempt');

  await row(8).locator('.pos').selectOption(key[7].pos);
  await page.click('#btn-submit');
  await page.waitForSelector('.pip.used');
  assert.equal(await page.locator('#board .row.locked').count(), 7);
  assert.equal(await row(0).locator('.pname').isDisabled(), true);
  assert.equal(await row(0).locator('.pos').isDisabled(), true);
  assert.equal(await row(7).locator('.mark-player').textContent(), '↓');
  assert.equal(await row(8).locator('.mark-player').textContent(), '↑');
  assert.equal(await row(8).locator('.mark-pos').textContent(), '✓');
  ok('scored attempt locks 7 rows, shows arrows and separate position marks');
  if (shots) await page.screenshot({ path: `${shots}/e2e-after-attempt.png`, fullPage: true });

  // Locked rows reject edits even when forced through the DOM.
  await row(0).locator('.pname').evaluate((n) => { n.disabled = false; n.value = 'Derek Jeter'; n.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.reload();
  await page.waitForSelector('#board .row.locked');
  assert.equal(await row(0).locator('.pname').inputValue(), key[0].name);
  ok('locked row cannot be overwritten');

  // Refresh preserves the game: attempts, locks, the unlocked draft.
  assert.equal(await page.locator('.pip.used').count(), 1);
  assert.equal(await page.locator('#board .row.locked').count(), 7);
  assert.equal(await row(7).locator('.pname').inputValue(), key[8].name);
  assert.equal(await page.locator('#history .attempt').count(), 1);
  ok('refresh preserves attempts, locks and draft rows');

  // Swap rows 8 and 9 by tapping their numbers, then refresh mid-edit.
  await row(7).locator('.slot').click();
  await row(8).locator('.slot').click();
  assert.equal(await row(7).locator('.pname').inputValue(), key[7].name);
  assert.equal(await row(7).locator('.pos').inputValue(), key[7].pos);
  await page.reload();
  await page.waitForSelector('#board .row.locked');
  assert.equal(await row(7).locator('.pname').inputValue(), key[7].name);
  ok('tap-to-swap moves player and position together; draft survives refresh');

  // Move buttons hop over locked rows: move row 9 up -> lands on row 8 (no locked rows between here);
  // test the hop with row 8 -> up should skip locked rows 1-7 and do nothing.
  await row(7).locator('.mv[data-act="up"]').click();
  assert.equal(await row(7).locator('.pname').inputValue(), key[7].name);
  ok('move up is a no-op when only locked rows are above');

  await page.click('#btn-submit');
  await page.waitForSelector('#result:not([hidden])');
  assert.match(await page.locator('.result-best .big').textContent(), /^100$/);
  const share = await page.locator('.share-preview').textContent();
  assert.match(share, /Perfect 2\/3/);
  for (const k of key) assert.ok(!share.includes(k.name.split(' ').pop()), 'share text has no player names');
  assert.match(await page.locator('.freq').textContent(), /Started \d+ of \d+ non-DH games/);
  ok('perfect lineup reveals answer, frequency, example date, spoiler-free share');
  if (shots) await page.screenshot({ path: `${shots}/e2e-reveal.png`, fullPage: true });

  await page.reload();
  await page.waitForSelector('#result:not([hidden])');
  assert.equal(await page.locator('#actions').isHidden(), true);
  ok('finished game stays finished after refresh');

  // Paste lineup on an AL puzzle.
  const al = puzzles.find((p) => p.id === '2006-NYA');
  await page.goto(`${base}#practice-${al.id}`);
  await page.waitForFunction(() => document.querySelector('#p-team').textContent === 'New York Yankees');
  await page.click('#btn-paste');
  const text = al.lineup.map(([pid, pos], i) => `${i + 1}. ${name[pid].normalize('NFD').replace(/[̀-ͯ]/g, '')}, ${pos}`).join('\n');
  await page.fill('#paste-text', text);
  await page.click('#paste-apply');
  for (let i = 0; i < 9; i++) assert.equal(await row(i).locator('.pos').inputValue(), al.lineup[i][1]);
  await page.click('#btn-submit');
  await page.waitForSelector('#result:not([hidden])');
  assert.match(await page.locator('.result-kicker').textContent(), /Perfect lineup in 1 try/);
  ok('Paste Lineup fills nine rows and scores 100');

  // Daily mode loads today's puzzle.
  await page.goto(`${base}#daily`);
  await page.waitForFunction(() => /Daily #\d+/.test(document.querySelector('#p-label').textContent));
  ok(`daily loads: ${await page.locator('#p-label').textContent()} - ${await page.locator('#p-year').textContent()} ${await page.locator('#p-team').textContent()}`);
  if (shots) await page.screenshot({ path: `${shots}/e2e-daily.png` });

  // Stats recorded for practice games.
  await page.click('#btn-stats');
  assert.match(await page.locator('#stats-body').textContent(), /Practice/);
  ok('stats dialog opens');

  assert.deepEqual(errors, []);
  ok('no page errors');
  console.log('\nAll end-to-end checks passed.');
} finally {
  await browser.close();
  server.close();
}
