import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PlayerIndex, normalize, careerLabel } from '../app/js/search.js';
import { parseLine } from '../app/js/paste.js';
import { easternDateKey, dailyNumber, dailyPuzzleId, addDays } from '../app/js/daily.js';
import { emptyStats, recordResult, currentStreak } from '../app/js/storage.js';

const idx = new PlayerIndex(JSON.parse(readFileSync(new URL('../app/data/players.json', import.meta.url))));
const puzzles = JSON.parse(readFileSync(new URL('../app/data/puzzles.json', import.meta.url)));

test('search ignores accents and punctuation', () => {
  assert.equal(normalize('Carlos Peña'), normalize('carlos pena'));
  assert.equal(normalize('B. J. Upton'), normalize('BJ Upton'));
  assert.equal(normalize('A.J. Pierzynski'), 'aj pierzynski');
  assert.equal(idx.search('carlos pena', { year: 2008 })[0].id, 'penaca01');
  assert.equal(idx.search('Carlos Peña')[0].name, 'Carlos Peña');
  assert.equal(idx.search('bj upton')[0].id, 'uptonbj01');
  assert.equal(idx.search('B.J. Upton')[0].id, 'uptonbj01');
  assert.equal(idx.search("mike oconnor", { year: 2006 })[0].last, "O'Connor");
  assert.equal(idx.search('jd drew')[0].id, 'drewjd01');
});

test('search covers all MLB players, not just one team, and distinguishes same names', () => {
  assert.ok(idx.list.length > 20000);
  const cy = idx.search('chris young', { limit: 10, year: 2007 }).filter((p) => p.name === 'Chris Young');
  assert.ok(cy.length >= 2);
  assert.equal(new Set(cy.map(careerLabel)).size, cy.length, 'career labels differ');
  assert.ok(idx.search('babe ruth')[0].from === 1914);
});

test('paste parser handles common formats', () => {
  assert.deepEqual(parseLine('Derek Jeter SS'), { name: 'Derek Jeter', pos: 'SS' });
  assert.deepEqual(parseLine('2. Jeter, SS'), { name: 'Jeter', pos: 'SS' });
  assert.deepEqual(parseLine('SS - Derek Jeter'), { name: 'Derek Jeter', pos: 'SS' });
  assert.deepEqual(parseLine('9) A.J. Pierzynski (C)'), { name: 'A.J. Pierzynski', pos: 'C' });
  assert.deepEqual(parseLine('DH: David Ortiz'), { name: 'David Ortiz', pos: 'DH' });
  assert.deepEqual(parseLine('C.J. Wilson P'), { name: 'C.J. Wilson', pos: 'P' });
});

test('daily puzzle rolls over at midnight Eastern', () => {
  // EST (UTC-5) in November
  assert.equal(easternDateKey(new Date('2026-11-05T04:59:59Z')), '2026-11-04');
  assert.equal(easternDateKey(new Date('2026-11-05T05:00:00Z')), '2026-11-05');
  // EDT (UTC-4) in July
  assert.equal(easternDateKey(new Date('2026-07-01T03:59:59Z')), '2026-06-30');
  assert.equal(easternDateKey(new Date('2026-07-01T04:00:00Z')), '2026-07-01');
});

test('daily schedule is deterministic and covers all 150 team-seasons per cycle', () => {
  const ids = puzzles.map((p) => p.id);
  assert.equal(dailyNumber('2026-01-01'), 1);
  const seen = new Set();
  for (let d = 0; d < 150; d++) seen.add(dailyPuzzleId(addDays('2026-01-01', d), ids));
  assert.equal(seen.size, 150);
  assert.equal(dailyPuzzleId('2026-11-04', ids), dailyPuzzleId('2026-11-04', [...ids].reverse()));
});

test('daily streaks', () => {
  let s = emptyStats();
  s = recordResult(s, { mode: 'daily', day: '2026-11-01', best: 80, perfect: false });
  s = recordResult(s, { mode: 'daily', day: '2026-11-02', best: 100, perfect: true });
  assert.equal(s.daily.streak, 2);
  assert.equal(currentStreak(s, '2026-11-03'), 2);
  assert.equal(currentStreak(s, '2026-11-04'), 0);
  s = recordResult(s, { mode: 'daily', day: '2026-11-04', best: 60, perfect: false });
  assert.equal(s.daily.streak, 1);
  assert.equal(s.daily.maxStreak, 2);
  assert.equal(s.daily.perfect, 1);
});
