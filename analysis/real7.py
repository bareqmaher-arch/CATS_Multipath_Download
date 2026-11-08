"""cats7 on the real testbed, new seeds 6101-6130 and the cells of results/real/real.md, against
cats6, cats5 and the strongest rivals, all in one batch, interleaved seed by seed.

Reads results/real/r7-*.csv and results/real/sim-twin-r7.csv; writes results/real/real7.md and
fig21.

Usage: python analysis/real7.py
"""

import numpy as np
import pandas as pd
from scipy.stats import spearmanr

from analyze import INK, ROOT, fmt_p, md_table, plt
from real import KEYS, pair, seed_agreement
from round2 import cell

BASE = ROOT / "results" / "real"
FOCAL = "cats7"
RIVALS = ["cats6", "cats5", "rb-eq", "twoway-eq", "mph2-eq", "plexo"]


def scoreboard(df: pd.DataFrame) -> tuple[list[str], dict[str, pd.DataFrame]]:
    rows, cells, tables = [], None, {}
    for rival in RIVALS:
        t = pair(df, FOCAL, rival)
        tables[rival] = t
        sig = t.p_holm < 0.05
        rows.append({"cats7 against": rival, "cells": len(t),
                     "seeds per cell": f"{t.seeds.min()}-{t.seeds.max()}",
                     "faster (sig.)": int((sig & (t["median"] < 0)).sum()),
                     "slower (sig.)": int((sig & (t["median"] > 0)).sum()),
                     "no clear difference": int((~sig | (t["median"] == 0)).sum()),
                     "median of medians %": round(float(t["median"].median()), 1),
                     "best %": round(float(t["median"].min()), 1),
                     "worst %": round(float(t["median"].max()), 1)})
        t = t.set_index(KEYS)
        if cells is None:
            cells = pd.DataFrame(index=t.index)
        cells[f"vs {rival} %"] = t.apply(cell, axis=1) + t.p_holm.map(lambda p: "" if p < 0.05 else " ns")
    lines = ["## Scoreboard", "", "Holm-corrected Wilcoxon over the 12 cells; negative is cats7 faster.", "",
             md_table(pd.DataFrame(rows), "{:.1f}"), "",
             "## Per cell, median [95% CI]; ns = not significant (Holm)", "",
             md_table(cells.reset_index()), ""]
    return lines, tables


def agreement(df: pd.DataFrame, twin: pd.DataFrame, tables: dict[str, pd.DataFrame]) -> list[str]:
    lines = ["## Did the simulator predict the testbed?", ""]
    for rival in RIVALS:
        s = pair(twin[twin.seed.isin(df.seed.unique())], FOCAL, rival)
        m = tables[rival].merge(s, on=KEYS, suffixes=("_real", "_sim"))
        if m.median_sim.nunique() > 1:
            rho, p = spearmanr(m.median_sim, m.median_real)
            across = f"across cells Spearman {rho:.2f} (p = {fmt_p(p)})"
        else:
            across = "the simulator predicts one change in every cell"
        lines.append(f"- cats7 vs {rival}: {across}; seed by seed "
                     f"{seed_agreement(df, twin, FOCAL, rival)}; median predicted "
                     f"{m.median_sim.median():+.1f}%, measured {m.median_real.median():+.1f}%.")
    return lines + [""]


def fig(tables: dict[str, pd.DataFrame]) -> None:
    first = tables[RIVALS[0]]
    labels = [f"{s.split('-')[0]} {z} MB" + (f" RTTx{f}" if f != 1 else "")
              for s, f, z in first[KEYS].itertuples(index=False)]
    x = np.arange(len(labels))
    width = 0.13
    colors = plt.cm.tab10(np.arange(len(RIVALS)))
    fig_, ax = plt.subplots(figsize=(15, 4.8))
    for i, rival in enumerate(RIVALS):
        t = tables[rival]
        y = t["median"].to_numpy()
        ax.bar(x + (i - 2.5) * width, y, width, color=colors[i], label=f"vs {rival}",
               yerr=np.vstack([y - t.low.to_numpy(), t.high.to_numpy() - y]),
               error_kw={"ecolor": INK, "elinewidth": 0.5, "capsize": 1})
    ax.axhline(0, color=INK, linewidth=0.8)
    ax.set_xticks(x, labels, fontsize=7)
    ax.set_ylabel("cats7 completion time change (%)\nmedian, 95% CI; below 0 = cats7 faster")
    ax.set_title("Real TCP testbed, seeds 6101-6130: cats7 against its predecessors and the strongest rivals")
    ax.set_yscale("symlog", linthresh=10)
    ticks = [-40, -20, -10, -5, 0, 5, 10, 20]
    ax.set_yticks(ticks, [f"{t:+d}%" if t else "0" for t in ticks])
    ax.minorticks_off()
    ax.legend(frameon=False, ncols=6, fontsize=7)
    fig_.savefig(BASE / "fig21_real_cats7.png", dpi=150)
    plt.close(fig_)


def main() -> None:
    df = pd.concat([pd.read_csv(p) for p in sorted(BASE.glob("r7-*.csv"))], ignore_index=True)
    twin = pd.read_csv(BASE / "sim-twin-r7.csv")
    lines = ["# cats7 on the real testbed", "",
             "Seeds 6101-6130, never used before; same cells as results/real/real.md; every",
             "algorithm in one batch, interleaved seed by seed.", "",
             "## Testbed health", "",
             f"- runs: {len(df)}; timed out: {int(df.timedOut.sum())}; shaper errors: {int(df.shaperErrors.sum())}",
             f"- engine tick: mean {df.meanTickMs.mean():.2f} ms, max {df.meanTickMs.max():.2f} ms (target 10)", ""]
    board, tables = scoreboard(df)
    lines += board
    med = df.groupby(KEYS + ["algorithm"]).completionS.median().unstack()
    lines += ["## Median completion time (s)", "", md_table(med.reset_index(), "{:.2f}"), ""]
    lines += agreement(df, twin, tables)
    g = df.groupby(["sizeMB", "algorithm"])
    lines += ["## Requests and bytes per download", "",
              md_table(pd.DataFrame({"requests": g.requests.mean(), "received MB": g.ifaceMB.mean(),
                                     "splits": g.splits.mean(), "copies": g.hedges.mean()}).reset_index(), "{:.1f}"), ""]
    (BASE / "real7.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    fig(tables)
    print("\n".join(lines))


if __name__ == "__main__":
    main()
