"""Round 4: cats4 against the three costs cats3 brought, on fresh seeds 4001-4100.

cats4 is cats3 on SUBRANGES_V2: adaptive sub-ranges (large early, 512 KiB in the tail), only a
bandwidth-delay product asked for ahead, and a crawling connection dropped rather than kept
when it loses a race. plexo-mux2 is Plexo's decisions on the same transport.

Reads results/r4-fluid/main.csv and results/r4-slowstart/{main,rtt_sensitivity,churn_20MB}.csv;
writes results/round4.md, fig11 and fig12.

Usage: python analysis/round4.py
"""

import numpy as np
import pandas as pd

from analyze import CATS, INK, MUTED, PLEXO, ROOT, fmt_p, md_table, plt
from round2 import cell, change_table

BASE = ROOT / "results"
CATS3 = "#8fd3b6"
PAIRS = [("cats4", "plexo"), ("cats4", "cats3"), ("cats4", "plexo-mux2"), ("cats3", "plexo")]


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
        if (new, base) == ("cats4", "plexo"):
            out["cats4 vs plexo: p (Holm)"] = t.p_holm.map(fmt_p)
    return out


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
        "## Cost 1 and 2: requests and wasted data per download (slow start, all scenarios)", "",
        md_table(work, "{:.1f}"), "",
        "## Cost 3: tail risk on 20 MB, slow start (src/churn.ts, seeds 4001-4100)", "",
        md_table(tail, "{:.2f}"), "",
    ]


def diagnosis(path) -> list[str]:
    """cats4 with 512 KiB sub-ranges (cats4-fixedSize), to pin cats4's regressions on its sizing.
    Run on the same seeds that showed the regression, so it is a diagnosis, not a held-out test."""
    if not path.exists():
        return []
    d = pd.read_csv(path)
    keys = ["scenario", "rttFactor", "sizeMB"]
    out = None
    for alg in ["cats3", "cats4", "cats4-fixedSize"]:
        t = change_table(d, keys, alg, "plexo")
        if out is None:
            out = t[keys].copy()
        out[f"{alg} vs plexo %"] = t.apply(cell, axis=1)
        out[f"{alg} seeds >5% worse"] = t.worse5.round(0)
    return [
        "## Diagnosis: cats4 with fixed 512 KiB sub-ranges (same seeds 4001-4100)", "",
        "cats4-fixedSize keeps the BDP lead and the healthy-connection rule but asks for 512 KiB",
        "sub-ranges. Its seeds are the ones the regression was seen on, so this locates the cause;",
        "it is not a held-out result.", "",
        md_table(out), "",
    ]


def fig_rtt(rtt: pd.DataFrame) -> None:
    keys = ["scenario", "rttFactor", "sizeMB"]
    lines = {
        "cats3 vs Plexo": (change_table(rtt, keys, "cats3", "plexo"), ":", 0.5),
        "cats4 vs Plexo": (change_table(rtt, keys, "cats4", "plexo"), "-", 1.0),
        "cats4 vs Plexo on the same transport": (change_table(rtt, keys, "cats4", "plexo-mux2"), "--", 0.8),
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
    fig.suptitle("Seeds 4001-4100, slow start", fontweight="bold", color=INK, x=0.12)
    fig.tight_layout(rect=(0, 0, 1, 0.95))
    fig.savefig(BASE / "fig11_round4_rtt.png")
    plt.close(fig)


def fig_costs(slow: pd.DataFrame, churn: pd.DataFrame) -> None:
    algs = [("plexo", PLEXO, "Plexo"), ("cats3", CATS3, "cats3"), ("cats4", CATS, "cats4")]
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
    fig.suptitle("The three costs of cats3, and cats4 (seeds 4001-4100, slow start)",
                 fontweight="bold", color=INK, x=0.3)
    fig.text(0.99, -0.04, "lower is better in every panel; x = RTT multiplier", ha="right",
             color=MUTED, fontsize=8)
    fig.savefig(BASE / "fig12_round4_costs.png")
    plt.close(fig)


def main() -> None:
    fluid = pd.read_csv(BASE / "r4-fluid" / "main.csv")
    slow = pd.read_csv(BASE / "r4-slowstart" / "main.csv")
    rtt = pd.read_csv(BASE / "r4-slowstart" / "rtt_sensitivity.csv")
    churn = pd.read_csv(BASE / "r4-slowstart" / "churn_20MB.csv")
    assert fluid.timedOut.sum() == 0 and slow.timedOut.sum() == 0, "a run timed out"
    seeds = set(range(4001, 4101))
    assert set(fluid.seed) == seeds == set(slow.seed) == set(rtt.seed) == set(churn.seed)

    lines = [
        "# Round 4: cats4 on fresh seeds 4001-4100",
        "",
        "cats4 is cats3 on SUBRANGES_V2 (src/sim.ts): sub-ranges of half a stream's share of what",
        "is left of the file (512 KiB to 8 MiB), only a bandwidth-delay product asked for ahead, and",
        "a connection under half its network's usual speed dropped instead of kept when it loses a",
        "race. plexo-mux2 is Plexo's decisions on the same transport. cats4 was designed after",
        "seeing seeds 3001-3100 and is judged on 4001-4100.",
        "Change = first / second - 1 per seed; negative means the first is faster.",
        "",
        "## Without slow start (fluid TCP)", "",
        md_table(comparison(fluid, ["scenario", "sizeMB"])), "",
        "## With TCP slow start", "",
        md_table(comparison(slow, ["scenario", "sizeMB"])), "",
        "## Every RTT scaled up, with slow start", "",
        md_table(comparison(rtt, ["scenario", "rttFactor", "sizeMB"])), "",
    ]
    lines += costs(slow, churn)
    lines += diagnosis(BASE / "r4-diag" / "rtt_sensitivity.csv")
    (BASE / "round4.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    fig_rtt(rtt)
    fig_costs(slow, churn)
    print("\n".join(lines))


if __name__ == "__main__":
    main()
