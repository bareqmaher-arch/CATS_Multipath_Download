"""cats5 against the published baselines on the simulator, seeds 7001-7100.

  mph2      MP-H2+FS (Nikravesh et al., MobiCom 2019), one connection per path, as published
  mph2-eq   MP-H2+FS on as many connections as cats5 and Plexo
  mptcp     MPTCP, idealised (one subflow per path, near-perfect scheduling)
  plexo     Plexo as shipped

Reads results/b-fluid/main.csv and results/b-slowstart/{main,rtt_sensitivity}.csv; writes
results/baselines.md, fig17 and fig18.

Usage: python analysis/baselines.py
"""

import numpy as np
import pandas as pd

from analyze import CATS, INK, PLEXO, ROOT, fmt_p, md_table, plt
from round2 import cell, change_table

BASE = ROOT / "results"
RIVALS = ["mph2", "mph2-eq", "mptcp", "plexo"]
COLORS = {"mph2": "#d9822b", "mph2-eq": "#7b5ea7", "mptcp": "#2f6fb0", "plexo": PLEXO}


def comparison(df: pd.DataFrame, keys: list[str]) -> pd.DataFrame:
    out = None
    for rival in RIVALS:
        t = change_table(df, keys, "cats5", rival)
        if out is None:
            out = t[keys].copy()
        out[f"cats5 vs {rival} %"] = t.apply(cell, axis=1)
        out[f"vs {rival}: seeds >5% worse"] = t.worse5.round(0)
    return out


def scoreboard(sweeps: dict[str, tuple[pd.DataFrame, list[str]]]) -> list[str]:
    rows = []
    for sweep, (df, keys) in sweeps.items():
        for rival in RIVALS:
            t = change_table(df, keys, "cats5", rival)
            sig = t.p_holm < 0.05
            rows.append({
                "sweep": sweep,
                "cats5 against": rival,
                "cells": len(t),
                "cats5 faster (sig.)": int((sig & (t["median"] < 0)).sum()),
                "cats5 slower (sig.)": int((sig & (t["median"] > 0)).sum()),
                "no clear difference": int((~sig | (t["median"] == 0)).sum()),
                "median of medians %": round(float(t["median"].median()), 1),
                "best %": round(float(t["median"].min()), 1),
                "worst %": round(float(t["median"].max()), 1),
            })
    return ["## Scoreboard: cats5 against each baseline", "",
            "Holm-corrected Wilcoxon per sweep and baseline; negative is cats5 faster.", "",
            md_table(pd.DataFrame(rows), "{:.1f}"), ""]


def fig_main(slow: pd.DataFrame) -> None:
    keys = ["scenario", "sizeMB"]
    tables = {rival: change_table(slow, keys, "cats5", rival) for rival in RIVALS}
    first = tables[RIVALS[0]]
    labels = [f"{s.split('-')[0]}\n{z} MB" for s, z in first[keys].itertuples(index=False)]
    x = np.arange(len(labels))
    width = 0.2
    fig, ax = plt.subplots(figsize=(15, 4.6))
    for i, rival in enumerate(RIVALS):
        t = tables[rival]
        y = t["median"].to_numpy()
        ax.bar(x + (i - 1.5) * width, y, width, color=COLORS[rival], label=f"vs {rival}",
               yerr=np.vstack([y - t.low.to_numpy(), t.high.to_numpy() - y]),
               error_kw={"ecolor": INK, "elinewidth": 0.6, "capsize": 1.5})
    ax.axhline(0, color=INK, linewidth=0.8)
    ax.set_xticks(x, labels, fontsize=7)
    ax.set_ylabel("cats5 completion time change (%)\nmedian, 95% CI; below 0 = cats5 faster")
    ax.set_title("Simulator, slow start, seeds 7001-7100: cats5 against the published baselines")
    ax.set_yscale("symlog", linthresh=10)
    ticks = [-80, -40, -20, -10, -5, 0, 5, 10, 20, 40]
    ax.set_yticks(ticks, [f"{t:+d}%" if t else "0" for t in ticks])
    ax.minorticks_off()
    ax.legend(frameon=False, ncols=4, fontsize=8)
    fig.savefig(BASE / "fig17_baselines_main.png")
    plt.close(fig)


def fig_rtt(rtt: pd.DataFrame) -> None:
    keys = ["scenario", "rttFactor", "sizeMB"]
    tables = {rival: change_table(rtt, keys, "cats5", rival) for rival in RIVALS}
    scenarios = list(dict.fromkeys(rtt.scenario))
    sizes = sorted(rtt.sizeMB.unique())
    fig, axes = plt.subplots(len(sizes), len(scenarios), figsize=(14, 6.4), sharex=True)
    for r, size in enumerate(sizes):
        for c, scenario in enumerate(scenarios):
            ax = axes[r, c]
            for rival in RIVALS:
                t = tables[rival]
                s = t[(t.scenario == scenario) & (t.sizeMB == size)].sort_values("rttFactor")
                y = s["median"].to_numpy()
                ax.errorbar(s.rttFactor, y, yerr=[y - s.low.to_numpy(), s.high.to_numpy() - y],
                            marker="o", markersize=4, capsize=3, color=COLORS[rival],
                            label=f"vs {rival}", linewidth=1.4)
            ax.axhline(0, color=INK, linewidth=0.8)
            ax.set_xscale("log")
            ax.set_xticks([1, 4, 10], ["x1", "x4", "x10"])
            ax.minorticks_off()
            ax.set_title(f"{scenario}, {size} MB", fontsize=9)
            if c == 0:
                ax.set_ylabel("cats5 change (%)")
            if r == len(sizes) - 1:
                ax.set_xlabel("every RTT multiplied by")
    handles, labels = axes[0, 0].get_legend_handles_labels()
    fig.legend(handles, labels, frameon=False, ncols=4, loc="upper right")
    fig.suptitle("Simulator, slow start, seeds 7001-7100", fontweight="bold", color=INK, x=0.12)
    fig.tight_layout(rect=(0, 0, 1, 0.95))
    fig.savefig(BASE / "fig18_baselines_rtt.png")
    plt.close(fig)


def main() -> None:
    fluid = pd.read_csv(BASE / "b-fluid" / "main.csv")
    slow = pd.read_csv(BASE / "b-slowstart" / "main.csv")
    rtt = pd.read_csv(BASE / "b-slowstart" / "rtt_sensitivity.csv")
    assert fluid.timedOut.sum() == 0 and slow.timedOut.sum() == 0, "a run timed out"
    main_keys = ["scenario", "sizeMB"]
    rtt_keys = ["scenario", "rttFactor", "sizeMB"]

    lines = [
        "# cats5 against published baselines (simulator)",
        "",
        "Seeds 7001-7100, never used before. cats5 frozen. MP-H2+FS implemented from the paper",
        "(src/baselines/mph2.ts): even initial split, Algorithm 1 with delta = 50 ms, Equation 1,",
        "pipelined second stream, 20 KB / 500 KB bandwidth estimate, range ends moved without",
        "tail bytes. mph2 = one connection per path (the paper); mph2-eq = cats5's connection",
        "count. mptcp = idealised MPTCP (src/baselines/mptcp.ts). In MP-H2's own stable setting",
        "the implementation balances the paths to within 0-20 ms for 1 MB+ files and lands within",
        "about 11% of the MPTCP model, as the paper reports (src/baselines/check.ts).",
        "",
        "Caveat: the simulator draws each connection's quality (q <= 1), which costs designs with",
        "one connection per path (mph2, mptcp) more than designs with many. The real testbed has",
        "no such draw.",
        "",
    ]
    lines += scoreboard({"fluid": (fluid, main_keys), "slow start": (slow, main_keys),
                         "RTT scaled, slow start": (rtt, rtt_keys)})
    g = slow.groupby(["sizeMB", "algorithm"])
    lines += ["## Requests and waste per download (slow start)", "",
              md_table(pd.DataFrame({"requests": g.requests.mean(),
                                     "wasted MB": g.wastedMB.mean()}).reset_index(), "{:.1f}"), ""]
    lines += ["## With slow start", "", md_table(comparison(slow, main_keys)), "",
              "## Every RTT scaled up, with slow start", "", md_table(comparison(rtt, rtt_keys)), "",
              "## Without slow start", "", md_table(comparison(fluid, main_keys)), ""]
    (BASE / "baselines.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    fig_main(slow)
    fig_rtt(rtt)
    print("\n".join(lines))


if __name__ == "__main__":
    main()
