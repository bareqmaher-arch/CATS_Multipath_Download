"""Round 5: cats5 (sub-ranges sized by time at the stream's own speed) on fresh seeds 5001-5100.

cats5 asks for what a connection fetches in one second at its measured speed, between 512 KiB
and 8 MiB, keeps only a bandwidth-delay product asked for ahead, and drops a crawling
connection that loses a race. Compared with Plexo, with Plexo on the same transport
(plexo-mux3), and with cats4-fixedSize (the same but 512 KiB sub-ranges), whose numbers until
now came only from the seeds that diagnosed cats4.

Reads results/r5-fluid/main.csv and results/r5-slowstart/{main,rtt_sensitivity,churn_20MB}.csv;
writes results/round5.md, fig13 and fig14.

Usage: python analysis/round5.py
"""

import numpy as np
import pandas as pd

from analyze import CATS, INK, MUTED, PLEXO, ROOT, fmt_p, md_table, plt
from round2 import cell, change_table

BASE = ROOT / "results"
FIXED = "#8fd3b6"
PAIRS = [("cats5", "plexo"), ("cats5", "cats4-fixedSize"), ("cats5", "plexo-mux3"),
         ("cats4-fixedSize", "plexo")]


def comparison(df: pd.DataFrame, keys: list[str]) -> pd.DataFrame:
    out = None
    for new, base in PAIRS:
        t = change_table(df, keys, new, base)
        if out is None:
            out = t[keys].copy()
        out[f"{new} vs {base} %"] = t.apply(cell, axis=1)
        if base == "plexo":
            out[f"{new}: seeds >5% worse"] = t.worse5.round(0)
            out[f"{new}: worst seed %"] = t.worst.round(1)
        if (new, base) == ("cats5", "plexo"):
            out["cats5 vs plexo: p (Holm)"] = t.p_holm.map(fmt_p)
    return out


def scoreboard(tables: dict[str, pd.DataFrame], keys_by: dict[str, list[str]]) -> list[str]:
    """Per algorithm and sweep: cells significantly faster or slower than Plexo (Holm p < 0.05,
    by the sign of the median), and cells where over 5% of seeds lose by over 5%."""
    rows = []
    for sweep, df in tables.items():
        for alg in ["cats5", "cats4-fixedSize", "plexo-mux3"]:
            t = change_table(df, keys_by[sweep], alg, "plexo")
            significant = t.p_holm < 0.05
            rows.append({
                "sweep": sweep,
                "algorithm": alg,
                "cells": len(t),
                "faster (sig.)": int((significant & (t["median"] < 0)).sum()),
                "slower (sig.)": int((significant & (t["median"] > 0)).sum()),
                "no clear difference": int((~significant | (t["median"] == 0)).sum()),
                "cells with >5% of seeds over 5% worse": int((t.worse5 > 5).sum()),
                "worst median %": round(float(t["median"].max()), 1),
                "best median %": round(float(t["median"].min()), 1),
            })
    return ["## Scoreboard against Plexo", "", md_table(pd.DataFrame(rows), "{:.1f}"), ""]


def costs(slow: pd.DataFrame, churn: pd.DataFrame) -> list[str]:
    g = slow.groupby(["sizeMB", "algorithm"])
    work = pd.DataFrame({"requests": g.requests.mean(), "wasted MB": g.wastedMB.mean(),
                         "splits": g.splits.mean(), "hedges": g.hedges.mean()}).reset_index()
    c = churn.groupby(["scenario", "rttFactor", "algorithm"])
    tail = pd.DataFrame({
        "median s": c.completionS.median(),
        "p90 s": c.completionS.quantile(0.9),
        "p99 s": c.completionS.quantile(0.99),
        "max s": c.completionS.max(),
        "new connections": c.connections.mean(),
        "requests": c.requests.mean(),
        "splits": c.splits.mean(),
        "hedges": c.hedges.mean(),
        "wasted MB": c.wastedMB.mean(),
    }).reset_index()
    return [
        "## Requests and wasted data per download (slow start, all scenarios)", "",
        md_table(work, "{:.1f}"), "",
        "## Tail risk on 20 MB, slow start (src/churn.ts, seeds 5001-5100)", "",
        md_table(tail, "{:.2f}"), "",
    ]


def fig_rtt(rtt: pd.DataFrame) -> None:
    keys = ["scenario", "rttFactor", "sizeMB"]
    lines = {
        "cats4-fixedSize vs Plexo": (change_table(rtt, keys, "cats4-fixedSize", "plexo"), ":", 0.55),
        "cats5 vs Plexo": (change_table(rtt, keys, "cats5", "plexo"), "-", 1.0),
        "cats5 vs Plexo on the same transport": (change_table(rtt, keys, "cats5", "plexo-mux3"), "--", 0.8),
    }
    scenarios = list(dict.fromkeys(rtt.scenario))
    sizes = sorted(rtt.sizeMB.unique())
    fig, axes = plt.subplots(len(sizes), len(scenarios), figsize=(14, 6.4), sharex=True)
    for r, size in enumerate(sizes):
        for col, scenario in enumerate(scenarios):
            ax = axes[r, col]
            for label, (t, style, alpha) in lines.items():
                s = t[(t.scenario == scenario) & (t.sizeMB == size)].sort_values("rttFactor")
                y = s["median"].to_numpy()
                ax.errorbar(s.rttFactor, y, yerr=[y - s.low.to_numpy(), s.high.to_numpy() - y],
                            linestyle=style, marker="o", markersize=4, capsize=3, color=CATS,
                            alpha=alpha, label=label)
            ax.axhline(0, color=INK, linewidth=0.8)
            ax.set_xscale("log")
            ax.set_xticks([1, 4, 10], ["x1", "x4", "x10"])
            ax.minorticks_off()
            ax.set_title(f"{scenario}, {size} MB", fontsize=9)
            if col == 0:
                ax.set_ylabel("change (%)\nmedian, 95% CI")
            if r == len(sizes) - 1:
                ax.set_xlabel("every RTT multiplied by")
    handles, labels = axes[0, 0].get_legend_handles_labels()
    fig.legend(handles, labels, frameon=False, ncols=3, loc="upper right")
    fig.suptitle("Seeds 5001-5100, slow start", fontweight="bold", color=INK, x=0.12)
    fig.tight_layout(rect=(0, 0, 1, 0.95))
    fig.savefig(BASE / "fig13_round5_rtt.png")
    plt.close(fig)


def fig_costs(slow: pd.DataFrame, churn: pd.DataFrame) -> None:
    algs = [("plexo", PLEXO, "Plexo"), ("cats4-fixedSize", FIXED, "cats4-fixedSize"),
            ("cats5", CATS, "cats5")]
    sizes = sorted(slow.sizeMB.unique())
    fig, axes = plt.subplots(1, 3, figsize=(13, 3.8))
    x = np.arange(len(sizes))
    for i, (alg, color, label) in enumerate(algs):
        sub = slow[slow.algorithm == alg].groupby("sizeMB")
        axes[0].bar(x + (i - 1) * 0.27, sub.requests.mean().loc[sizes], 0.27, color=color, label=label)
        axes[1].bar(x + (i - 1) * 0.27, sub.wastedMB.mean().loc[sizes], 0.27, color=color, label=label)
    for ax, title in zip(axes[:2], ["Requests per download", "Wasted MB per download"]):
        ax.set_xticks(x, [f"{s} MB" for s in sizes])
        ax.set_title(title)
    axes[0].set_yscale("log")
    axes[0].legend(frameon=False)
    cells = [("S4-stragglers", 1), ("S4-stragglers", 10), ("S6-three", 1), ("S6-three", 10),
             ("S1-stable", 10)]
    x = np.arange(len(cells))
    for i, (alg, color, label) in enumerate(algs):
        p99 = [churn[(churn.scenario == s) & (churn.rttFactor == f) & (churn.algorithm == alg)]
               .completionS.quantile(0.99) for s, f in cells]
        axes[2].bar(x + (i - 1) * 0.27, p99, 0.27, color=color, label=label)
    axes[2].set_xticks(x, [f"{s.split('-')[0]}\nx{f}" for s, f in cells])
    axes[2].set_title("p99 completion, 20 MB (s)")
    fig.suptitle("Costs, seeds 5001-5100 with slow start", fontweight="bold", color=INK, x=0.2)
    fig.text(0.99, -0.04, "lower is better in every panel; x = RTT multiplier", ha="right",
             color=MUTED, fontsize=8)
    fig.savefig(BASE / "fig14_round5_costs.png")
    plt.close(fig)


def main() -> None:
    fluid = pd.read_csv(BASE / "r5-fluid" / "main.csv")
    slow = pd.read_csv(BASE / "r5-slowstart" / "main.csv")
    rtt = pd.read_csv(BASE / "r5-slowstart" / "rtt_sensitivity.csv")
    churn = pd.read_csv(BASE / "r5-slowstart" / "churn_20MB.csv")
    assert fluid.timedOut.sum() == 0 and slow.timedOut.sum() == 0, "a run timed out"
    seeds = set(range(5001, 5101))
    assert set(fluid.seed) == seeds == set(slow.seed) == set(rtt.seed) == set(churn.seed)

    main_keys = ["scenario", "sizeMB"]
    rtt_keys = ["scenario", "rttFactor", "sizeMB"]
    lines = [
        "# Round 5: cats5 on fresh seeds 5001-5100",
        "",
        "cats5 runs on SUBRANGES_V3 (src/sim.ts): each sub-range is what its connection fetches in",
        "one second at its measured speed (512 KiB to 8 MiB), only a bandwidth-delay product is asked",
        "for ahead, and a connection under half its network's usual speed is dropped rather than kept",
        "when it loses a race. plexo-mux3 is Plexo on the same transport. cats5 was designed after",
        "seeing seeds 4001-4100 and is judged on 5001-5100; so is cats4-fixedSize, whose earlier",
        "numbers came from the seeds that diagnosed cats4.",
        "Change = first / second - 1 per seed; negative means the first is faster.",
        "",
    ]
    lines += scoreboard({"fluid": fluid, "slow start": slow, "RTT scaled, slow start": rtt},
                        {"fluid": main_keys, "slow start": main_keys, "RTT scaled, slow start": rtt_keys})
    lines += [
        "## Without slow start (fluid TCP)", "", md_table(comparison(fluid, main_keys)), "",
        "## With TCP slow start", "", md_table(comparison(slow, main_keys)), "",
        "## Every RTT scaled up, with slow start", "", md_table(comparison(rtt, rtt_keys)), "",
    ]
    lines += costs(slow, churn)
    (BASE / "round5.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    fig_rtt(rtt)
    fig_costs(slow, churn)
    print("\n".join(lines))


if __name__ == "__main__":
    main()
