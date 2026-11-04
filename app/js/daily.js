// Daily puzzle schedule: identical for everyone, rolls over at midnight US Eastern time.

export const EPOCH = '2026-01-01';   // Daily #1
const TZ = 'America/New_York';

/** YYYY-MM-DD for the given instant in Eastern time. */
export function easternDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

const dayIndex = (key) => Math.round(Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10)) / 86400000);

export function dailyNumber(key) { return dayIndex(key) - dayIndex(EPOCH) + 1; }

export function addDays(key, n) {
  const d = new Date((dayIndex(key) + n) * 86400000);
  return d.toISOString().slice(0, 10);
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Each 150-day cycle visits every team-season once, in a fixed shuffled order. */
export function dailyPuzzleId(key, puzzleIds) {
  const ids = [...puzzleIds].sort();
  const n = ids.length;
  const k = ((dailyNumber(key) - 1) % n + n) % n;
  const cycle = Math.floor((dailyNumber(key) - 1) / n);
  const rand = mulberry32(0x4c4e39 + cycle * 7919);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids[k];
}

/** Milliseconds until the next Eastern midnight. */
export function msUntilNextEastern(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(now);
  const get = (t) => +parts.find((p) => p.type === t).value;
  const secs = (get('hour') % 24) * 3600 + get('minute') * 60 + get('second');
  return Math.max(1000, (86400 - secs) * 1000 - now.getMilliseconds());
}
