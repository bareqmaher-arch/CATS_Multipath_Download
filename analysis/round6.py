"""cats6 (cats5 with its next block pipelined, src/cats6.ts) on held-out seeds 10001-10100,
against cats5 and every baseline.

Reads results/e-{slowstart,fluid}-{0..4}/; writes results/round6.md.

Usage: python analysis/round6.py
"""

import pandas as pd

from analyze import ROOT, md_table
from newbase import RIVALS, comparison, load, scoreboard, strongest

BASE = ROOT / "results"
FOCAL = "cats6"
EVERYONE = ["cats5"] + RIVALS


def main() -> None:
    fluid = load("fluid", "main.csv", "e", 5)
    slow = load("slowstart", "main.csv", "e", 5)
    rtt = load("slowstart", "rtt_sensitivity.csv", "e", 5)
    main_keys = ["scenario", "sizeMB"]
    rtt_keys = ["scenario", "rttFactor", "sizeMB"]
    board = scoreboard({"fluid": (fluid, main_keys), "slow start": (slow, main_keys),
                        "RTT scaled, slow start": (rtt, rtt_keys)}, FOCAL, EVERYONE)
    g = slow.groupby(["sizeMB", "algorithm"])
    costs = pd.DataFrame({"requests": g.requests.mean(), "wasted MB": g.wastedMB.mean(),
                          "tail s": g.tailS.median()}).reset_index()
    costs = costs[costs.algorithm.isin(["cats5", "cats6", "rb-eq", "twoway-eq", "mph2-eq"])]
    lines = [
        "# Round 6: cats6 on held-out seeds (simulator)",
        "",
        "cats6 = cats5 with its next block asked for one response delay before the current one",
        "ends (src/cats6.ts). Developed on seeds 9001-9030; judged here on seeds 10001-10100,",
        "never used before, against cats5 and every baseline.",
        "",
        "## Scoreboard: cats6 against each", "",
        "Holm-corrected Wilcoxon per sweep; negative is cats6 faster.", "",
        md_table(board, "{:.1f}"), "",
        "## cats6 against cats5 and the strongest rivals (slow start)", "",
        md_table(comparison(slow, main_keys, ["cats5", "rb-eq", "twoway-eq", "mph2-eq", "plexo"], FOCAL)), "",
        "## Every RTT scaled up", "",
        md_table(comparison(rtt, rtt_keys, ["cats5", "rb-eq", "twoway-eq", "mph2-eq", "plexo"], FOCAL)), "",
        "## cats6 against the strongest baseline in each cell (slow start)", "",
        md_table(strongest(slow, main_keys, FOCAL, RIVALS)), "",
        "## Requests, waste and tail (slow start)", "",
        md_table(costs, "{:.2f}"), "",
    ]
    (BASE / "round6.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
