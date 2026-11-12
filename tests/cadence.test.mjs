// Checks the Cadence music-theory engine: every generated puzzle is answerable and spelled sensibly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../cadence/index.html', import.meta.url), 'utf8');
const src = html.match(/<script id="theory">([\s\S]*?)<\/script>/)[1];
const mod = { exports: {} };
new Function('module', src)(mod);
const T = mod.exports;

test('interval spelling', () => {
  const n = (l, a, o) => ({ l, a, o });
  assert.deepEqual(T.between(n(1, 0, 4), n(6, -1, 4)), { q: 'm', num: 6, semi: 8 }); // D up to B♭
  assert.deepEqual(T.between(n(3, 0, 4), n(6, 0, 4)), { q: 'A', num: 4, semi: 6 }); // F up to B
  assert.deepEqual(T.between(n(6, 0, 3), n(3, 0, 4)), { q: 'd', num: 5, semi: 6 }); // B up to F
});

test('daily sets are deterministic', () => {
  const a = T.makeSet('cadence-2026-11-12', 2).map(p => p.answer);
  const b = T.makeSet('cadence-2026-11-12', 2).map(p => p.answer);
  assert.deepEqual(a, b);
});

test('every generated puzzle is valid at every level', () => {
  for (let lv = 1; lv <= 3; lv++) {
    for (let s = 0; s < 800; s++) {
      for (const pz of T.makeSet('seed' + s, lv)) {
        assert.ok(pz && pz.kind, `level ${lv} seed ${s} produced a puzzle`);
        if (pz.choices) {
          const ids = pz.choices.map(c => c.id), labels = pz.choices.map(c => c.label);
          assert.equal(ids.length, 4);
          assert.ok(ids.includes(pz.answer), `${pz.kind} answer among choices`);
          assert.equal(new Set(labels).size, 4, `${pz.kind} choices unique: ${labels}`);
        }
        const resp = pz.kind === 'build' ? pz.targetMidis : pz.answer;
        assert.ok(T.grade(pz, resp).correct, `${pz.kind} answer grades as correct`);
        for (const n of pz.staff.cols.flat()) {
          assert.ok(Math.abs(n.a) <= 1, `${pz.kind} uses single accidentals`);
          const p = T.dia(n) - T.CLEF[pz.staff.clef].base;
          assert.ok(p >= -7 && p <= 15, `${pz.kind} note fits within three ledger lines`);
        }
        if (pz.kind === 'interval') assert.equal((b => b.q + b.num)(T.between(pz.lo, pz.hi)), pz.answer);
        if (pz.kind === 'build') assert.ok(pz.targetMidis.every(m => m >= 60 && m <= 83), 'build fits on the keyboard');
      }
    }
  }
});

test('wrong answers get a hint', () => {
  const [note] = T.makeSet('hint', 2);
  const wrong = `${(note.target.l + 3) % 7},0`;
  const g = T.grade(note, wrong);
  assert.equal(g.correct, false);
  assert.ok(g.hint.length > 0);
});
