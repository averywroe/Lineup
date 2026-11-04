// Every one of the 150 answer keys must be valid and score exactly 100.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scoreLineup, answerRows, validate, AL_POSITIONS, NL_POSITIONS } from '../app/js/scoring.js';

const puzzles = JSON.parse(readFileSync(new URL('../app/data/puzzles.json', import.meta.url)));
const players = JSON.parse(readFileSync(new URL('../app/data/players.json', import.meta.url)));
const known = new Set(players.rows.map((r) => r[0]));

test('there are 150 team-seasons: 30 teams x 2006-2010', () => {
  assert.equal(puzzles.length, 150);
  assert.equal(new Set(puzzles.map((p) => p.id)).size, 150);
  for (let y = 2006; y <= 2010; y++) assert.equal(puzzles.filter((p) => p.year === y).length, 30, `year ${y}`);
});

test('all 150 answer keys are valid lineups and score 100', () => {
  for (const z of puzzles) {
    const rows = answerRows(z);
    assert.ok(validate(z, rows).ok, `${z.id} answer key fails validation`);
    const r = scoreLineup(z, rows);
    assert.equal(r.total, 100, `${z.id} scored ${r.total}`);
    assert.ok(r.perfect && r.rows.every((f) => f.locked), `${z.id} not fully locked`);
    assert.ok(Math.abs(r.raw - 100) < 1e-9, `${z.id} raw ${r.raw}`);
  }
});

test('AL keys are DH lineups; NL keys have the pitcher in his real slot', () => {
  for (const z of puzzles) {
    const pos = z.lineup.map(([, p]) => p).sort();
    if (z.league === 'AL') {
      assert.deepEqual(pos, [...AL_POSITIONS].sort(), z.id);
      assert.equal(z.pitcherSlot, null, z.id);
    } else {
      assert.deepEqual(pos, [...NL_POSITIONS].sort(), z.id);
      assert.equal(z.lineup[z.pitcherSlot][1], 'P', z.id);
    }
  }
  // La Russa's Cardinals batted the pitcher eighth in 2008-2010.
  for (const y of [2008, 2009, 2010]) assert.equal(puzzles.find((p) => p.id === `${y}-SLN`).pitcherSlot, 7);
});

test('NL: any pitcher with 5+ starts in the pitcher slot also scores 100', () => {
  for (const z of puzzles.filter((p) => p.league === 'NL')) {
    assert.ok(z.pitchers.length >= 5, `${z.id} has only ${z.pitchers.length} accepted pitchers`);
    for (const [pid, starts] of z.pitchers) {
      assert.ok(starts >= 5 || pid === z.lineup[z.pitcherSlot][0], `${z.id} ${pid} has ${starts} starts`);
      const rows = answerRows(z);
      rows[z.pitcherSlot] = { pid, pos: 'P' };
      assert.equal(scoreLineup(z, rows).total, 100, `${z.id} with ${pid}`);
    }
  }
});

test('reference lineup metadata is present and consistent', () => {
  for (const z of puzzles) {
    assert.ok(z.freq >= 1 && z.freq <= z.eligible && z.eligible <= z.games, z.id);
    assert.match(z.example.date, new RegExp(`^${z.year}-\\d\\d-\\d\\d$`), z.id);
    for (const [pid] of z.lineup) {
      assert.ok(known.has(pid), `${z.id}: ${pid} missing from players.json`);
      assert.ok(z.roster[pid], `${z.id}: ${pid} missing from roster`);
    }
  }
});
