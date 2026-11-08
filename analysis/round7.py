"""cats7 (cats6 with a tail that works for small files, src/cats7.ts) on held-out seeds
11001-11100, against cats6, cats5 and every baseline.

Reads results/f-{slowstart,fluid}-{0..4}/; writes results/round7.md.

Usage: python analysis/round7.py
"""

import pandas as pd

from analyze import ROOT, md_table
from newbase import RIVALS, comparison, load, scoreboard, strongest

BASE = ROOT / "results"
FOCAL = "cats7"
EVERYONE = ["cats6", "cats5"] + RIVALS
CLOSE = ["cats6", "cats5", "rb-eq", "twoway-eq", "mph2-eq", "plexo"]


def main() -> None:
    fluid = load("fluid", "main.csv", "f", 5)
    slow = load("slowstart", "main.csv", "f", 5)
    rtt = load("slowstart", "rtt_sensitivity.csv", "f", 5)
    main_keys = ["scenario", "sizeMB"]
    rtt_keys = ["scenario", "rttFactor", "sizeMB"]
    board = scoreboard({"fluid": (fluid, main_keys), "slow start": (slow, main_keys),
                        "RTT scaled, slow start": (rtt, rtt_keys)}, FOCAL, EVERYONE)
    g = slow.groupby(["sizeMB", "algorithm"])
    costs = pd.DataFrame({"requests": g.requests.mean(), "wasted MB": g.wastedMB.mean(),
                          "splits": g.splits.mean(), "copies": g.hedges.mean()}).reset_index()
    costs = costs[costs.algorithm.isin(["cats5", "cats6", "cats7", "rb-eq", "twoway-eq", "mph2-eq"])]
    lines = [
        "# Round 7: cats7 on held-out seeds (simulator)",
        "",
        "cats7 = cats6 with short sub-ranges once every block is handed out, smaller splits from",
        "healthy holders, and no tail work for a new connection on the holder's own network",
        "(src/cats7.ts). Developed on seeds 9001-9030; judged here on seeds 11001-11100, never",
        "used before, against cats6, cats5 and every baseline.",
        "",
        "## Scoreboard: cats7 against each", "",
        "Holm-corrected Wilcoxon per sweep; negative is cats7 faster.", "",
        md_table(board, "{:.1f}"), "",
        "## cats7 against its predecessors and the strongest rivals (slow start)", "",
        md_table(comparison(slow, main_keys, CLOSE, FOCAL)), "",
        "## Every RTT scaled up", "",
        md_table(comparison(rtt, rtt_keys, CLOSE, FOCAL)), "",
        "## cats7 against the strongest baseline in each cell (slow start)", "",
        md_table(strongest(slow, main_keys, FOCAL, RIVALS)), "",
        "## cats7 against the strongest baseline in each cell (RTT scaled)", "",
        md_table(strongest(rtt, rtt_keys, FOCAL, RIVALS)), "",
        "## Requests, waste, splits and copies (slow start)", "",
        md_table(costs, "{:.2f}"), "",
    ]
    (BASE / "round7.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
