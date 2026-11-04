// localStorage persistence for games in progress, stats and streaks.
import { addDays } from './daily.js';

const PREFIX = 'lineup9:';

export function load(key, fallback = null) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch { return fallback; }
}

export function save(key, value) {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); return true; } catch { return false; }
}

export function remove(key) { try { localStorage.removeItem(PREFIX + key); } catch { /* ignore */ } }

export const gameKey = (mode, id) => (mode === 'daily' ? `game:daily:${id}` : `game:practice:${id}`);

export function emptyStats() {
  return {
    daily: { played: 0, perfect: 0, totalBest: 0, streak: 0, maxStreak: 0, lastDay: null, dist: {} },
    practice: { played: 0, perfect: 0, totalBest: 0 },
  };
}

export function loadStats() {
  const s = load('stats');
  const base = emptyStats();
  if (!s) return base;
  return { daily: { ...base.daily, ...s.daily }, practice: { ...base.practice, ...s.practice } };
}

const bucket = (score) => (score === 100 ? '100' : score >= 90 ? '90' : score >= 80 ? '80' : score >= 70 ? '70' : score >= 50 ? '50' : '0');

/** Record a finished game once. Returns updated stats. Pure apart from the input copy. */
export function recordResult(stats, { mode, day, best, perfect }) {
  const s = JSON.parse(JSON.stringify(stats));
  const t = mode === 'daily' ? s.daily : s.practice;
  t.played += 1;
  t.totalBest += best;
  if (perfect) t.perfect += 1;
  if (mode === 'daily') {
    if (t.lastDay && addDays(t.lastDay, 1) === day) t.streak += 1;
    else if (t.lastDay !== day) t.streak = 1;
    t.maxStreak = Math.max(t.maxStreak, t.streak);
    t.lastDay = day;
    const b = bucket(best);
    t.dist[b] = (t.dist[b] || 0) + 1;
  }
  return s;
}

/** A streak is only current if the last completed daily was today or yesterday. */
export function currentStreak(stats, today) {
  const d = stats.daily;
  if (!d.lastDay) return 0;
  return d.lastDay === today || addDays(d.lastDay, 1) === today ? d.streak : 0;
}
