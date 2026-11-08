"""Round 3: cats3 (sub-ranges on one connection) on fresh seeds 3001-3100.

Four algorithms separate the two things cats3 changes:
  plexo      Plexo as shipped, one HTTP/1.1 request per block
  plexo-mux  Plexo's decisions on the sub-range transport
  cats2      CATS on one request per block
  cats3      CATS on the sub-range transport
so cats3 vs plexo-mux is the scheduling gain on equal transport, and cats3 vs cats2 is what the
transport did for CATS.

Reads results/r3-fluid/main.csv, results/r3-slowstart/{main,rtt_sensitivity,churn_20MB}.csv;
writes results/round3.md, fig9 and fig10.

Usage: python analysis/round3.py
"""

import numpy as np
import pandas as pd

from analyze import CATS, INK, ROOT, fmt_p, md_table, plt
from round2 import cell, change_table

BASE = ROOT / "results"
PAIRS = [("cats3", "plexo"), ("cats3", "plexo-mux"), ("cats3", "cats2"), ("plexo-mux", "plexo")]


def comparison(df: pd.DataFrame, keys: list[str]) -> pd.DataFrame:
    out = None
    for new, base in PAIRS:
        t = change_table(df, keys, new, base)
        if out is None:
            out = t[keys].copy()
        out[f"{new} vs {base} %"] = t.apply(cell, axis=1)
        if (new, base) == ("cats3", "plexo"):
            out["cats3 vs plexo: seeds >5% worse"] = t.worse5.round(0)
            out["cats3 vs plexo: worst seed %"] = t.worst.round(1)
            out["cats3 vs plexo: p (Holm)"] = t.p_holm.map(fmt_p)
    return out


def distribution(path) -> list[str]:
    d = pd.read_csv(path)
    g = d.groupby(["scenario", "rttFactor", "algorithm"])
    table = pd.DataFrame({
        "median s": g.completionS.median(),
        "mean s": g.completionS.mean(),
        "p90 s": g.completionS.quantile(0.9),
        "p99 s": g.completionS.quantile(0.99),
        "max s": g.completionS.max(),
        "new connections": g.connections.mean(),
        "requests": g.requests.mean(),
        "splits": g.splits.mean(),
        "hedges": g.hedges.mean(),
        "wasted MB": g.wastedMB.mean(),
    }).reset_index()
    return ["## 20 MB with slow start: whole distribution, connections and requests", "",
            "From src/churn.ts over seeds 3001-3100.", "", md_table(table, "{:.2f}"), ""]


def requests_table(df: pd.DataFrame) -> list[str]:
    g = df.groupby(["sizeMB", "algorithm"])
    t = pd.DataFrame({"requests": g.requests.mean(), "wasted MB": g.wastedMB.mean()}).reset_index()
    return ["## What the transport costs the server (slow start, mean per download)", "",
            md_table(t, "{:.1f}"), ""]


def fig_rtt(rtt: pd.DataFrame) -> None:
    keys = ["scenario", "rttFactor", "sizeMB"]
    lines = {
        "cats2 vs Plexo": (change_table(rtt, keys, "cats2", "plexo"), ":", 0.45),
        "cats3 vs Plexo": (change_table(rtt, keys, "cats3", "plexo"), "-", 1.0),
        "cats3 vs Plexo on sub-ranges": (change_table(rtt, keys, "cats3", "plexo-mux"), "--", 0.8),
    }
    scenarios = list(dict.fromkeys(rtt.scenario))
    sizes = sorted(rtt.sizeMB.unique())
    fig, axes = plt.subplots(len(sizes), len(scenarios), figsize=(14, 6.4), sharex=True)
    for r, size in enumerate(sizes):
        for c, scenario in enumerate(scenarios):
            ax = axes[r, c]
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
            if c == 0:
                ax.set_ylabel("change (%)\nmedian, 95% CI")
            if r == len(sizes) - 1:
                ax.set_xlabel("every RTT multiplied by")
    handles, labels = axes[0, 0].get_legend_handles_labels()
    fig.legend(handles, labels, frameon=False, ncols=3, loc="upper right")
    fig.suptitle("Seeds 3001-3100, slow start: does fetching by sub-ranges fix far servers?",
                 fontweight="bold", color=INK, x=0.32)
    fig.tight_layout(rect=(0, 0, 1, 0.95))
    fig.savefig(BASE / "fig9_round3_rtt.png")
    plt.close(fig)


def fig_main(slow: pd.DataFrame) -> None:
    keys = ["scenario", "sizeMB"]
    tables = [("cats3 vs Plexo", change_table(slow, keys, "cats3", "plexo"), CATS),
              ("cats3 vs Plexo on sub-ranges", change_table(slow, keys, "cats3", "plexo-mux"), "#8fd3b6")]
    scenarios = list(dict.fromkeys(tables[0][1].scenario))
    sizes = sorted(slow.sizeMB.unique())
    fig, axes = plt.subplots(1, len(sizes), figsize=(13, 3.9))
    x = np.arange(len(scenarios))
    for ax, size in zip(axes, sizes):
        for offset, (label, t, color) in zip((-0.2, 0.2), tables):
            s = t[t.sizeMB == size].set_index("scenario").loc[scenarios]
            y = s["median"].to_numpy()
            ax.bar(x + offset, y, 0.4, color=color, label=label,
                   yerr=np.vstack([y - s.low.to_numpy(), s.high.to_numpy() - y]),
                   error_kw={"ecolor": INK, "elinewidth": 0.8, "capsize": 2})
        ax.axhline(0, color=INK, linewidth=0.8)
        ax.set_xticks(x, [s.split("-")[0] for s in scenarios])
        ax.set_title(f"{size} MB")
    axes[0].set_ylabel("change (%)\nmedian, 95% CI")
    handles, labels = axes[0].get_legend_handles_labels()
    fig.legend(handles, labels, frameon=False, ncols=2, loc="upper right")
    fig.suptitle("Seeds 3001-3100 with slow start", fontweight="bold", color=INK, x=0.2)
    fig.savefig(BASE / "fig10_round3_main.png")
    plt.close(fig)


def main() -> None:
    fluid = pd.read_csv(BASE / "r3-fluid" / "main.csv")
    slow = pd.read_csv(BASE / "r3-slowstart" / "main.csv")
    rtt = pd.read_csv(BASE / "r3-slowstart" / "rtt_sensitivity.csv")
    assert fluid.timedOut.sum() == 0 and slow.timedOut.sum() == 0, "a run timed out"
    assert set(fluid.seed) == set(range(3001, 3101)) == set(slow.seed) == set(rtt.seed)

    lines = [
        "# Round 3: cats3 on fresh seeds 3001-3100",
        "",
        "cats3 is cats2 fetching each block as 512 KiB sub-ranges on one connection, kept a",
        "bandwidth-delay product ahead (HTTP/2 streams or HTTP/1.1 pipelining). A split stops the",
        "holder at the end of what it has already asked for, and a lost race cancels a stream, so",
        "neither drops a warm connection. plexo-mux is Plexo's decisions on the same transport.",
        "cats3 was designed after seeing seeds 2001-2100 and is judged on 3001-3100.",
        "Change = first / second - 1 per seed; negative means the first is faster.",
        "",
        "## Without slow start (fluid TCP)", "",
        md_table(comparison(fluid, ["scenario", "sizeMB"])), "",
        "## With TCP slow start", "",
        md_table(comparison(slow, ["scenario", "sizeMB"])), "",
        "## Every RTT scaled up, with slow start", "",
        md_table(comparison(rtt, ["scenario", "rttFactor", "sizeMB"])), "",
    ]
    lines += distribution(BASE / "r3-slowstart" / "churn_20MB.csv")
    lines += requests_table(slow)
    (BASE / "round3.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    fig_rtt(rtt)
    fig_main(slow)
    print("\n".join(lines))


if __name__ == "__main__":
    main()
