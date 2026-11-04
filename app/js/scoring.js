// Lineup Nine scoring. Pure functions, shared by the browser app and the Node tests.
//
// 100 points: 60 player names, 20 positions, 20 batting order, split evenly over nine rows.

export const ROWS = 9;
export const NAME_PTS = 60 / ROWS;
export const POS_PTS = 20 / ROWS;
export const ORDER_PTS = 20 / ROWS;

export const CREDIT = {
  targetName: 1,
  nearbyName: 0.75,          // played for the franchise within 3 seasons (inclusive), not that year
  rosterName: 0.85,          // same-season roster, >= 35 starts
  rosterNameLow: 0.5,        // same-season roster, < 35 starts
  rosterStarts: 35,
  posTarget: 1,
  posSecondary: 0.5,         // target player at a documented secondary position
  posRole: 0.5,              // non-target player at his actual role with the team
  order: [1, 0.75, 0.5],     // exact, one slot away, two slots away
};

export const AL_POSITIONS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];
export const NL_POSITIONS = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];
export const positionsFor = (league) => (league === 'AL' ? AL_POSITIONS : NL_POSITIONS);

/** Precompute lookups for a puzzle (cached on the object). */
export function prepare(puzzle) {
  if (puzzle._prep) return puzzle._prep;
  const slotOf = new Map();
  puzzle.lineup.forEach(([pid], i) => {
    if (i !== puzzle.pitcherSlot) slotOf.set(pid, i);
  });
  const pitchers = new Set((puzzle.pitchers || []).map(([pid]) => pid));
  if (puzzle.pitcherSlot != null) pitchers.add(puzzle.lineup[puzzle.pitcherSlot][0]);
  const prep = { slotOf, pitchers };
  Object.defineProperty(puzzle, '_prep', { value: prep, enumerable: false });
  return prep;
}

/** Validation. Invalid lineups do not use an attempt. */
export function validate(puzzle, rows) {
  const errors = [];
  const allowed = new Set(positionsFor(puzzle.league));
  const seenP = new Map();
  const seenPos = new Map();
  rows.forEach((r, i) => {
    const n = i + 1;
    if (!r.pid) {
      errors.push({ row: i, msg: r.text ? `Row ${n}: choose “${r.text}” from the player list` : `Row ${n}: add a player` });
    } else if (seenP.has(r.pid)) {
      errors.push({ row: i, also: seenP.get(r.pid), msg: `Rows ${seenP.get(r.pid) + 1} and ${n} list the same player` });
    } else seenP.set(r.pid, i);
    if (!r.pos) errors.push({ row: i, msg: `Row ${n}: pick a position` });
    else if (!allowed.has(r.pos)) errors.push({ row: i, msg: `Row ${n}: ${r.pos} isn't used in ${puzzle.league} lineups` });
    else if (seenPos.has(r.pos)) errors.push({ row: i, also: seenPos.get(r.pos), msg: `Rows ${seenPos.get(r.pos) + 1} and ${n} are both ${r.pos}` });
    else seenPos.set(r.pos, i);
  });
  return { ok: errors.length === 0, errors };
}

/**
 * Score a lineup. rows: [{pid, pos}] x 9 in batting order.
 * Returns per-row feedback and point totals.
 */
export function scoreLineup(puzzle, rows) {
  const { slotOf, pitchers } = prepare(puzzle);
  const pSlot = puzzle.pitcherSlot;

  // NL: any accepted starting pitcher can fill the pitcher's slot, but only one row can claim it.
  // The row closest to the real pitcher slot wins; ties go to the earlier row.
  let pitcherRow = -1;
  if (pSlot != null) {
    let best = Infinity;
    rows.forEach((r, i) => {
      if (r.pid && pitchers.has(r.pid) && !slotOf.has(r.pid)) {
        const d = Math.abs(i - pSlot);
        if (d < best) { best = d; pitcherRow = i; }
      }
    });
  }

  let nameSum = 0, posSum = 0, orderSum = 0;
  const out = rows.map((r, i) => {
    const fb = { pid: r.pid, pos: r.pos, player: 'gray', arrow: null, posMark: 'gray', order: 'na', locked: false,
      credit: { name: 0, pos: 0, order: 0 } };
    let target = -1;
    if (slotOf.has(r.pid)) target = slotOf.get(r.pid);
    else if (i === pitcherRow) target = pSlot;

    const ros = puzzle.roster[r.pid];
    if (target >= 0) {
      fb.player = target === i ? 'green' : 'yellow';
      if (target < i) fb.arrow = 'up';
      else if (target > i) fb.arrow = 'down';
      fb.credit.name = CREDIT.targetName;
      const tPos = puzzle.lineup[target][1];
      if (r.pos === tPos) { fb.posMark = 'green'; fb.credit.pos = CREDIT.posTarget; }
      else if (ros && ros[2].includes(r.pos)) { fb.posMark = 'yellow'; fb.posNote = 'secondary'; fb.credit.pos = CREDIT.posSecondary; }
      const d = Math.abs(target - i);
      fb.credit.order = CREDIT.order[d] || 0;
      fb.order = d === 0 ? 'green' : fb.credit.order > 0 ? 'yellow' : 'gray';
      fb.locked = fb.player === 'green' && fb.posMark === 'green';
    } else if (ros) {
      fb.player = 'orange';
      fb.starts = ros[0];
      fb.credit.name = ros[0] >= CREDIT.rosterStarts ? CREDIT.rosterName : CREDIT.rosterNameLow;
      if (ros[1] && r.pos === ros[1]) { fb.posMark = 'yellow'; fb.posNote = 'role'; fb.credit.pos = CREDIT.posRole; }
    } else if (puzzle.nearby[r.pid]) {
      fb.player = 'blue';
      fb.credit.name = CREDIT.nearbyName;
      const role = puzzle.nearby[r.pid][0];
      if (role && r.pos === role) { fb.posMark = 'yellow'; fb.posNote = 'role'; fb.credit.pos = CREDIT.posRole; }
    } else {
      fb.posMark = 'gray';
    }
    nameSum += fb.credit.name;
    posSum += fb.credit.pos;
    orderSum += fb.credit.order;
    fb.points = fb.credit.name * NAME_PTS + fb.credit.pos * POS_PTS + fb.credit.order * ORDER_PTS;
    return fb;
  });

  const perfect = out.every((f) => f.locked);
  const name = nameSum * NAME_PTS, pos = posSum * POS_PTS, order = orderSum * ORDER_PTS;
  const raw = name + pos + order;
  // 100 is reserved for a perfect lineup.
  const total = perfect ? 100 : Math.max(0, Math.min(99, Math.round(raw)));
  return { rows: out, name, pos, order, raw, total, perfect };
}

/** The answer key as scoreable rows. */
export function answerRows(puzzle) {
  return puzzle.lineup.map(([pid, pos]) => ({ pid, pos }));
}
