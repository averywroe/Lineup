#!/usr/bin/env python3
"""
Lineup Nine data import.

Builds the static data files the app reads:

  app/data/puzzles.json   150 team-seasons (2006-2010): answer lineups, accepted
                          pitchers, same-season rosters, +/-3-season franchise history
  app/data/players.json   every MLB player in the Lahman database (autocomplete)
  app/data/manifest.json  sources, file checksums, counts, and any data gaps

Sources
  * Retrosheet game logs (GL2006-GL2010), via the Chadwick Bureau mirror of
    Retrosheet on GitHub (falls back to retrosheet.org zips).
  * Lahman Baseball Database (2025 edition), via the Lahman R package source
    (People, Appearances, Teams tables stored as .RData), or a local folder of
    Lahman CSV files passed with --lahman-csv.

Usage
  python3 -m venv .venv && .venv/bin/pip install -r scripts/requirements.txt
  .venv/bin/python scripts/import_data.py            # downloads into data/raw/
  .venv/bin/python scripts/import_data.py --offline  # reuse data/raw/ only
  .venv/bin/python scripts/import_data.py --lahman-csv path/to/lahman/csv

The script never invents data: any Retrosheet player that cannot be mapped to
a Lahman ID, or any team-season that cannot be built, is reported in
manifest.json under "gaps" and the script exits non-zero.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import io
import json
import sys
import urllib.request
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "app" / "data"

PUZZLE_YEARS = range(2006, 2011)          # 2006-2010 inclusive
HISTORY_YEARS = range(2003, 2014)         # 2003-2013 inclusive (+/-3 window)
WINDOW = 3                                # nearby-season window, inclusive
MIN_PITCHER_STARTS = 5                    # NL: any SP with >= 5 starts is accepted
MIN_SECONDARY_GAMES = 5                   # documented secondary position threshold

RETRO_URLS = [
    "https://raw.githubusercontent.com/chadwickbureau/retrosheet/master/seasons/{y}/GL{y}.TXT",
    "https://www.retrosheet.org/gamelogs/gl{y}.zip",
]
LAHMAN_RDATA_URL = "https://raw.githubusercontent.com/cdalzell/Lahman/master/data/{t}.RData"
LAHMAN_TABLES = ["People", "Appearances", "Teams"]

POS_CODES = {1: "P", 2: "C", 3: "1B", 4: "2B", 5: "3B", 6: "SS", 7: "LF", 8: "CF", 9: "RF", 10: "DH"}
LAHMAN_POS_COLS = [("P", "G_p"), ("C", "G_c"), ("1B", "G_1b"), ("2B", "G_2b"), ("3B", "G_3b"),
                   ("SS", "G_ss"), ("LF", "G_lf"), ("CF", "G_cf"), ("RF", "G_rf"), ("DH", "G_dh")]


# --------------------------------------------------------------------------- download helpers

def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "lineup-nine-import/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def get_gamelog(year: int, offline: bool, sources: dict) -> Path:
    dest = RAW / f"GL{year}.TXT"
    if dest.exists():
        sources[dest.name] = RETRO_URLS[0].format(y=year)
        return dest
    if offline:
        raise SystemExit(f"--offline given but {dest} is missing")
    errors = []
    for tmpl in RETRO_URLS:
        url = tmpl.format(y=year)
        try:
            data = fetch(url)
            if url.endswith(".zip"):
                with zipfile.ZipFile(io.BytesIO(data)) as z:
                    name = next(n for n in z.namelist() if n.upper() == f"GL{year}.TXT")
                    data = z.read(name)
            dest.write_bytes(data)
            sources[dest.name] = url
            return dest
        except Exception as e:  # noqa: BLE001 - report every failed mirror
            errors.append(f"{url}: {e}")
    raise SystemExit(f"Could not download Retrosheet game log {year}:\n  " + "\n  ".join(errors))


def load_lahman(args, sources: dict) -> dict:
    """Return {table: list[dict]} for People, Appearances, Teams."""
    tables = {}
    if args.lahman_csv:
        base = Path(args.lahman_csv)
        for t in LAHMAN_TABLES:
            p = base / f"{t}.csv"
            with p.open(newline="", encoding="utf-8-sig") as f:
                tables[t] = list(csv.DictReader(f))
            sources[p.name] = str(p)
        return tables

    try:
        import rdata  # type: ignore
    except ImportError:
        raise SystemExit("The 'rdata' package is required (pip install -r scripts/requirements.txt), "
                         "or pass --lahman-csv with People.csv, Appearances.csv and Teams.csv")
    import warnings
    warnings.filterwarnings("ignore")
    for t in LAHMAN_TABLES:
        dest = RAW / f"{t}.RData"
        if not dest.exists():
            if args.offline:
                raise SystemExit(f"--offline given but {dest} is missing")
            url = LAHMAN_RDATA_URL.format(t=t)
            dest.write_bytes(fetch(url))
        sources[dest.name] = LAHMAN_RDATA_URL.format(t=t)
        frame = rdata.read_rda(str(dest))[t]
        frame = frame.astype(object).where(frame.notna(), None)
        cols = [str(c) for c in frame.columns]
        tables[t] = [dict(zip(cols, row)) for row in frame.itertuples(index=False, name=None)]
    return tables


def as_int(v) -> int:
    if v is None or v == "":
        return 0
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return 0


def as_str(v) -> str:
    return "" if v is None else str(v).strip()


# --------------------------------------------------------------------------- Retrosheet parsing

def parse_gamelog(path: Path):
    """Yield one dict per game with both teams' starting lineups."""
    with path.open(newline="", encoding="latin-1") as f:
        for row in csv.reader(f):
            if len(row) < 159:
                continue
            g = {
                "date": row[0], "num": row[1],
                "vis": row[3], "vis_lg": row[4], "home": row[6], "home_lg": row[7],
                "vis_sp": row[101], "home_sp": row[103],
            }
            for side, start in (("vis", 105), ("home", 132)):
                g[side + "_lineup"] = [(row[start + 3 * i], int(row[start + 3 * i + 2])) for i in range(9)]
            yield g


def build_retro_season(year: int, path: Path):
    """Per team: lineup counts, pitcher starts, player starts, eligible game counts."""
    teams = defaultdict(lambda: {
        "league": None, "games": 0, "eligible": 0, "groups": {}, "sp": Counter(),
        "starts": Counter(), "names": {},
    })
    for order, g in enumerate(parse_gamelog(path)):
        for side, opp in (("vis", "home"), ("home", "vis")):
            code = g[side]
            t = teams[code]
            t["league"] = g[side + "_lg"]
            t["games"] += 1
            lineup = g[side + "_lineup"]
            sp = g[side + "_sp"]
            t["sp"][sp] += 1
            starters = {pid for pid, _ in lineup} | {sp}
            for pid in starters:
                t["starts"][pid] += 1
            dh_used = any(pos == 10 for _, pos in lineup)
            if t["league"] == "AL" and not dh_used:
                continue            # AL puzzles use DH lineups only
            if t["league"] == "NL" and dh_used:
                continue            # NL puzzles exclude games under the AL DH convention
            t["eligible"] += 1
            if t["league"] == "NL":
                key = tuple(("P" if pos == 1 else pid, pos) for pid, pos in lineup)
            else:
                key = tuple(lineup)
            grp = t["groups"].get(key)
            if grp is None:
                grp = t["groups"][key] = {
                    "count": 0, "first": (g["date"], g["num"], order),
                    "opp": g[opp], "home": side == "home", "pitchers": Counter(), "pitcher_first": {},
                }
            grp["count"] += 1
            if t["league"] == "NL":
                ppid = next(pid for pid, pos in lineup if pos == 1)
                grp["pitchers"][ppid] += 1
                grp["pitcher_first"].setdefault(ppid, order)
    return teams


def nearby_years(year: int, window: int = WINDOW) -> list[int]:
    """Seasons that count as 'nearby' for a target year: year-window .. year+window inclusive, minus the year."""
    return [y for y in range(year - window, year + window + 1) if y != year]


def pick_reference(groups: dict):
    """Most frequent lineup; ties broken by earliest appearance."""
    return min(groups.items(), key=lambda kv: (-kv[1]["count"], kv[1]["first"][2]))


# --------------------------------------------------------------------------- main build

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--offline", action="store_true", help="use files already in data/raw/")
    ap.add_argument("--lahman-csv", help="folder with Lahman People.csv, Appearances.csv, Teams.csv")
    args = ap.parse_args()

    RAW.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    sources: dict = {}
    gaps: list[str] = []

    lahman = load_lahman(args, sources)
    people = {as_str(p["playerID"]): p for p in lahman["People"]}
    retro_to_lahman = {as_str(p["retroID"]): pid for pid, p in people.items() if as_str(p["retroID"])}

    # Teams: (year, retro code) -> team row; (year, lahman teamID) -> franchise
    team_by_retro = {}
    franch_of = {}
    for t in lahman["Teams"]:
        y = as_int(t["yearID"])
        franch_of[(y, as_str(t["teamID"]))] = as_str(t["franchID"])
        team_by_retro[(y, as_str(t["teamIDretro"]))] = t

    # Appearances
    app_rows = lahman["Appearances"]
    career_pos = defaultdict(Counter)
    career_years = defaultdict(set)
    career_games = Counter()
    season = defaultdict(lambda: defaultdict(Counter))  # (year, franch) -> pid -> pos games
    for a in app_rows:
        pid = as_str(a["playerID"])
        y = as_int(a["yearID"])
        career_years[pid].add(y)
        career_games[pid] += as_int(a.get("G_all"))
        for pos, col in LAHMAN_POS_COLS:
            n = as_int(a.get(col))
            if n:
                career_pos[pid][pos] += n
        if y in HISTORY_YEARS:
            fr = franch_of.get((y, as_str(a["teamID"])))
            if fr is None:
                gaps.append(f"Appearances {y} {a['teamID']}: team not in Teams table")
                continue
            c = season[(y, fr)][pid]
            c["_G"] += as_int(a.get("G_all"))
            for pos, col in LAHMAN_POS_COLS:
                n = as_int(a.get(col))
                if n:
                    c[pos] += n

    def primary(counter: Counter) -> str:
        best = [(n, pos) for pos, n in counter.items() if not pos.startswith("_") and n > 0]
        if not best:
            return ""
        # most games; ties resolved by the defensive-spectrum order of LAHMAN_POS_COLS
        order = {p: i for i, (p, _) in enumerate(LAHMAN_POS_COLS)}
        return min(best, key=lambda t: (-t[0], order[t[1]]))[1]

    # ---------------------------------------------------------------- puzzles
    puzzles = []
    referenced = set()
    for year in PUZZLE_YEARS:
        path = get_gamelog(year, args.offline, sources)
        teams = build_retro_season(year, path)
        if len(teams) != 30:
            gaps.append(f"{year}: expected 30 teams in game log, found {len(teams)}")
        for code in sorted(teams):
            t = teams[code]
            trow = team_by_retro.get((year, code))
            if trow is None:
                gaps.append(f"{year} {code}: no Lahman Teams row with teamIDretro={code}")
                continue
            franch = as_str(trow["franchID"])
            league = t["league"]
            if not t["groups"]:
                gaps.append(f"{year} {code}: no eligible games")
                continue

            def lid(retro_id: str) -> str | None:
                pid = retro_to_lahman.get(retro_id)
                if pid is None:
                    gaps.append(f"{year} {code}: Retrosheet ID {retro_id} has no Lahman retroID match")
                return pid

            key, grp = pick_reference(t["groups"])
            lineup = []
            pitcher_slot = None
            rep_pitcher = None
            for slot, (rid, pos) in enumerate(key):
                if rid == "P":
                    pitcher_slot = slot
                    rep_rid = min(grp["pitchers"].items(),
                                  key=lambda kv: (-kv[1], grp["pitcher_first"][kv[0]]))[0]
                    rep_pitcher = lid(rep_rid)
                    lineup.append([rep_pitcher, "P"])
                else:
                    lineup.append([lid(rid), POS_CODES[pos]])

            accepted = []
            if league == "NL":
                for rid, n in t["sp"].most_common():
                    if n >= MIN_PITCHER_STARTS or lid(rid) == rep_pitcher:
                        pid = lid(rid)
                        if pid:
                            accepted.append([pid, n])
                if rep_pitcher and rep_pitcher not in {p for p, _ in accepted}:
                    accepted.append([rep_pitcher, t["sp"].get(people[rep_pitcher]["retroID"], 0)])

            # same-season roster (Lahman) with Retrosheet start counts
            starts = {}
            for rid, n in t["starts"].items():
                pid = lid(rid)
                if pid:
                    starts[pid] = n
            roster = {}
            for pid, c in season[(year, franch)].items():
                secondary = [pos for pos, _ in LAHMAN_POS_COLS if c.get(pos, 0) >= MIN_SECONDARY_GAMES]
                roster[pid] = [starts.get(pid, 0), primary(c), secondary]
            for pid in starts:
                if pid not in roster:
                    gaps.append(f"{year} {code}: starter {pid} missing from Lahman Appearances")

            # nearby seasons: same franchise, target-3..target+3 inclusive, not on target-year roster
            near_counts = defaultdict(Counter)
            near_years = defaultdict(set)
            for y in nearby_years(year):
                if y not in HISTORY_YEARS:
                    gaps.append(f"{year} {code}: history year {y} outside imported range")
                for pid, c in season[(y, franch)].items():
                    if pid in roster:
                        continue
                    near_counts[pid].update(c)
                    near_years[pid].add(y)
            nearby = {pid: [primary(c), sorted(near_years[pid])] for pid, c in near_counts.items()}

            for pid, _ in lineup:
                if pid is not None and pid not in roster:
                    gaps.append(f"{year} {code}: reference player {pid} not on Lahman roster")
            if any(pid is None for pid, _ in lineup):
                continue

            d = grp["first"][0]
            puzzles.append({
                "id": f"{year}-{code}",
                "year": year,
                "code": code,
                "abbr": as_str(trow["teamIDBR"]),
                "franch": franch,
                "name": as_str(trow["name"]),
                "league": league,
                "w": as_int(trow["W"]), "l": as_int(trow["L"]),
                "lineup": lineup,
                "pitcherSlot": pitcher_slot,
                "pitchers": accepted,
                "freq": grp["count"],
                "eligible": t["eligible"],
                "games": t["games"],
                "distinct": len(t["groups"]),
                "example": {"date": f"{d[:4]}-{d[4:6]}-{d[6:]}", "game": int(grp["first"][1] or 0),
                            "opp": grp["opp"], "home": grp["home"]},
                "roster": roster,
                "nearby": nearby,
            })
            referenced.update(roster)
            referenced.update(nearby)

    # ---------------------------------------------------------------- players
    players = []
    for pid, p in people.items():
        years = career_years.get(pid)
        if not years:
            continue  # never appeared in an MLB game (Lahman Appearances)
        players.append([pid, as_str(p["nameFirst"]), as_str(p["nameLast"]),
                        min(years), max(years), primary(career_pos[pid]), career_games[pid]])
    players.sort(key=lambda r: (r[2].lower(), r[1].lower(), r[3]))
    known = {r[0] for r in players}
    for pid in referenced - known:
        gaps.append(f"player {pid} referenced by a puzzle but missing from People/Appearances")

    # retro code -> opponent display abbreviation
    abbr = {f"{z['year']}-{z['code']}": z["abbr"] for z in puzzles}
    for z in puzzles:
        z["example"]["oppAbbr"] = abbr.get(f"{z['year']}-{z['example']['opp']}", z["example"]["opp"])

    (OUT / "puzzles.json").write_text(json.dumps(puzzles, separators=(",", ":"), ensure_ascii=False))
    (OUT / "players.json").write_text(json.dumps(
        {"cols": ["id", "first", "last", "from", "to", "pos", "g"], "rows": players},
        separators=(",", ":"), ensure_ascii=False))

    files = {}
    for f in sorted(RAW.iterdir()):
        if f.name in sources or f.suffix in (".TXT", ".RData"):
            files[f.name] = {"source": sources.get(f.name, "local"), "sha256": sha256(f)}
    manifest = {
        "generated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "puzzles": len(puzzles),
        "players": len(players),
        "rules": {
            "puzzleYears": [PUZZLE_YEARS.start, PUZZLE_YEARS.stop - 1],
            "historyYears": [HISTORY_YEARS.start, HISTORY_YEARS.stop - 1],
            "nearbyWindow": WINDOW,
            "minPitcherStarts": MIN_PITCHER_STARTS,
            "minSecondaryGames": MIN_SECONDARY_GAMES,
        },
        "sources": {
            "retrosheet": "Retrosheet regular-season game logs (via the Chadwick Bureau mirror). "
                          "The information used here was obtained free of charge from and is copyrighted "
                          "by Retrosheet. Interested parties may contact Retrosheet at www.retrosheet.org.",
            "lahman": "Sean Lahman Baseball Database, 2025 edition (SABR), via the Lahman R package "
                      "(github.com/cdalzell/Lahman). Licensed CC BY-SA 3.0.",
        },
        "files": files,
        "gaps": sorted(set(gaps)),
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2))

    print(f"puzzles: {len(puzzles)}  players: {len(players)}  gaps: {len(manifest['gaps'])}")
    for g in manifest["gaps"][:50]:
        print("  GAP:", g)
    if len(puzzles) != 150 or manifest["gaps"]:
        print("Import incomplete - see manifest.json 'gaps'.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
