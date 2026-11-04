import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scoreLineup, answerRows, validate, NAME_PTS, POS_PTS, ORDER_PTS } from '../app/js/scoring.js';

const puzzles = JSON.parse(readFileSync(new URL('../app/data/puzzles.json', import.meta.url)));
const byId = (id) => puzzles.find((p) => p.id === id);
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} != ${b}`);

// A small synthetic AL puzzle so the arithmetic is easy to follow.
const POS = ['CF', 'SS', 'DH', '3B', 'C', 'RF', '1B', 'LF', '2B'];
function synth() {
  return {
    id: 'TEST', league: 'AL', year: 2007, pitcherSlot: null, pitchers: [],
    lineup: POS.map((p, i) => [`t${i}`, p]),
    roster: {
      ...Object.fromEntries(POS.map((p, i) => [`t${i}`, [140, p, i === 0 ? ['CF', 'LF'] : [p]]])),
      bench35: [35, '2B', ['2B', 'SS']],
      bench34: [34, 'C', ['C']],
    },
    nearby: { near: ['RF', [2004]] },
  };
}
const key = (z) => answerRows(z);

test('perfect lineup is 100; anything less is capped at 99', () => {
  const z = synth();
  assert.equal(scoreLineup(z, key(z)).total, 100);
  const rows = key(z);
  rows[0] = { pid: 't0', pos: 'LF' };            // documented secondary position: -1.11 points
  const r = scoreLineup(z, rows);
  close(r.raw, 100 - POS_PTS / 2, 'raw');
  assert.equal(r.total, 99);
  assert.equal(r.perfect, false);
  assert.equal(r.rows[0].locked, false);
  assert.equal(r.rows[0].posMark, 'yellow');
});

test('weights: 60 names, 20 positions, 20 order', () => {
  close(NAME_PTS * 9, 60, 'names'); close(POS_PTS * 9, 20, 'pos'); close(ORDER_PTS * 9, 20, 'order');
  const r = scoreLineup(synth(), key(synth()));
  close(r.name, 60, 'name'); close(r.pos, 20, 'pos'); close(r.order, 20, 'order');
});

test('target player out of order: full name credit, arrow, distance-based order credit', () => {
  const z = synth();
  const rows = key(z);
  // move t0 (bats 1st) to row 2, t1 to row 1: one slot away each
  [rows[0], rows[1]] = [rows[1], rows[0]];
  let r = scoreLineup(z, rows);
  assert.equal(r.rows[0].player, 'yellow'); assert.equal(r.rows[0].arrow, 'down');
  assert.equal(r.rows[1].player, 'yellow'); assert.equal(r.rows[1].arrow, 'up');
  assert.equal(r.rows[0].posMark, 'green', 'position green even in the wrong slot');
  assert.equal(r.rows[0].credit.name, 1);
  assert.equal(r.rows[0].credit.order, 0.75);
  assert.equal(r.rows[0].order, 'yellow');
  // two away
  const rows2 = key(z);
  [rows2[0], rows2[2]] = [rows2[2], rows2[0]];
  r = scoreLineup(z, rows2);
  assert.equal(r.rows[0].credit.order, 0.5);
  // three away: no order credit
  const rows3 = key(z);
  [rows3[0], rows3[3]] = [rows3[3], rows3[0]];
  r = scoreLineup(z, rows3);
  assert.equal(r.rows[0].credit.order, 0); assert.equal(r.rows[0].order, 'gray');
  assert.equal(r.rows[0].credit.name, 1);
});

test('wrong position for a target player gets no position credit and does not lock', () => {
  const z = synth();
  const rows = key(z);
  rows[3] = { pid: 't3', pos: 'SS' };
  rows[1] = { pid: 't1', pos: '3B' };
  const r = scoreLineup(z, rows);
  assert.equal(r.rows[3].player, 'green');
  assert.equal(r.rows[3].posMark, 'gray');
  assert.equal(r.rows[3].locked, false);
});

test('same-season roster players: 85% with 35+ starts, else 50%; role-based position credit; no order credit', () => {
  const z = synth();
  const rows = key(z);
  rows[8] = { pid: 'bench35', pos: '2B' };
  rows[4] = { pid: 'bench34', pos: 'C' };
  const r = scoreLineup(z, rows);
  assert.equal(r.rows[8].player, 'orange'); assert.equal(r.rows[8].credit.name, 0.85);
  assert.equal(r.rows[4].player, 'orange'); assert.equal(r.rows[4].credit.name, 0.5);
  assert.equal(r.rows[8].credit.pos, 0.5); assert.equal(r.rows[8].posNote, 'role');
  assert.equal(r.rows[8].order, 'na'); assert.equal(r.rows[8].credit.order, 0);
});

test('nearby-season players: 75% name credit, partial position credit for their role, no batting order', () => {
  const z = synth();
  const rows = key(z);
  rows[5] = { pid: 'near', pos: 'RF' };
  let r = scoreLineup(z, rows);
  assert.equal(r.rows[5].player, 'blue');
  assert.equal(r.rows[5].credit.name, 0.75);
  assert.equal(r.rows[5].credit.pos, 0.5);
  assert.equal(r.rows[5].order, 'na');
  assert.equal(r.rows[5].credit.order, 0);
  rows[5] = { pid: 'near', pos: 'RF' === 'RF' ? '1B' : 'RF' };
  rows[6] = { pid: 't6', pos: 'LF' }; // keep positions unique isn't required by scoring
  r = scoreLineup(z, rows);
  assert.equal(r.rows[5].credit.pos, 0);
});

test('unknown player is gray with zero credit', () => {
  const z = synth();
  const rows = key(z);
  rows[2] = { pid: 'nobody01', pos: 'DH' };
  const r = scoreLineup(z, rows);
  assert.equal(r.rows[2].player, 'gray');
  assert.equal(r.rows[2].points, 0);
});

test('three-season window is inclusive (real data)', () => {
  // Robin Ventura: Yankee in 2003 only. 2006 - 3 = 2003 -> nearby. 2007 - 4 -> not.
  const ny06 = byId('2006-NYA'), ny07 = byId('2007-NYA');
  assert.deepEqual(ny06.nearby.venturo01, ['3B', [2003]]);
  assert.equal(ny07.nearby.venturo01, undefined);
  // Ichiro: Yankee from 2012. 2009 + 3 = 2012 -> nearby. 2008 + 4 -> not.
  const ny09 = byId('2009-NYA'), ny08 = byId('2008-NYA');
  assert.deepEqual(ny09.nearby.suzukic01, ['RF', [2012]]);
  assert.equal(ny08.nearby.suzukic01, undefined);

  const rows = answerRows(ny06);
  rows[8] = { pid: 'venturo01', pos: rows[8].pos };
  assert.equal(scoreLineup(ny06, rows).rows[8].player, 'blue');
  const rows7 = answerRows(ny07);
  rows7[8] = { pid: 'venturo01', pos: rows7[8].pos };
  assert.equal(scoreLineup(ny07, rows7).rows[8].player, 'gray');
});

test('nearby lists never include the target year or anything beyond +/-3', () => {
  let lo = 0, hi = 0;
  for (const z of puzzles) {
    for (const [pid, [, years]] of Object.entries(z.nearby)) {
      assert.ok(!z.roster[pid], `${z.id}: ${pid} is on the target roster and nearby`);
      for (const y of years) {
        assert.ok(y !== z.year && Math.abs(y - z.year) <= 3, `${z.id}: ${pid} year ${y}`);
        if (y === z.year - 3) lo++;
        if (y === z.year + 3) hi++;
      }
    }
  }
  assert.ok(lo > 0 && hi > 0, 'both window edges are represented');
});

test('NL: only one row can claim the pitcher slot', () => {
  const z = byId('2009-PHI');
  const rows = answerRows(z);
  const other = z.pitchers.map(([p]) => p).find((p) => p !== rows[z.pitcherSlot].pid);
  rows[0] = { pid: other, pos: 'SS' };   // second accepted starter in the leadoff spot
  const r = scoreLineup(z, rows);
  assert.equal(r.rows[z.pitcherSlot].player, 'green');
  assert.equal(r.rows[0].player, 'orange');
});

test('validation rejects duplicates, missing fields and league-invalid positions', () => {
  const z = synth();
  const rows = key(z);
  assert.ok(validate(z, rows).ok);
  const dup = key(z); dup[1] = { ...dup[0] };
  assert.ok(!validate(z, dup).ok);
  const noPos = key(z); noPos[4] = { pid: 't4', pos: '' };
  assert.ok(!validate(z, noPos).ok);
  const noPlayer = key(z); noPlayer[4] = { pid: null, text: 'Jorge', pos: 'C' };
  assert.ok(!validate(z, noPlayer).ok);
  const pInAL = key(z); pInAL[2] = { pid: 't2', pos: 'P' };
  assert.ok(!validate(z, pInAL).ok);
  const dupPos = key(z); dupPos[2] = { pid: 't2', pos: 'CF' };
  assert.ok(!validate(z, dupPos).ok);
});
