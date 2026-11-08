"""The real-network campaign (wild/campaign.ps1): Wi-Fi and a tethered phone downloading from a
server in Germany, rounds in five blocks across a day and a night. Each round is one pairing: every algorithm
downloads the same file back to back, in shuffled order.

Cells: file size, over all blocks and per block (time of day). Holm-corrected Wilcoxon on paired
rounds, as on the testbed. Reads results/wild/wild.csv; writes results/wild/wild.md and fig23.

Usage: python analysis/wild.py [rounds per block, default 8]
"""

import sys

import numpy as np
import pandas as pd

from analyze import INK, ROOT, md_table, plt
from real import pair
from round2 import cell

BASE = ROOT / "results" / "wild"
FOCAL = "cats8"
RIVALS = ["cats6", "cats5", "plexo", "rb-eq", "twoway-eq", "mph2-eq"]
PER_BLOCK = int(sys.argv[1]) if len(sys.argv) > 1 else 8


def shaped(df: pd.DataFrame, by_block: bool) -> pd.DataFrame:
    """In the testbed's shape for pair(): a round is a seed, a block (or all) a scenario."""
    out = df.copy()
    out["seed"] = out["round"]
    out["scenario"] = ("block " + out.block.astype(str)) if by_block else "all"
    out["rttFactor"] = 1
    return out


def scoreboard(df: pd.DataFrame) -> tuple[list[str], dict[str, pd.DataFrame]]:
    rows, cells, tables = [], None, {}
    keys = ["scenario", "rttFactor", "sizeMB"]
    for rival in RIVALS:
        t = pd.concat([pair(shaped(df, False), FOCAL, rival), pair(shaped(df, True), FOCAL, rival)], ignore_index=True)
        if t.empty:
            continue
        tables[rival] = t
        sig = t.p_holm < 0.05
        rows.append({f"{FOCAL} against": rival, "cells": len(t),
                     "faster (sig.)": int((sig & (t["median"] < 0)).sum()),
                     "slower (sig.)": int((sig & (t["median"] > 0)).sum()),
                     "no clear difference": int((~sig | (t["median"] == 0)).sum()),
                     "median of medians %": round(float(t["median"].median()), 1)})
        t = t.set_index(keys)
        if cells is None:
            cells = pd.DataFrame(index=t.index)
        cells[f"vs {rival} %"] = t.apply(cell, axis=1) + t.p_holm.map(lambda p: "" if p < 0.05 else " ns")
    lines = ["## Scoreboard", "",
             "Cells: each size over all rounds, and per block. Holm-corrected Wilcoxon over each",
             "comparison's cells; negative is cats8 faster.", "",
             md_table(pd.DataFrame(rows), "{:.1f}"), "",
             "## Per cell, median [95% CI]; ns = not significant (Holm)", "",
             md_table(cells.reset_index().drop(columns="rttFactor")), ""]
    return lines, tables


def fig(tables: dict[str, pd.DataFrame]) -> None:
    rivals = list(tables)
    first = tables[rivals[0]]
    labels = [f"{s} {z} MB" for s, z in first[["scenario", "sizeMB"]].itertuples(index=False)]
    x = np.arange(len(labels))
    width = 0.8 / len(rivals)
    colors = plt.cm.tab10(np.arange(len(rivals)))
    fig_, ax = plt.subplots(figsize=(14, 4.8))
    for i, rival in enumerate(rivals):
        t = tables[rival]
        y = t["median"].to_numpy()
        ax.bar(x + (i - (len(rivals) - 1) / 2) * width, y, width, color=colors[i], label=f"vs {rival}",
               yerr=np.vstack([y - t.low.to_numpy(), t.high.to_numpy() - y]),
               error_kw={"ecolor": INK, "elinewidth": 0.5, "capsize": 1})
    ax.axhline(0, color=INK, linewidth=0.8)
    ax.set_xticks(x, labels, fontsize=7)
    ax.set_ylabel("cats8 completion time change (%)\nmedian, 95% CI; below 0 = cats8 faster")
    ax.set_title("Real networks (Wi-Fi + tethered LTE, server in Germany): cats8 against each")
    ax.set_yscale("symlog", linthresh=10)
    ax.minorticks_off()
    ax.legend(frameon=False, ncols=len(rivals), fontsize=7)
    fig_.savefig(BASE / "fig23_wild.png", dpi=150)
    plt.close(fig_)


def main() -> None:
    df = pd.read_csv(BASE / "wild.csv")
    df["block"] = (df["round"] - 1) // PER_BLOCK + 1
    # A round pairs the algorithms only if they all had both networks: if one network carried
    # nothing for any of them it had died mid-round, so the round compares different conditions.
    dead = df.assign(dead=(df.lteMB == 0) | (df.wifiMB == 0)).groupby(["round", "sizeMB"]).dead.transform("any")
    dropped = sorted({(int(r), int(z)) for r, z in zip(df["round"][dead], df.sizeMB[dead])})
    df = df[~dead].copy()
    started = pd.to_datetime(df.startedAt)
    by_block = df.assign(hour=started.dt.tz_convert("Asia/Baghdad").dt.hour).groupby("block")
    conditions = pd.DataFrame({
        "rounds": by_block["round"].nunique(),
        "local start hour": by_block.hour.min(),
        "RTT Wi-Fi ms": by_block.rttWifiMs.median(),
        "RTT LTE ms": by_block.rttLteMs.median(),
        "LTE share of bytes %": by_block.apply(lambda g: 100 * g.lteMB.sum() / g.appMB.sum(), include_groups=False),
    }).round(1).reset_index()
    lines = ["# cats8 over real networks", "",
             "Wi-Fi (home fibre) and LTE (phone tethered by USB) on one laptop, server in Germany;",
             "nothing shaped. Every algorithm once per round, same file, shuffled order.", "",
             "## Conditions", "",
             f"- runs: {len(df)}; timed out: {int(df.timedOut.sum())}; with request errors: {int(df.errors.notna().sum())}",
             f"- rounds per size: {df.groupby('sizeMB')['round'].nunique().to_dict()}",
             f"- left out because a network died mid-round (round, MB): {dropped or 'none'}",
             f"- engine tick: mean {df.meanTickMs.mean():.2f} ms, max {df.meanTickMs.max():.2f} ms (target 10)", "",
             md_table(conditions, "{:.1f}"), ""]
    board, tables = scoreboard(df)
    lines += board
    med = df.groupby(["block", "sizeMB", "algorithm"]).completionS.median().unstack()
    lines += ["## Median completion time (s)", "", md_table(med.reset_index(), "{:.2f}"), ""]
    g = df.groupby(["sizeMB", "algorithm"])
    lines += ["## Requests and bytes per download", "",
              md_table(pd.DataFrame({"requests": g.requests.mean(), "received MB": g.appMB.mean(),
                                     "LTE MB": g.lteMB.mean(), "copies": g.hedges.mean()}).reset_index(), "{:.1f}"), ""]
    (BASE / "wild.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    if tables:
        fig(tables)
    print("\n".join(lines))


if __name__ == "__main__":
    main()
