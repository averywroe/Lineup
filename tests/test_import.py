"""Unit tests for the import's lineup-counting rules (synthetic Retrosheet game logs).

Run: python3 -I -m unittest discover -s tests -p 'test_import.py'
(No third-party packages needed; only the pure functions are exercised.)
"""
import csv
import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("import_data", ROOT / "scripts" / "import_data.py")
imp = importlib.util.module_from_spec(spec)
sys.modules["import_data"] = imp
spec.loader.exec_module(imp)


def game(date, vis, vlg, home, hlg, vis_lineup, home_lineup, vis_sp, home_sp, num="0"):
    row = [""] * 161
    row[0], row[1], row[3], row[4], row[6], row[7] = date, num, vis, vlg, home, hlg
    row[101], row[103] = vis_sp, home_sp
    for start, lineup in ((105, vis_lineup), (132, home_lineup)):
        for i, (pid, pos) in enumerate(lineup):
            row[start + 3 * i], row[start + 3 * i + 1], row[start + 3 * i + 2] = pid, pid, str(pos)
    return row


def nl(pitcher, slot=8, tag="n"):
    hitters = [(f"{tag}{i}", pos) for i, pos in enumerate([8, 6, 9, 3, 7, 5, 4, 2])]
    hitters.insert(slot, (pitcher, 1))
    return hitters


def al(tag="a", swap=False):
    lineup = [(f"{tag}{i}", pos) for i, pos in enumerate([8, 6, 10, 3, 7, 5, 4, 2, 9])]
    if swap:
        lineup[0], lineup[1] = lineup[1], lineup[0]
    return lineup


class ImportRules(unittest.TestCase):
    def build(self, rows):
        with tempfile.NamedTemporaryFile("w", suffix=".TXT", delete=False, newline="") as f:
            csv.writer(f, quoting=csv.QUOTE_ALL).writerows(rows)
        return imp.build_retro_season(2007, Path(f.name))

    def test_window_is_inclusive(self):
        self.assertEqual(imp.nearby_years(2006), [2003, 2004, 2005, 2007, 2008, 2009])
        self.assertIn(2013, imp.nearby_years(2010))
        self.assertNotIn(2014, imp.nearby_years(2010))
        self.assertNotIn(2002, imp.nearby_years(2006))

    def test_nl_groups_lineups_differing_only_by_pitcher(self):
        rows = [
            game("20070401", "AAA", "NL", "NLX", "NL", nl("p1"), nl("q1", tag="x"), "p1", "q1"),
            game("20070402", "AAA", "NL", "NLX", "NL", nl("p2"), nl("q1", tag="x"), "p2", "q1"),
            game("20070403", "AAA", "NL", "NLX", "NL", nl("p3"), nl("q1", tag="x"), "p3", "q1"),
            # A different 8 with the same pitcher appears twice: must lose 3-2
            game("20070404", "AAA", "NL", "NLX", "NL", nl("p1", tag="m"), nl("q1", tag="x"), "p1", "q1"),
            game("20070405", "AAA", "NL", "NLX", "NL", nl("p1", tag="m"), nl("q1", tag="x"), "p1", "q1"),
        ]
        t = self.build(rows)["AAA"]
        key, grp = imp.pick_reference(t["groups"])
        self.assertEqual(grp["count"], 3)
        self.assertEqual(key[8], ("P", 1))
        self.assertEqual(key[0], ("n0", 8))

    def test_nl_keeps_actual_pitcher_slot(self):
        rows = [game(f"200704{d:02d}", "STL", "NL", "NLX", "NL", nl(f"p{d}", slot=7), nl("q", tag="x"), f"p{d}", "q")
                for d in range(1, 4)]
        rows.append(game("20070410", "STL", "NL", "NLX", "NL", nl("p1", slot=8), nl("q", tag="x"), "p1", "q"))
        key, grp = imp.pick_reference(self.build(rows)["STL"]["groups"])
        self.assertEqual(grp["count"], 3)
        self.assertEqual(key[7], ("P", 1))

    def test_nl_excludes_dh_games_and_al_excludes_non_dh_games(self):
        rows = [
            # NL team AAA plays at an AL park with a DH: excluded for AAA
            game("20070601", "AAA", "NL", "ALX", "AL", al("d"), al("h"), "p1", "z"),
            game("20070602", "AAA", "NL", "ALX", "AL", al("d"), al("h"), "p1", "z"),
            game("20070603", "AAA", "NL", "NLX", "NL", nl("p1"), nl("q", tag="x"), "p1", "q"),
            # AL team ALX at an NL park with no DH: excluded for ALX
            game("20070604", "ALX", "AL", "NLY", "NL", nl("r", tag="w"), nl("s", tag="y"), "r", "s"),
        ]
        teams = self.build(rows)
        self.assertEqual(teams["AAA"]["eligible"], 1)
        self.assertEqual(teams["AAA"]["games"], 3)
        self.assertEqual(teams["ALX"]["eligible"], 2)
        self.assertTrue(all(pos != 1 for _, pos in imp.pick_reference(teams["ALX"]["groups"])[0]))

    def test_ties_go_to_the_earliest_lineup(self):
        rows = [
            game("20070501", "ALX", "AL", "ALY", "AL", al(swap=True), al("h"), "s", "t"),
            game("20070502", "ALX", "AL", "ALY", "AL", al(), al("h"), "s", "t"),
            game("20070503", "ALX", "AL", "ALY", "AL", al(), al("h"), "s", "t"),
            game("20070504", "ALX", "AL", "ALY", "AL", al(swap=True), al("h"), "s", "t"),
        ]
        key, grp = imp.pick_reference(self.build(rows)["ALX"]["groups"])
        self.assertEqual(grp["count"], 2)
        self.assertEqual(grp["first"][0], "20070501")
        self.assertEqual(key[0], ("a1", 6))

    def test_reference_is_most_frequent_exact_combination(self):
        # Whole nine-man combinations are counted, never assembled from per-player modes.
        rows = [game(f"200708{d:02d}", "ALX", "AL", "ALY", "AL", lu, al("h"), "s", "t") for d, lu in enumerate([
            al(swap=True), al(swap=True), al("b"), al("b"), al("b"),
        ], start=1)]
        key, grp = imp.pick_reference(self.build(rows)["ALX"]["groups"])
        self.assertEqual(grp["count"], 3)
        self.assertEqual(key[0], ("b0", 8))

    def test_starts_count_lineup_and_starting_pitcher(self):
        rows = [game("20070701", "ALX", "AL", "ALY", "AL", al(), al("h"), "sp1", "t")]
        t = self.build(rows)["ALX"]
        self.assertEqual(t["starts"]["sp1"], 1)
        self.assertEqual(t["starts"]["a0"], 1)


if __name__ == "__main__":
    unittest.main()
