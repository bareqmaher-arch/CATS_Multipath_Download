"""cats5 against the four baselines added after the literature review, on the real testbed.

Seeds 6001-6030 and the cells of the first testbed run (results/real/real.md); cats5 was run
again in the same batch, interleaved with the baselines seed by seed, so every comparison here is
within one batch. The first batch's cats5 against this one's is a check that the testbed repeats.

Reads results/real/new-*.csv, results/real/{real,base}-*.csv (first batch) and
results/real/sim-twin-new.csv; writes results/real/newreal.md and fig20.

Usage: python analysis/newreal.py
"""

import numpy as np
import pandas as pd
from scipy.stats import spearmanr, wilcoxon

from analyze import INK, ROOT, fmt_p, md_table, plt
from real import KEYS, pair, seed_agreement
from round2 import cell

BASE = ROOT / "results" / "real"
NEW = ["fl", "fl-eq", "mdtp", "mdtp-eq", "twoway", "twoway-eq", "rb", "rb-eq"]
OLD = ["plexo", "mph2", "mph2-eq", "plexo-mux3"]


def load(pattern: str) -> pd.DataFrame:
    return pd.concat([pd.read_csv(p) for p in sorted(BASE.glob(pattern))], ignore_index=True)


def health(df: pd.DataFrame) -> list[str]:
    return [
        "## Testbed health", "",
        f"- runs: {len(df)}; timed out: {int(df.timedOut.sum())}; shaper errors: {int(df.shaperErrors.sum())}",
        f"- engine tick: mean {df.meanTickMs.mean():.2f} ms, max {df.meanTickMs.max():.2f} ms (target 10)",
        "",
    ]


def scoreboard(df: pd.DataFrame) -> tuple[list[str], pd.DataFrame]:
    rows, cells = [], None
    for rival in NEW:
        t = pair(df, "cats5", rival)
        sig = t.p_holm < 0.05
        rows.append({
            "cats5 against": rival,
            "cells": len(t),
            "seeds per cell": f"{t.seeds.min()}-{t.seeds.max()}",
            "faster (sig.)": int((sig & (t["median"] < 0)).sum()),
            "slower (sig.)": int((sig & (t["median"] > 0)).sum()),
            "no clear difference": int((~sig | (t["median"] == 0)).sum()),
            "median of medians %": round(float(t["median"].median()), 1),
            "best %": round(float(t["median"].min()), 1),
            "worst %": round(float(t["median"].max()), 1),
        })
        t = t.set_index(KEYS)
        if cells is None:
            cells = pd.DataFrame(index=t.index)
        cells[f"vs {rival} %"] = t.apply(cell, axis=1) + t.p_holm.map(lambda p: "" if p < 0.05 else " ·")
    lines = ["## Scoreboard", "",
             "Holm-corrected Wilcoxon per baseline over the 12 cells; negative is cats5 faster.", "",
             md_table(pd.DataFrame(rows), "{:.1f}"), "",
             "## Per cell: cats5 change against each, median [95% CI]; · = not significant (Holm)", "",
             md_table(cells.reset_index()), ""]
    return lines, cells


def repeat_check(new: pd.DataFrame, old: pd.DataFrame) -> list[str]:
    a = new[new.algorithm == "cats5"].set_index(KEYS + ["seed"]).completionS
    b = old[old.algorithm == "cats5"].set_index(KEYS + ["seed"]).completionS
    joined = pd.concat([a.rename("now"), b.rename("before")], axis=1).dropna()
    rows = []
    for keys, g in joined.groupby(level=list(range(len(KEYS)))):
        change = (g.now / g.before - 1) * 100
        diff = g.now - g.before
        rows.append({**dict(zip(KEYS, keys)), "median s before": g.before.median(),
                     "median s now": g.now.median(), "median change %": np.median(change),
                     "p": wilcoxon(diff).pvalue if np.any(diff != 0) else np.nan})
    t = pd.DataFrame(rows)
    rho, p = spearmanr(joined.now, joined.before)
    return ["## Does the testbed repeat? cats5 in this batch against the first", "",
            f"Same seeds and cells, runs a day apart. Seed by seed Spearman {rho:.2f} "
            f"(p = {fmt_p(p)}, {len(joined)} seed-cells).", "",
            md_table(t, "{:.2f}"), ""]


def everyone(new: pd.DataFrame, old: pd.DataFrame) -> list[str]:
    """Median times of every algorithm on the testbed, both batches (cats5 from this one)."""
    both = pd.concat([new, old[old.algorithm.isin(OLD)]], ignore_index=True)
    med = both.groupby(KEYS + ["algorithm"]).completionS.median().unstack()
    rivals = [c for c in med.columns if c != "cats5"]
    med["strongest baseline"] = med[rivals].idxmin(axis=1)
    med["cats5 vs it, medians %"] = (med.cats5 / med[rivals].min(axis=1) - 1) * 100
    return ["## Every algorithm on the testbed: median completion time (s)", "",
            "Plexo, MP-H2 and plexo-mux3 come from the first batch, the rest from this one, so the",
            "strongest-baseline column compares medians across batches (the check above bounds",
            "how much a batch moves).", "",
            md_table(med.reset_index(), "{:.2f}"), ""]


def agreement(real: pd.DataFrame, twin: pd.DataFrame) -> list[str]:
    lines = ["## Did the simulator predict the testbed?", ""]
    for rival in NEW:
        r = pair(real, "cats5", rival)
        s = pair(twin[twin.seed.isin(real.seed.unique())], "cats5", rival)
        merged = r.merge(s, on=KEYS, suffixes=("_real", "_sim"))
        rho, p = spearmanr(merged.median_sim, merged.median_real)
        lines.append(f"- cats5 vs {rival}: across cells Spearman {rho:.2f} (p = {fmt_p(p)}); "
                     f"seed by seed {seed_agreement(real, twin, 'cats5', rival)}; median predicted "
                     f"{merged.median_sim.median():+.1f}%, measured {merged.median_real.median():+.1f}%.")
    return lines + [""]


def fig(cells_real: pd.DataFrame, real: pd.DataFrame) -> None:
    tables = {r: pair(real, "cats5", r) for r in NEW}
    first = tables[NEW[0]]
    labels = [f"{s.split('-')[0]} {z} MB" + (f" RTTx{f}" if f != 1 else "")
              for s, f, z in first[KEYS].itertuples(index=False)]
    x = np.arange(len(labels))
    width = 0.1
    colors = plt.cm.tab10(np.arange(len(NEW)))
    fig_, ax = plt.subplots(figsize=(15, 4.8))
    for i, rival in enumerate(NEW):
        t = tables[rival]
        y = t["median"].to_numpy()
        ax.bar(x + (i - 3.5) * width, y, width, color=colors[i], label=f"vs {rival}",
               yerr=np.vstack([y - t.low.to_numpy(), t.high.to_numpy() - y]),
               error_kw={"ecolor": INK, "elinewidth": 0.5, "capsize": 1})
    ax.axhline(0, color=INK, linewidth=0.8)
    ax.set_xticks(x, labels, fontsize=7)
    ax.set_ylabel("cats5 completion time change (%)\nmedian, 95% CI; below 0 = cats5 faster")
    ax.set_title("Real TCP testbed, seeds 6001-6030: cats5 against the four added baselines")
    ax.set_yscale("symlog", linthresh=10)
    ticks = [-80, -40, -20, -10, -5, 0, 5, 10, 20, 40]
    ax.set_yticks(ticks, [f"{t:+d}%" if t else "0" for t in ticks])
    ax.minorticks_off()
    ax.legend(frameon=False, ncols=8, fontsize=7)
    fig_.savefig(BASE / "fig20_real_new_baselines.png", dpi=150)
    plt.close(fig_)


def main() -> None:
    new = load("new-*.csv")
    old = load("real-*.csv")
    old = pd.concat([old, load("base-*.csv")], ignore_index=True)
    twin = pd.read_csv(BASE / "sim-twin-new.csv")
    lines = ["# cats5 against the added baselines on the real testbed", "",
             "Same testbed, seeds and cells as results/real/real.md; cats5 rerun in the same batch.",
             ""]
    lines += health(new)
    board, cells = scoreboard(new)
    lines += board
    lines += repeat_check(new, old)
    lines += everyone(new, old)
    lines += agreement(new, twin)
    g = new.groupby(["sizeMB", "algorithm"])
    lines += ["## Requests and bytes per download", "",
              md_table(pd.DataFrame({"requests": g.requests.mean(), "received MB": g.ifaceMB.mean(),
                                     "copies": g.hedges.mean()}).reset_index(), "{:.1f}"), ""]
    (BASE / "newreal.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    fig(cells, new)
    print("\n".join(lines))


if __name__ == "__main__":
    main()
