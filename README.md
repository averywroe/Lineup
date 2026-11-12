# Lineup Nine

Wordle for baseball lineups. You get an MLB team and a season from 2006–2010 and have three
attempts to rebuild its **most-used starting lineup**: players, positions and batting order.

- **Daily**: one puzzle for everyone, changing at midnight US Eastern. Each 150-day cycle covers every team-season once.
- **Practice**: any of the 150 team-seasons, picked by team and year or at random.
- Progress, stats and daily streaks are saved in `localStorage`, so refreshing keeps your game.

## Run it locally

The app is static files in `app/`, and the data is already built in `app/data/`. Any static server works:

```sh
npm start                    # node scripts/serve.mjs  → http://localhost:8000 (no npm install needed)
# or
cd app && python3 -m http.server 8000
```

Opening `index.html` straight from disk won't work, because browsers block `fetch()` and ES modules on `file://`.
To play on your phone, run the server on your computer and open `http://<your-computer-ip>:8000` on the same Wi-Fi.

## Tests

```sh
npm test            # Node unit tests + Python import-rule tests (no dependencies)
npm run test:e2e    # browser test (needs Playwright: npm i -D playwright && npx playwright install chromium)
```

The tests check that:

- all 150 answer keys pass validation and score exactly 100, including every accepted NL pitcher in the pitcher's slot;
- the ±3-season window is inclusive, using real cases (Robin Ventura, a 2003 Yankee, is "nearby" for 2006 but not 2007; Ichiro, a Yankee from 2012, is "nearby" for 2009 but not 2008);
- locked rows can't be overwritten by edits, moves, swaps, clearing or pasting, even when forced through the DOM;
- refreshing keeps attempts, locks and unsaved draft rows; a finished game stays finished;
- invalid submissions don't use an attempt; the scoring weights and partial credits work; names match regardless of accents and punctuation; the daily rollover follows Eastern time across DST;
- the import counts whole nine-man combinations, breaks ties by earliest appearance, groups NL lineups that differ only by pitcher while keeping the pitcher's batting slot, and excludes games played under the other league's DH rule.

## Data

| What | Source |
| --- | --- |
| Starting lineups, starts, starting pitchers | Retrosheet regular-season game logs 2006–2010 (Chadwick Bureau's GitHub mirror of Retrosheet) |
| Player names, IDs, careers, positions, team history 2003–2013 | Lahman Baseball Database, 2025 edition (the `Lahman` R package source, `People`/`Appearances`/`Teams`) |

Rebuild the data:

```sh
python3 -m venv .venv && .venv/bin/pip install -r scripts/requirements.txt
.venv/bin/python scripts/import_data.py              # downloads into data/raw/, writes app/data/*.json
.venv/bin/python scripts/import_data.py --offline    # rebuild from data/raw/ only
.venv/bin/python scripts/import_data.py --lahman-csv ~/lahman/csv   # use Lahman CSVs instead of .RData
```

`app/data/manifest.json` records each source URL with its SHA-256, the rule settings, and a `gaps` list.
The script never fills in missing data. It reports unmapped IDs or missing team-seasons in `gaps` and exits non-zero.
The current build has 150 puzzles, 24,011 players, and no gaps. A rebuild from fresh downloads produced byte-identical files.
(`retrosheet.org` itself was unreachable from the build machine. The script tries the Chadwick mirror first and falls back to `retrosheet.org`.)

### How an answer key is built

1. For each team-season, read every regular-season game's starting lineup: nine (player, position) pairs in batting order.
2. **AL** teams: keep only games with a DH. **NL** teams: drop games with a DH (interleague games in AL parks).
   NL lineups that differ only by starting pitcher count as one lineup. The pitcher keeps his actual batting slot,
   so the 2008–2010 Cardinals' pitcher bats 8th.
3. The answer is the exact combination that started most often, with ties going to the earliest. It is never pieced together from each player's most common spot.
4. NL pitcher row: any pitcher with 5+ starts for that team that season is accepted.
5. The reveal screen shows how many eligible games used that lineup, how many different lineups the team used, and the first date it was used.

Players are keyed by Lahman `playerID`. Retrosheet IDs are mapped through Lahman's `retroID`, so players with the same name stay separate.
Team history uses Lahman franchise IDs, so the Expos count as the Nationals, the Devil Rays as the Rays, and so on.

## Scoring (100 points)

60 for names, 20 for positions and 20 for batting order, split evenly across the nine rows (6.67 / 2.22 / 2.22 per row).

| Row contains | Name | Position | Order |
| --- | --- | --- | --- |
| A target starter (any slot) | 100% | 100% at his target position, 50% at a documented secondary (5+ games that season) | exact 100%, ±1 75%, ±2 50%, else 0 |
| Same-season roster player, not in the nine | 85% with 35+ starts, else 50% | 50% at his main position that season | – |
| Played for the franchise within ±3 seasons (inclusive), not that season | 75% | 50% at his main position with the team in those seasons | – |
| Anyone else | 0 | 0 | – |

Only a perfect lineup scores 100. Anything else is rounded and capped at 99. A row locks when player, position and slot are all correct.

## Layout

```
app/                 static app (index.html, css/, js/, data/)
  js/scoring.js      scoring + validation (shared with tests)
  js/game.js         game state: lock-safe edits, moves, swaps, submit
  js/search.js       accent/punctuation-insensitive player search
  js/daily.js        Eastern-time daily schedule
  js/paste.js        "Paste lineup" parser
scripts/import_data.py   reproducible data import
scripts/serve.mjs        zero-dependency static server
tests/                   unit, import and end-to-end tests
```

## Attribution

The information used here was obtained free of charge from and is copyrighted by Retrosheet. Interested parties may
contact Retrosheet at [www.retrosheet.org](https://www.retrosheet.org).

Lahman Baseball Database © Sean Lahman, published by SABR under CC BY-SA 3.0. The files derived from it in `app/data/`
are shared under the same license. Not affiliated with Major League Baseball or any team.

## Wedding site

`wedding/` is a separate static site (Avery & Madisyn, October 23, 2027) that shares nothing with the game.
Open `wedding/index.html` directly, or host the folder on any static host. Sections still waiting on
details are marked with `TODO` comments in the HTML; the RSVP form stays hidden until `data-endpoint`
on `#rsvp-form` is set to a form service URL.
