// Lineup Nine - browser controller.
import { PlayerIndex, careerLabel, normalize } from './search.js';
import { positionsFor, ROWS, answerRows } from './scoring.js';
import * as G from './game.js';
import { easternDateKey, dailyNumber, dailyPuzzleId, msUntilNextEastern } from './daily.js';
import * as store from './storage.js';
import { parseLineup } from './paste.js';

const $ = (sel, el = document) => el.querySelector(sel);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null) n.append(kid.nodeType ? kid : document.createTextNode(kid));
  return n;
};
const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');

const app = {
  puzzles: [], byId: new Map(), index: null,
  mode: 'daily', today: null, puzzle: null, game: null,
  swapFrom: null, active: -1, hits: [], hit: 0, invalid: new Set(),
};

// ------------------------------------------------------------------ boot

async function boot() {
  try {
    const [puzzles, players] = await Promise.all(['data/puzzles.json', 'data/players.json'].map(async (u) => {
      const r = await fetch(u);
      if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`);
      return r.json();
    }));
    app.puzzles = puzzles;
    app.byId = new Map(puzzles.map((p) => [p.id, p]));
    app.index = new PlayerIndex(players);
  } catch (e) {
    $('#p-team').textContent = 'Could not load data';
    $('#msg').textContent = `${e.message}. Serve the app folder over HTTP (see README).`;
    return;
  }
  buildBoard();
  buildPicker();
  bindUI();
  route();
  window.addEventListener('hashchange', route);
  setInterval(checkRollover, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkRollover(); });
}

function route() {
  const h = location.hash.replace(/^#/, '');
  if (h.startsWith('practice')) {
    const id = h.split('/')[1];
    openPractice(app.byId.has(id) ? id : store.load('practice:last') || randomId());
  } else openDaily();
}

function checkRollover() {
  if (app.mode === 'daily' && easternDateKey() !== app.today) openDaily();
  if (app.mode === 'daily' && G.isDone(app.game)) renderResult();
}

const randomId = (avoid) => {
  let id;
  do { id = app.puzzles[Math.floor(Math.random() * app.puzzles.length)].id; } while (id === avoid && app.puzzles.length > 1);
  return id;
};

// ------------------------------------------------------------------ modes

function openDaily() {
  app.mode = 'daily';
  app.today = easternDateKey();
  const id = dailyPuzzleId(app.today, app.puzzles.map((p) => p.id));
  loadGame(app.byId.get(id), 'daily', app.today);
  if (location.hash && location.hash !== '#daily') history.replaceState(null, '', '#daily');
}

function openPractice(id) {
  app.mode = 'practice';
  store.save('practice:last', id);
  loadGame(app.byId.get(id), 'practice');
  const want = `#practice/${id}`;
  if (location.hash !== want) history.replaceState(null, '', want);
}

function loadGame(puzzle, mode, day = null) {
  app.puzzle = puzzle;
  const key = store.gameKey(mode, mode === 'daily' ? day : puzzle.id);
  const saved = store.load(key);
  app.game = G.isValidState(saved, puzzle)
    ? saved
    : G.newGame(puzzle, { mode, day, number: day ? dailyNumber(day) : null });
  app.gameKey = key;
  app.swapFrom = null;
  app.invalid.clear();
  hideSuggest();
  setMsg('');
  renderAll();
  persist();
}

function persist() { store.save(app.gameKey, app.game); }

function update(next) {
  if (next === app.game) return false;
  app.game = next;
  persist();
  return true;
}

// ------------------------------------------------------------------ board

function buildBoard() {
  const board = $('#board');
  for (let i = 0; i < ROWS; i++) {
    const li = el('li', { class: 'row', 'data-i': i },
      el('button', { type: 'button', class: 'slot', 'data-act': 'swap', 'aria-label': `Batting ${ordinal(i + 1)}. Tap to swap.` },
        el('span', { class: 'slot-n', text: String(i + 1) }), el('span', { class: 'mark mark-order', 'aria-hidden': 'true' })),
      el('div', { class: 'pcell' },
        el('span', { class: 'mark mark-player', 'aria-hidden': 'true' }),
        el('input', {
          class: 'pname', type: 'text', inputmode: 'search', enterkeyhint: 'next', autocomplete: 'off',
          autocorrect: 'off', autocapitalize: 'words', spellcheck: 'false', placeholder: 'Player',
          'aria-label': `Batting ${ordinal(i + 1)}: player`, 'aria-autocomplete': 'list', 'aria-controls': 'suggest',
        }),
        el('span', { class: 'pmeta' })),
      el('div', { class: 'poscell' },
        el('select', { class: 'pos', 'aria-label': `Batting ${ordinal(i + 1)}: position` }),
        el('span', { class: 'mark mark-pos', 'aria-hidden': 'true' })),
      el('div', { class: 'move' },
        el('button', { type: 'button', class: 'mv', 'data-act': 'up', 'aria-label': `Move row ${i + 1} up`, text: '▲' }),
        el('button', { type: 'button', class: 'mv', 'data-act': 'down', 'aria-label': `Move row ${i + 1} down`, text: '▼' })),
      el('span', { class: 'fbtext sr-only', 'aria-live': 'off' }));
    board.append(li);
  }
}

const rowEl = (i) => $(`#board .row[data-i="${i}"]`);

function setPositionOptions() {
  const opts = positionsFor(app.puzzle.league);
  for (let i = 0; i < ROWS; i++) {
    const sel = $('.pos', rowEl(i));
    sel.replaceChildren(el('option', { value: '', text: 'Pos' }), ...opts.map((p) => el('option', { value: p, text: p })));
  }
}

const PLAYER_MARK = { green: '✓', blue: '±3', orange: 'R', gray: '✗' };
const PLAYER_TEXT = {
  green: 'right player, right slot', yellow: 'in the lineup, bats elsewhere', blue: 'played for this team within three seasons',
  orange: 'on this season’s roster, not in the lineup', gray: 'no match',
};

function renderBoard() {
  const g = app.game;
  const last = g.attempts[g.attempts.length - 1];
  const done = G.isDone(g);
  for (let i = 0; i < ROWS; i++) {
    const li = rowEl(i);
    const r = g.rows[i];
    const locked = g.locked[i];
    const input = $('.pname', li);
    const sel = $('.pos', li);
    const p = r.pid ? app.index.get(r.pid) : null;
    const shown = p ? p.name : r.text;
    if (document.activeElement !== input || input.value !== shown && p) input.value = shown;
    $('.pmeta', li).textContent = p ? careerLabel(p) : '';
    sel.value = r.pos;
    input.disabled = sel.disabled = locked || done;
    li.classList.toggle('locked', locked);
    li.classList.toggle('done', done);
    li.classList.toggle('swap-from', app.swapFrom === i);
    li.classList.toggle('invalid', app.invalid.has(i));
    $('.slot', li).disabled = locked || done;
    li.querySelectorAll('.mv').forEach((b) => { b.disabled = locked || done; });

    // Feedback from the latest attempt, shown while the row still holds the evaluated player.
    const pm = $('.mark-player', li), om = $('.mark-order', li), qm = $('.mark-pos', li);
    let fb = null;
    if (last && last.rows[i].pid && last.rows[i].pid === r.pid) fb = last.result.rows[i];
    li.dataset.player = fb ? fb.player : '';
    setMark(pm, fb && fb.player, fb ? (fb.player === 'yellow' ? (fb.arrow === 'up' ? '↑' : '↓') : PLAYER_MARK[fb.player]) : '');
    setMark(om, fb && (fb.order === 'na' ? 'none' : fb.order), fb ? ({ green: '✓', yellow: '≈', gray: '✗', na: '–' })[fb.order] : '');
    const posSame = fb && last.rows[i].pos === r.pos;
    setMark(qm, posSame && fb.posMark, posSame ? ({ green: '✓', yellow: '½', gray: '✗' })[fb.posMark] : '');
    $('.fbtext', li).textContent = fb
      ? `Row ${i + 1}: ${PLAYER_TEXT[fb.player]}${fb.arrow ? (fb.arrow === 'up' ? ', bats earlier' : ', bats later') : ''}; position ${posSame ? ({ green: 'right', yellow: fb.posNote === 'role' ? 'his usual role, partial credit' : 'secondary, half credit', gray: 'wrong' })[fb.posMark] : 'changed'}; order ${({ green: 'exact', yellow: 'close', gray: 'far', na: 'not applicable' })[fb.order]}.${locked ? ' Locked.' : ''}`
      : '';
    $('.slot', li).setAttribute('aria-label', `Batting ${ordinal(i + 1)}${locked ? ', locked' : '. Tap to swap.'}`);
  }
}

function setMark(node, color, text) {
  node.className = node.className.replace(/\sfb-\w+/g, '');
  node.textContent = text || '';
  if (color) node.classList.add(`fb-${color}`);
  node.hidden = !text;
}

function renderHead() {
  const z = app.puzzle, g = app.game;
  $('#p-year').textContent = z.year;
  $('#p-team').textContent = z.name;
  $('#p-league').textContent = z.league;
  $('#p-league').title = z.league === 'AL' ? 'American League: DH lineup' : 'National League: pitcher bats';
  $('#p-label').textContent = app.mode === 'daily'
    ? `Daily #${g.number} · ${fmtDate(g.day)}`
    : `Practice · ${z.w}–${z.l}`;
  const n = g.attempts.length;
  const left = G.MAX_ATTEMPTS - n;
  $('#p-attempts').replaceChildren(
    ...Array.from({ length: G.MAX_ATTEMPTS }, (_, k) => el('span', { class: `pip ${k < n ? 'used' : ''}` })),
    el('span', { class: 'pip-label', text: G.isDone(g) ? 'Final' : `${left} ${left === 1 ? 'try' : 'tries'} left` }));
  $('#tab-daily').setAttribute('aria-selected', String(app.mode === 'daily'));
  $('#tab-practice').setAttribute('aria-selected', String(app.mode === 'practice'));
  $('#practice-picker').hidden = app.mode !== 'practice';
  if (app.mode === 'practice') {
    $('#pick-team').value = z.franch;
    $('#pick-year').value = String(z.year);
    refreshTeamNames(z.year);
  }
  const done = G.isDone(g);
  $('#p-intro').hidden = n > 0;
  $('#actions').hidden = done;
  $('.legend').hidden = !g.attempts.length;
}

const fmtDate = (key) => new Date(`${key}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

function renderAll() {
  setPositionOptions();
  renderHead();
  renderBoard();
  renderHistory();
  renderResult();
}

// ------------------------------------------------------------------ history

function renderHistory() {
  const g = app.game;
  const box = $('#history');
  box.replaceChildren();
  if (!g.attempts.length) return;
  box.append(el('h2', { class: 'section-title', text: 'Your attempts' }));
  g.attempts.forEach((a, k) => {
    const det = el('details', { class: 'attempt', open: k === g.attempts.length - 1 ? true : null },
      el('summary', {}, el('span', { text: `Attempt ${k + 1}` }), el('span', { class: 'att-score', text: `${a.result.total}` })));
    const tbl = el('table', { class: 'att-table' },
      el('thead', {}, el('tr', {}, el('th', { text: '#' }), el('th', { text: 'Player' }), el('th', { text: 'Pos' }), el('th', { text: 'Who' }), el('th', { text: 'Pos' }), el('th', { text: 'Ord' }))));
    const tb = el('tbody');
    a.rows.forEach((r, i) => {
      const f = a.result.rows[i];
      const p = app.index.get(r.pid);
      tb.append(el('tr', { class: f.locked ? 'locked' : '' },
        el('td', { class: 'n', text: String(i + 1) }),
        el('td', { class: 'nm', text: p ? p.name : '?' }),
        el('td', { class: 'ps', text: r.pos }),
        el('td', {}, chip(f.player, f.player === 'yellow' ? (f.arrow === 'up' ? '↑' : '↓') : PLAYER_MARK[f.player])),
        el('td', {}, chip(f.posMark, ({ green: '✓', yellow: '½', gray: '✗' })[f.posMark])),
        el('td', {}, chip(f.order === 'na' ? 'none' : f.order, ({ green: '✓', yellow: '≈', gray: '✗', na: '–' })[f.order]))));
    });
    tbl.append(tb);
    det.append(tbl, el('p', { class: 'att-break', text: breakdownText(a.result) }));
    box.append(det);
  });
}

const chip = (color, text) => el('span', { class: `chip fb-${color}`, text });
const fmt1 = (x) => (Math.round(x * 10) / 10).toFixed(1).replace(/\.0$/, '');
const breakdownText = (r) => `Names ${fmt1(r.name)}/60 · Positions ${fmt1(r.pos)}/20 · Order ${fmt1(r.order)}/20`;

// ------------------------------------------------------------------ result / reveal

let countdownTimer = null;

function renderResult() {
  const g = app.game, z = app.puzzle;
  const box = $('#result');
  clearInterval(countdownTimer);
  if (!G.isDone(g)) { box.hidden = true; box.replaceChildren(); return; }
  recordIfNeeded();
  const best = G.bestAttempt(g);
  const r = best.result;
  const bestIdx = g.attempts.indexOf(best) + 1;

  const ans = el('ol', { class: 'answer' });
  z.lineup.forEach(([pid, pos], i) => {
    const p = app.index.get(pid);
    const isP = i === z.pitcherSlot;
    ans.append(el('li', {},
      el('span', { class: 'a-n', text: String(i + 1) }),
      el('span', { class: 'a-name' }, p ? p.name : pid,
        isP ? el('span', { class: 'a-sub', text: `or any of ${z.pitchers.length} pitchers with 5+ starts` }) : null),
      el('span', { class: 'a-pos', text: pos })));
  });
  const ex = z.example;
  const exDate = new Date(`${ex.date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const games = z.league === 'AL' ? 'DH games' : 'non-DH games';
  const pitchersList = z.pitcherSlot != null
    ? el('details', { class: 'pitchers' }, el('summary', { text: 'Accepted pitchers' }),
      el('p', { class: 'small', text: z.pitchers.map(([pid, n]) => `${app.index.get(pid)?.name || pid} (${n})`).join(' · ') }))
    : null;

  box.replaceChildren(...[
    el('div', { class: 'result-top' },
      el('div', {},
        el('p', { class: 'result-kicker', text: r.perfect ? `Perfect lineup in ${bestIdx}` + (bestIdx === 1 ? ' try' : ' tries') : 'Final card' }),
        el('p', { class: 'result-best' }, el('span', { class: 'big', text: String(r.total) }), el('span', { text: '/100 best' }))),
      el('div', { class: 'bars' },
        bar('Names', r.name, 60), bar('Positions', r.pos, 20), bar('Order', r.order, 20))),
    el('h3', { class: 'section-title', text: `${z.year} ${z.name} · most-used lineup` }),
    ans,
    el('p', { class: 'freq' },
      `Started ${z.freq} of ${z.eligible} ${games} (${z.distinct} different lineups used). First used ${exDate} `,
      `${ex.home ? 'vs' : 'at'} ${ex.oppAbbr}${ex.game ? ` (game ${ex.game})` : ''}.`),
    pitchersList,
    el('div', { class: 'share-row' },
      el('button', { type: 'button', class: 'btn-primary', id: 'btn-share', onclick: share, text: 'Share result' }),
      app.mode === 'practice'
        ? el('button', { type: 'button', class: 'btn-secondary', onclick: () => openPractice(randomId(z.id)), text: 'Next random' })
        : el('button', { type: 'button', class: 'btn-secondary', onclick: () => { location.hash = '#practice'; }, text: 'Practice' }),
      app.mode === 'practice'
        ? el('button', { type: 'button', class: 'btn-secondary', onclick: replay, text: 'Replay' }) : null),
    el('pre', { class: 'share-preview', 'aria-label': 'Share text', text: shareText() }),
    app.mode === 'daily' ? el('p', { class: 'countdown', id: 'countdown' }) : null,
  ].filter(Boolean));
  box.hidden = false;
  if (app.mode === 'daily') {
    const tick = () => {
      const ms = msUntilNextEastern();
      const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
      const c = $('#countdown');
      if (c) c.textContent = `Next Daily in ${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')} (midnight ET)`;
    };
    tick();
    countdownTimer = setInterval(tick, 1000);
  }
}

function bar(label, v, max) {
  return el('div', { class: 'bar' },
    el('span', { class: 'bar-l', text: label }),
    el('span', { class: 'bar-track' }, el('span', { class: 'bar-fill', style: `width:${(100 * v) / max}%` })),
    el('span', { class: 'bar-v', text: `${fmt1(v)}/${max}` }));
}

function replay() {
  update(G.newGame(app.puzzle, { mode: 'practice' }));
  app.invalid.clear();
  renderAll();
  setMsg('');
}

function recordIfNeeded() {
  const g = app.game;
  if (g.recorded) return;
  const best = G.bestAttempt(g);
  const stats = store.recordResult(store.loadStats(), { mode: g.mode, day: g.day, best: best.result.total, perfect: best.result.perfect });
  store.save('stats', stats);
  update({ ...g, recorded: true });
}

const EMOJI = { green: '🟩', yellow: '🟨', blue: '🟦', orange: '🟧', gray: '⬜' };

function shareText() {
  const g = app.game, z = app.puzzle;
  const best = G.bestAttempt(g);
  const head = app.mode === 'daily' ? `Lineup Nine · Daily #${g.number}` : 'Lineup Nine · Practice';
  const sub = `${z.year} ${z.abbr} · ${best.result.perfect ? `Perfect ${g.attempts.length}/3` : `${best.result.total}/100 · X/3`}`;
  const lines = g.attempts.map((a) => `${a.result.rows.map((f) => EMOJI[f.player]).join('')} ${a.result.total}`);
  return [head, sub, ...lines].join('\n');
}

async function share() {
  const text = shareText();
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) { await navigator.share({ text }); return; }
  } catch { /* fall through to copy */ }
  try {
    await navigator.clipboard.writeText(text);
    flash($('#btn-share'), 'Copied!');
  } catch {
    flash($('#btn-share'), 'Select the text below to copy');
  }
}

function flash(btn, text) {
  if (!btn) return;
  const old = btn.textContent;
  btn.textContent = text;
  setTimeout(() => { btn.textContent = old; }, 1600);
}

// ------------------------------------------------------------------ autocomplete

function showSuggest(i) {
  const input = $('.pname', rowEl(i));
  const q = input.value;
  app.active = i;
  app.hits = q.trim().length >= 2 ? app.index.search(q, { limit: 8, year: app.puzzle.year }) : [];
  app.hit = 0;
  const box = $('#suggest');
  if (!app.hits.length) {
    box.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    if (q.trim().length >= 2) { box.replaceChildren(el('li', { class: 'none', text: 'No MLB player found' })); box.hidden = false; placeSuggest(i); }
    return;
  }
  box.replaceChildren(...app.hits.map((p, k) => el('li', {
    role: 'option', id: `sg-${k}`, class: k === 0 ? 'on' : '', 'data-k': k, 'aria-selected': String(k === 0),
  }, el('span', { class: 'sg-name', text: p.name }), el('span', { class: 'sg-meta', text: careerLabel(p) }))));
  box.hidden = false;
  input.setAttribute('aria-expanded', 'true');
  input.setAttribute('aria-activedescendant', 'sg-0');
  placeSuggest(i);
}

function placeSuggest(i) {
  const box = $('#suggest');
  const cell = $('.pcell', rowEl(i));
  const card = box.offsetParent || box.parentElement;
  const c = cell.getBoundingClientRect(), k = card.getBoundingClientRect();
  box.style.top = `${c.bottom - k.top + 2}px`;
  box.style.left = `${Math.max(8, c.left - k.left)}px`;
  box.style.right = '8px';
}

function hideSuggest() {
  const box = $('#suggest');
  box.hidden = true;
  app.hits = [];
  if (app.active >= 0) $('.pname', rowEl(app.active))?.setAttribute('aria-expanded', 'false');
}

function highlight(k) {
  const items = [...$('#suggest').children];
  if (!items.length || !app.hits.length) return;
  app.hit = (k + app.hits.length) % app.hits.length;
  items.forEach((li, j) => { li.classList.toggle('on', j === app.hit); li.setAttribute('aria-selected', String(j === app.hit)); });
  $('.pname', rowEl(app.active)).setAttribute('aria-activedescendant', `sg-${app.hit}`);
  items[app.hit].scrollIntoView({ block: 'nearest' });
}

function choose(i, p) {
  update(G.setRow(app.game, i, { pid: p.id, text: p.name }));
  app.invalid.delete(i);
  hideSuggest();
  renderBoard();
  const li = rowEl(i);
  const sel = $('.pos', li);
  if (!app.game.rows[i].pos) sel.focus();
  else focusNextEmpty(i);
}

function focusNextEmpty(i) {
  for (let j = i + 1; j < ROWS; j++) {
    if (!app.game.locked[j] && !app.game.rows[j].pid) { $('.pname', rowEl(j)).focus(); return; }
  }
}

// ------------------------------------------------------------------ events

function bindUI() {
  const board = $('#board');

  board.addEventListener('input', (e) => {
    if (!e.target.classList.contains('pname')) return;
    const i = +e.target.closest('.row').dataset.i;
    update(G.setRow(app.game, i, { pid: null, text: e.target.value }));
    app.invalid.delete(i);
    renderBoard();
    showSuggest(i);
  });

  board.addEventListener('focusin', (e) => {
    if (e.target.classList.contains('pname')) {
      const i = +e.target.closest('.row').dataset.i;
      if (!app.game.rows[i].pid && e.target.value) showSuggest(i);
      else if (app.game.rows[i].pid) e.target.select();
    }
  });

  board.addEventListener('focusout', (e) => {
    if (!e.target.classList.contains('pname')) return;
    const i = +e.target.closest('.row').dataset.i;
    setTimeout(() => {
      if (document.activeElement === e.target) return;
      if (app.active === i) hideSuggest();
      // Auto-resolve an exactly typed, unambiguous name.
      const r = app.game.rows[i];
      if (!r.pid && r.text) {
        const res = app.index.resolve(r.text, { year: app.puzzle.year });
        if (res.player && !res.ambiguous && res.player.norm === normalize(r.text)) {
          update(G.setRow(app.game, i, { pid: res.player.id, text: res.player.name }));
          renderBoard();
        }
      }
    }, 150);
  });

  board.addEventListener('keydown', (e) => {
    if (!e.target.classList.contains('pname')) return;
    const i = +e.target.closest('.row').dataset.i;
    const open = !$('#suggest').hidden && app.hits.length && app.active === i;
    if (e.key === 'ArrowDown' && open) { e.preventDefault(); highlight(app.hit + 1); }
    else if (e.key === 'ArrowUp' && open) { e.preventDefault(); highlight(app.hit - 1); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (open) choose(i, app.hits[app.hit]);
      else if (app.game.rows[i].pid) $('.pos', rowEl(i)).focus();
    } else if (e.key === 'Escape') hideSuggest();
  });

  board.addEventListener('change', (e) => {
    if (!e.target.classList.contains('pos')) return;
    const i = +e.target.closest('.row').dataset.i;
    update(G.setRow(app.game, i, { pos: e.target.value }));
    app.invalid.delete(i);
    renderBoard();
    if (e.target.value && !app.game.rows[i + 1]?.pid) focusNextEmpty(i);
  });

  board.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const i = +btn.closest('.row').dataset.i;
    const act = btn.dataset.act;
    if (act === 'up' || act === 'down') {
      const dir = act === 'up' ? -1 : 1;
      const j = G.moveTarget(app.game, i, dir);
      update(G.moveRow(app.game, i, dir));
      app.swapFrom = null;
      showSwapHint();
      renderBoard();
      if (j >= 0) rowEl(j).querySelector(`.mv[data-act="${act}"]`)?.focus();
    } else if (act === 'swap') {
      if (app.swapFrom === null) app.swapFrom = i;
      else if (app.swapFrom === i) app.swapFrom = null;
      else {
        update(G.swapRows(app.game, app.swapFrom, i));
        app.swapFrom = null;
      }
      showSwapHint();
      renderBoard();
    }
  });

  $('#suggest').addEventListener('pointerdown', (e) => e.preventDefault()); // keep input focus
  $('#suggest').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-k]');
    if (li && app.active >= 0) choose(app.active, app.hits[+li.dataset.k]);
  });
  window.addEventListener('resize', () => { if (!$('#suggest').hidden && app.active >= 0) placeSuggest(app.active); });

  $('#btn-submit').addEventListener('click', onSubmit);
  $('#btn-clear').addEventListener('click', () => {
    update(G.clearUnlocked(app.game));
    app.invalid.clear();
    app.swapFrom = null;
    showSwapHint();
    setMsg('');
    renderBoard();
  });
  $('#tab-daily').addEventListener('click', () => { location.hash = '#daily'; });
  $('#tab-practice').addEventListener('click', () => { location.hash = '#practice'; });
  $('#btn-help').addEventListener('click', () => $('#dlg-help').showModal());
  $('#btn-stats').addEventListener('click', openStats);
  $('#btn-random').addEventListener('click', () => openPractice(randomId(app.puzzle?.id)));
  $('#pick-team').addEventListener('change', pickChanged);
  $('#pick-year').addEventListener('change', pickChanged);
  document.querySelectorAll('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));

  // paste
  $('#btn-paste').addEventListener('click', () => { $('#paste-preview').replaceChildren(); $('#paste-apply').disabled = true; $('#dlg-paste').showModal(); $('#paste-text').focus(); });
  $('#paste-text').addEventListener('input', previewPaste);
  $('#paste-cancel').addEventListener('click', () => $('#dlg-paste').close());
  $('#paste-apply').addEventListener('click', applyPaste);

}

function showSwapHint() {
  const h = $('#swap-hint');
  if (app.swapFrom === null) { h.hidden = true; return; }
  h.hidden = false;
  h.textContent = `Swapping row ${app.swapFrom + 1}: tap another batting number (or the same one to cancel).`;
}

function setMsg(text, kind = '') {
  const m = $('#msg');
  m.className = `msg ${kind}`;
  if (Array.isArray(text)) m.replaceChildren(el('ul', {}, text.map((t) => el('li', { text: t }))));
  else m.textContent = text;
}

function onSubmit() {
  hideSuggest();
  const { state, error, result } = G.submit(app.game, app.puzzle);
  if (error) {
    app.invalid = new Set(error.errors.flatMap((x) => [x.row, x.also]).filter((r) => r != null && r >= 0));
    const msgs = [...new Set(error.errors.map((x) => x.msg))];
    setMsg(['Not submitted (no attempt used):', ...msgs.slice(0, 4), ...(msgs.length > 4 ? [`…and ${msgs.length - 4} more`] : [])], 'error');
    renderBoard();
    return;
  }
  app.invalid.clear();
  app.swapFrom = null;
  showSwapHint();
  update(state);
  const lockedNow = result.rows.filter((f) => f.locked).length;
  if (state.status === 'playing') {
    setMsg(`Attempt ${state.attempts.length}: ${result.total}/100. ${lockedNow} row${lockedNow === 1 ? '' : 's'} locked. Revise the rest and resubmit.`, 'ok');
  } else setMsg(result.perfect ? 'Perfect lineup!' : 'That was your last attempt. Here is the answer.', 'ok');
  renderAll();
  if (G.isDone(state)) $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ------------------------------------------------------------------ practice picker

function buildPicker() {
  const teams = new Map();
  for (const z of app.puzzles) teams.set(z.franch, z);
  const ts = $('#pick-team');
  [...teams.values()].sort((a, b) => a.name.localeCompare(b.name))
    .forEach((z) => ts.append(el('option', { value: z.franch, text: z.name })));
  const years = [...new Set(app.puzzles.map((z) => z.year))].sort();
  $('#pick-year').append(...years.map((y) => el('option', { value: String(y), text: String(y) })));
}

function refreshTeamNames(year) {
  for (const o of $('#pick-team').options) {
    const z = app.puzzles.find((p) => p.franch === o.value && p.year === year);
    if (z) o.textContent = z.name;
  }
}

function pickChanged() {
  const f = $('#pick-team').value, y = +$('#pick-year').value;
  const z = app.puzzles.find((p) => p.franch === f && p.year === y);
  if (z) openPractice(z.id);
}

// ------------------------------------------------------------------ paste

let pasteRows = [];

function previewPaste() {
  const lines = parseLineup($('#paste-text').value).slice(0, ROWS);
  const allowed = new Set(positionsFor(app.puzzle.league));
  pasteRows = lines.map((l) => {
    const res = l.name ? app.index.resolve(l.name, { year: app.puzzle.year }) : { player: null };
    return { ...l, player: res.player, ambiguous: res.ambiguous, posOk: !l.pos || allowed.has(l.pos) };
  });
  const box = $('#paste-preview');
  box.replaceChildren(el('ol', {}, pasteRows.map((r, i) => {
    const locked = app.game.locked[i];
    return el('li', { class: locked ? 'skip' : r.player ? (r.ambiguous ? 'warn' : 'good') : 'bad' },
      locked ? `Locked — kept` : r.player ? `${r.player.name} (${careerLabel(r.player)})` : `“${r.name}” not found`,
      !locked && r.pos ? ` · ${r.pos}${r.posOk ? '' : ' (not used in this league)'}` : '',
      !locked && !r.pos ? ' · no position' : '',
      !locked && r.ambiguous ? ' · check: several players share this name' : '');
  })));
  if (lines.length && lines.length !== ROWS) box.append(el('p', { class: 'small', text: `${lines.length} of 9 lines.` }));
  $('#paste-apply').disabled = !lines.length;
}

function applyPaste() {
  const entries = pasteRows.map((r) => ({
    pid: r.player ? r.player.id : null,
    text: r.player ? r.player.name : r.name,
    pos: r.posOk ? r.pos : '',
  }));
  update(G.fillRows(app.game, entries));
  app.invalid.clear();
  $('#dlg-paste').close();
  $('#paste-text').value = '';
  renderBoard();
  setMsg('Lineup filled. Check the rows, then submit.');
}

// ------------------------------------------------------------------ stats

function openStats() {
  const s = store.loadStats();
  const d = s.daily, p = s.practice;
  const avg = (t) => (t.played ? Math.round(t.totalBest / t.played) : '–');
  const tile = (v, l) => el('div', { class: 'tile' }, el('span', { class: 'tile-v', text: String(v) }), el('span', { class: 'tile-l', text: l }));
  const buckets = [['100', '100'], ['90', '90–99'], ['80', '80–89'], ['70', '70–79'], ['50', '50–69'], ['0', '0–49']];
  const maxN = Math.max(1, ...buckets.map(([k]) => d.dist[k] || 0));
  $('#stats-body').replaceChildren(
    el('h3', { text: 'Daily' }),
    el('div', { class: 'tiles' },
      tile(d.played, 'Played'), tile(d.played ? `${Math.round((100 * d.perfect) / d.played)}%` : '–', 'Perfect'),
      tile(store.currentStreak(s, easternDateKey()), 'Streak'), tile(d.maxStreak, 'Best streak'), tile(avg(d), 'Avg best')),
    el('div', { class: 'dist' }, buckets.map(([k, label]) => el('div', { class: 'dist-row' },
      el('span', { class: 'dist-l', text: label }),
      el('span', { class: 'dist-track' }, el('span', { class: 'dist-fill', style: `width:${(100 * (d.dist[k] || 0)) / maxN}%` })),
      el('span', { class: 'dist-n', text: String(d.dist[k] || 0) })))),
    el('p', { class: 'small', text: 'The streak counts consecutive days you finish the Daily.' }),
    el('h3', { text: 'Practice' }),
    el('div', { class: 'tiles' }, tile(p.played, 'Played'), tile(p.perfect, 'Perfect'), tile(avg(p), 'Avg best')),
  );
  $('#dlg-stats').showModal();
}

boot();
