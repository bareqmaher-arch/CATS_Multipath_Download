"""Why does MP-H2 (mph2-eq) do worse on the testbed than on the simulator?

Two candidates, each switched off in a diagnostic variant run on the testbed with the same seeds
and cells (results/real/diag/diag.csv):
  mph2-eq-basedelay  Equation 1 and pipelining timed by the base RTT, not the PING-measured
                     response delay (which queues lengthen on the testbed; the simulator has none)
  mph2-eq-coarse     sub-ranges five times longer: fewer HTTP/2 requests standing in for MP-H2's
                     flow-control window updates (an artefact of this implementation)
Compared with mph2-eq from the same run, and with the simulator's prediction.

Writes results/real/diag/diag.md.

Usage: python analysis/diag.py
"""

import pandas as pd

from analyze import ROOT, fmt_p, md_table
from round2 import cell, change_table

BASE = ROOT / "results" / "real"
KEYS = ["scenario", "rttFactor", "sizeMB"]


def main() -> None:
    d = pd.read_csv(BASE / "diag" / "diag.csv")
    twin = pd.read_csv(BASE / "sim-twin.csv")
    twin_cells = twin[twin.algorithm == "mph2-eq"].groupby(KEYS).completionS.median().rename("simulated mph2-eq s")
    times = d.groupby(KEYS + ["algorithm"]).completionS.median().unstack()
    times = times.join(twin_cells, how="left").reset_index()

    rows = None
    for variant in ["mph2-eq-basedelay", "mph2-eq-coarse"]:
        t = change_table(d, KEYS, variant, "mph2-eq")
        if rows is None:
            rows = t[KEYS].copy()
        rows[f"{variant} vs mph2-eq %"] = t.apply(cell, axis=1)
        rows[f"{variant}: p (Holm)"] = t.p_holm.map(fmt_p)

    lines = [
        "# Why MP-H2 is slower on the testbed than on the simulator", "",
        "Same seeds and cells as the main testbed run. Negative means the variant is faster than",
        "mph2-eq as implemented. A variant that closes the gap to the simulator names the cause.", "",
        "## Median completion times (s)", "", md_table(times, "{:.2f}"), "",
        "## Variants against mph2-eq", "", md_table(rows), "",
    ]
    (BASE / "diag" / "diag.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
