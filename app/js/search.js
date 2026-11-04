// Player name normalization and autocomplete search.
// Matching ignores case, accents and punctuation: "carlos pena" finds "Carlos Peña",
// "bj upton" / "B.J. Upton" find "B. J. Upton", "oconnor" finds "O'Connor".

export function normalize(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // strip accents
    .toLowerCase()
    .replace(/[‘’'`´.]/g, '')                    // drop apostrophes and periods
    .replace(/[^a-z0-9]+/g, ' ')                           // other punctuation -> space
    .trim()
    .replace(/\b([a-z]) (?=[a-z]\b)/g, '$1')               // "b j upton" -> "bj upton"
    .replace(/\s+/g, ' ');
}

export const compact = (s) => normalize(s).replace(/ /g, '');

const SUFFIX = /^(jr|sr|ii|iii|iv)$/;

export class PlayerIndex {
  constructor(data) {
    const c = data.cols;
    const ix = (k) => c.indexOf(k);
    const [iId, iF, iL, iFrom, iTo, iPos, iG] = ['id', 'first', 'last', 'from', 'to', 'pos', 'g'].map(ix);
    this.list = data.rows.map((r) => {
      const name = `${r[iF]} ${r[iL]}`.trim();
      const norm = normalize(name);
      return {
        id: r[iId], first: r[iF], last: r[iL], name, from: r[iFrom], to: r[iTo],
        pos: r[iPos] || '', g: r[iG] || 0,
        norm, tokens: norm.split(' '), lastNorm: normalize(r[iL]), compact: norm.replace(/ /g, ''),
        compactRev: (normalize(r[iL]) + normalize(r[iF])).replace(/ /g, ''),
      };
    });
    this.byId = new Map(this.list.map((p) => [p.id, p]));
  }

  get(id) { return this.byId.get(id); }

  /** Score how well a query matches a player; 0 = no match. */
  matchScore(p, qNorm, qTokens, qCompact) {
    if (p.norm === qNorm) return 100;
    if (p.compact === qCompact) return 95;
    // every query token must prefix some name token
    let all = true;
    for (const t of qTokens) {
      if (!p.tokens.some((nt) => nt.startsWith(t))) { all = false; break; }
    }
    if (all) {
      if (p.lastNorm === qNorm) return 90;              // exact surname
      if (p.lastNorm.startsWith(qNorm)) return 70;      // surname prefix
      return 60;
    }
    if (qCompact.length >= 3 && (p.compact.startsWith(qCompact) || p.compactRev.startsWith(qCompact))) return 50;
    return 0;
  }

  /**
   * Search all MLB players. `year` (optional) only nudges ranking toward players whose
   * careers include that season - suggestions are never filtered by team.
   */
  search(query, { limit = 8, year = null } = {}) {
    const qNorm = normalize(query);
    if (!qNorm) return [];
    const qTokens = qNorm.split(' ').filter((t) => t && !SUFFIX.test(t));
    if (!qTokens.length) return [];
    const qCompact = qNorm.replace(/ /g, '');
    const hits = [];
    for (const p of this.list) {
      const s = this.matchScore(p, qNorm, qTokens, qCompact);
      if (!s) continue;
      let rank = s * 1000;
      if (year != null) {
        if (p.from <= year && p.to >= year) rank += 30000;
        else if (p.from <= year + 3 && p.to >= year - 3) rank += 15000;
      }
      rank += Math.min(p.g, 3000) / 3;     // familiarity: career games
      hits.push([rank, p]);
    }
    hits.sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name));
    return hits.slice(0, limit).map((h) => h[1]);
  }

  /** Best single match for pasted text, or null. Exact names win; ambiguity is reported. */
  resolve(text, { year = null } = {}) {
    const hits = this.search(text, { limit: 5, year });
    if (!hits.length) return { player: null, ambiguous: false, options: [] };
    const qNorm = normalize(text);
    const exact = hits.filter((p) => p.norm === qNorm || p.compact === qNorm.replace(/ /g, ''));
    const pool = exact.length ? exact : hits;
    const ambiguous = exact.length > 1 || (!exact.length && hits.length > 1 &&
      this.matchScore(hits[1], qNorm, qNorm.split(' '), qNorm.replace(/ /g, '')) ===
      this.matchScore(hits[0], qNorm, qNorm.split(' '), qNorm.replace(/ /g, '')));
    return { player: pool[0], ambiguous, options: pool.slice(0, 5) };
  }
}

export function careerLabel(p) {
  if (!p) return '';
  const yrs = p.from === p.to ? `${p.from}` : `${p.from}–${p.to}`;
  return p.pos ? `${yrs} · ${p.pos}` : yrs;
}
