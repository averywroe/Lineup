// Game state: pure functions returning new state objects (easy to persist and test).
import { ROWS, scoreLineup, validate } from './scoring.js';

export const MAX_ATTEMPTS = 3;
const emptyRow = () => ({ pid: null, text: '', pos: '' });

export function newGame(puzzle, { mode = 'practice', day = null, number = null } = {}) {
  return {
    v: 1, puzzleId: puzzle.id, mode, day, number,
    rows: Array.from({ length: ROWS }, emptyRow),
    locked: Array(ROWS).fill(false),
    attempts: [],
    status: 'playing',          // 'playing' | 'won' | 'over'
    recorded: false,
  };
}

const clone = (s) => ({ ...s, rows: s.rows.map((r) => ({ ...r })), locked: [...s.locked] });
const editable = (s, i) => s.status === 'playing' && i >= 0 && i < ROWS && !s.locked[i];

/** Set player/text/pos on a row. Locked rows and finished games are never changed. */
export function setRow(state, i, patch) {
  if (!editable(state, i)) return state;
  const next = clone(state);
  const row = next.rows[i];
  if ('pid' in patch) { row.pid = patch.pid || null; }
  if ('text' in patch) { row.text = patch.text || ''; }
  if ('pos' in patch) { row.pos = patch.pos || ''; }
  return next;
}

/** Swap two unlocked rows (player and position move together), even across locked rows. */
export function swapRows(state, i, j) {
  if (i === j || !editable(state, i) || !editable(state, j)) return state;
  const next = clone(state);
  [next.rows[i], next.rows[j]] = [next.rows[j], next.rows[i]];
  return next;
}

/** Index a row would move to going up (-1) or down (+1), hopping over locked rows; -1 if none. */
export function moveTarget(state, i, dir) {
  if (!editable(state, i)) return -1;
  for (let j = i + dir; j >= 0 && j < ROWS; j += dir) if (!state.locked[j]) return j;
  return -1;
}

/** Move a row up (-1) or down (+1), hopping over locked rows. */
export function moveRow(state, i, dir) {
  const j = moveTarget(state, i, dir);
  return j < 0 ? state : swapRows(state, i, j);
}

/** Clear every unlocked row. */
export function clearUnlocked(state) {
  if (state.status !== 'playing') return state;
  const next = clone(state);
  next.rows = next.rows.map((r, i) => (next.locked[i] ? r : emptyRow()));
  return next;
}

/** Fill unlocked rows from parsed lines ({pid, text, pos}); locked rows are skipped. */
export function fillRows(state, entries) {
  let next = state;
  entries.forEach((e, i) => { if (e) next = setRow(next, i, e); });
  return next;
}

/**
 * Submit the current lineup. Invalid lineups return { error } and do not use an attempt.
 */
export function submit(state, puzzle) {
  if (state.status !== 'playing') return { state, error: { errors: [{ row: -1, msg: 'This game is finished.' }] } };
  const v = validate(puzzle, state.rows);
  if (!v.ok) return { state, error: v };
  const result = scoreLineup(puzzle, state.rows);
  const next = clone(state);
  next.attempts = [...state.attempts, {
    rows: state.rows.map(({ pid, pos }) => ({ pid, pos })),
    result: compactResult(result),
  }];
  result.rows.forEach((f, i) => { if (f.locked) next.locked[i] = true; });
  if (result.perfect) next.status = 'won';
  else if (next.attempts.length >= MAX_ATTEMPTS) next.status = 'over';
  return { state: next, result };
}

function compactResult(r) {
  return {
    total: r.total, name: r.name, pos: r.pos, order: r.order, perfect: r.perfect,
    rows: r.rows.map(({ player, arrow, posMark, posNote, order, locked }) => ({ player, arrow, posMark, posNote: posNote || null, order, locked })),
  };
}

export function bestAttempt(state) {
  let best = null;
  for (const a of state.attempts) if (!best || a.result.total > best.result.total) best = a;
  return best;
}

export const isDone = (s) => s.status !== 'playing';

/** Light structural check for state loaded from storage. */
export function isValidState(s, puzzle) {
  return s && s.v === 1 && s.puzzleId === puzzle.id && Array.isArray(s.rows) && s.rows.length === ROWS &&
    Array.isArray(s.locked) && s.locked.length === ROWS && Array.isArray(s.attempts);
}
