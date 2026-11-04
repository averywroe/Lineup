import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as G from '../app/js/game.js';
import { answerRows } from '../app/js/scoring.js';

const puzzles = JSON.parse(readFileSync(new URL('../app/data/puzzles.json', import.meta.url)));
const z = puzzles.find((p) => p.id === '2009-PHI');
const key = answerRows(z);

/** Fill a game with the answer key, but swap rows a and b to keep them unlocked. */
function nearlyRight(a = 7, b = 8) {
  let s = G.newGame(z);
  const rows = key.map((r) => ({ ...r }));
  [rows[a], rows[b]] = [rows[b], rows[a]];
  rows.forEach((r, i) => { s = G.setRow(s, i, { pid: r.pid, text: r.pid, pos: r.pos }); });
  return s;
}

test('fully correct rows lock after a submission', () => {
  const { state, result } = G.submit(nearlyRight(), z);
  assert.equal(state.attempts.length, 1);
  assert.deepEqual(state.locked, [true, true, true, true, true, true, true, false, false]);
  assert.equal(result.total, 99);
  assert.equal(state.status, 'playing');
});

test('locked rows cannot be overwritten, cleared, moved, swapped or pasted over', () => {
  const { state } = G.submit(nearlyRight(), z);
  const snapshot = JSON.stringify(state.rows.slice(0, 7));
  let s = state;
  s = G.setRow(s, 0, { pid: 'jeterde01', text: 'Derek Jeter', pos: 'C' });
  s = G.setRow(s, 3, { pos: 'P' });
  s = G.swapRows(s, 2, 8);
  s = G.swapRows(s, 8, 2);
  s = G.moveRow(s, 4, 1);
  s = G.moveRow(s, 6, -1);
  s = G.clearUnlocked(s);
  s = G.fillRows(s, Array(9).fill({ pid: 'jeterde01', text: 'x', pos: 'SS' }));
  assert.equal(JSON.stringify(s.rows.slice(0, 7)), snapshot);
  assert.ok(s.locked.slice(0, 7).every(Boolean));
});

test('unlocked rows can be swapped across locked rows; player and position move together', () => {
  // leave rows 1 and 7 unlocked (2B-hitter and pitcher swapped)
  const { state } = G.submit(nearlyRight(1, 7), z);
  assert.equal(state.locked[1], false); assert.equal(state.locked[7], false);
  const before = state.rows;
  const s = G.swapRows(state, 1, 7);
  assert.deepEqual(s.rows[1], before[7]);
  assert.deepEqual(s.rows[7], before[1]);
  // moveRow hops over locked rows 2..6
  const m = G.moveRow(state, 1, 1);
  assert.deepEqual(m.rows[7], before[1]);
  assert.equal(G.moveTarget(state, 7, -1), 1);
  const won = G.submit(s, z);
  assert.equal(won.state.status, 'won');
  assert.equal(won.result.total, 100);
});

test('invalid submissions do not use an attempt', () => {
  let s = G.newGame(z);
  let out = G.submit(s, z);
  assert.ok(out.error);
  assert.equal(out.state.attempts.length, 0);
  s = nearlyRight();
  s = G.setRow(s, 8, { pid: s.rows[0].pid });          // duplicate player
  out = G.submit(s, z);
  assert.ok(out.error);
  assert.equal(out.state.attempts.length, 0);
  s = G.setRow(nearlyRight(), 4, { pos: '' });          // missing position
  out = G.submit(s, z);
  assert.ok(out.error);
  assert.equal(out.state, s);
});

test('the game ends after the third attempt and then rejects edits', () => {
  let s = nearlyRight();
  for (let k = 0; k < 3; k++) ({ state: s } = G.submit(s, z));
  assert.equal(s.status, 'over');
  assert.equal(s.attempts.length, 3);
  const again = G.submit(s, z);
  assert.ok(again.error);
  assert.equal(G.setRow(s, 8, { pos: 'C' }), s);
  assert.equal(G.bestAttempt(s).result.total, 99);
});

test('state survives a JSON round trip (what localStorage stores)', () => {
  const { state } = G.submit(nearlyRight(), z);
  const back = JSON.parse(JSON.stringify(state));
  assert.ok(G.isValidState(back, z));
  assert.deepEqual(back, state);
  assert.equal(G.setRow(back, 0, { pos: 'C' }), back, 'restored locks still hold');
});
