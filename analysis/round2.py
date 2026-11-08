"""Round 2: cats2 (slow start priced into splits) against cats and Plexo on fresh seeds 2001-2100.

Reads results/r2-fluid/main.csv, results/r2-slowstart/main.csv and
results/r2-slowstart/rtt_sensitivity.csv; writes results/round2.md, fig7 and fig8.

Usage: python analysis/round2.py
"""

import numpy as np
import pandas as pd
from scipy.stats import wilcoxon

from analyze import CATS, INK, ROOT, boot_median_ci, fmt_p, holm, md_table, plt

BASE = ROOT / "results"
CATS1 = "#8fd3b6"


def change_table(df: pd.DataFrame, keys: list[str], new: str, base: str) -> pd.DataFrame:
    """Per-seed change new / base - 1, summarised per cell, with Holm-corrected Wilcoxon p."""
    wide = df.pivot_table(index=keys + ["seed"], columns="algorithm", values="completionS")
    rows = []
    for cell, group in wide.groupby(level=list(range(len(keys)))):
        a, b = group[new].to_numpy(), group[base].to_numpy()
        change = (a / b - 1) * 100
        low, high = boot_median_ci(change)
        diff = a - b
        rows.append({
            **dict(zip(keys, cell)),
            "median": np.median(change),
            "low": low,
            "high": high,
            "win": (change < 0).mean() * 100,
            "worse5": (change > 5).mean() * 100,
            "worst": change.max(),
            "p": wilcoxon(diff).pvalue if np.any(diff != 0) else np.nan,
        })
    table = pd.DataFrame(rows)
    table["p_holm"] = holm(table.p.tolist())
    return table


def cell(r: pd.Series) -> str:
    return f"{r['median']:+.1f} [{r.low:+.1f}, {r.high:+.1f}]"


def model_section(name: str, df: pd.DataFrame) -> list[str]:
    keys = ["scenario", "sizeMB"]
    v1 = change_table(df, keys, "cats", "plexo")
    v2 = change_table(df, keys, "cats2", "plexo")
    vs = change_table(df, keys, "cats2", "cats")
    out = v1[keys].copy()
    out["cats vs Plexo %"] = v1.apply(cell, axis=1)
    out["cats2 vs Plexo %"] = v2.apply(cell, axis=1)
    out["cats2 p (Holm)"] = v2.p_holm.map(fmt_p)
    out["cats2 seeds >5% worse"] = v2.worse5.round(0)
    out["cats2 worst seed %"] = v2.worst.round(1)
    out["cats2 vs cats %"] = vs.apply(cell, axis=1)
    return [f"## {name}", "", md_table(out), ""]


def rtt_section(d: pd.DataFrame) -> tuple[list[str], pd.DataFrame, pd.DataFrame]:
    keys = ["scenario", "rttFactor", "sizeMB"]
    v1 = change_table(d, keys, "cats", "plexo")
    v2 = change_table(d, keys, "cats2", "plexo")
    out = v1[keys].copy()
    out["cats vs Plexo %"] = v1.apply(cell, axis=1)
    out["cats seeds >5% worse"] = v1.worse5.round(0)
    out["cats2 vs Plexo %"] = v2.apply(cell, axis=1)
    out["cats2 seeds >5% worse"] = v2.worse5.round(0)
    out["cats2 worst seed %"] = v2.worst.round(1)
    out["cats2 p (Holm)"] = v2.p_holm.map(fmt_p)
    lines = ["## Every RTT scaled up, with slow start", "", md_table(out), ""]
    return lines, v1, v2


def churn_section(path) -> list[str]:
    """20 MB, slow start, RTT x1 and x10: the whole distribution, and new connections opened."""
    if not path.exists():
        return []
    d = pd.read_csv(path)
    g = d.groupby(["scenario", "rttFactor", "algorithm"])
    table = pd.DataFrame({
        "median s": g.completionS.median(),
        "mean s": g.completionS.mean(),
        "p90 s": g.completionS.quantile(0.9),
        "p99 s": g.completionS.quantile(0.99),
        "max s": g.completionS.max(),
        "new connections": g.connections.mean(),
        "splits": g.splits.mean(),
        "hedges": g.hedges.mean(),
    }).reset_index()
    return ["## 20 MB with slow start: whole distribution and new connections", "",
            "From src/churn.ts over seeds 2001-2100 (results/r2-slowstart/churn_20MB.csv).", "",
            md_table(table, "{:.2f}"), ""]


def fig_models(tables: dict[str, tuple[pd.DataFrame, pd.DataFrame]]) -> None:
    sizes = [20, 200, 1000]
    fig, axes = plt.subplots(2, 3, figsize=(13, 6.6), sharex=True)
    for row, (model, (v1, v2)) in enumerate(tables.items()):
        scenarios = list(dict.fromkeys(v1.scenario))
        x = np.arange(len(scenarios))
        for col, size in enumerate(sizes):
            ax = axes[row, col]
            for offset, t, color, label in [(-0.2, v1, CATS1, "cats"), (0.2, v2, CATS, "cats2")]:
                s = t[t.sizeMB == size].set_index("scenario").loc[scenarios]
                y = s["median"].to_numpy()
                err = np.vstack([y - s.low.to_numpy(), s.high.to_numpy() - y])
                ax.bar(x + offset, y, 0.4, color=color, label=label, yerr=err,
                       error_kw={"ecolor": INK, "elinewidth": 0.8, "capsize": 2})
            ax.axhline(0, color=INK, linewidth=0.8)
            ax.set_xticks(x, [s.split("-")[0] for s in scenarios])
            ax.set_title(f"{model}, {size} MB")
        axes[row, 0].set_ylabel("vs Plexo (%)\nmedian, 95% CI")
    handles, labels = axes[0, 0].get_legend_handles_labels()
    fig.legend(handles, labels, frameon=False, ncols=2, loc="upper right")
    fig.suptitle("Seeds 2001-2100: cats and cats2 against Plexo", fontweight="bold", color=INK, x=0.3)
    fig.tight_layout()
    fig.savefig(BASE / "fig7_round2_models.png")
    plt.close(fig)


def fig_rtt(v1: pd.DataFrame, v2: pd.DataFrame) -> None:
    colors = ["#0b6e4f", "#2f9e75", "#d9822b", "#7b5ea7"]
    sizes = sorted(v1.sizeMB.unique())
    fig, axes = plt.subplots(1, len(sizes), figsize=(11, 4))
    for ax, size in zip(axes, sizes):
        for color, scenario in zip(colors, dict.fromkeys(v1.scenario)):
            for t, style, suffix in [(v1, "--", "cats"), (v2, "-", "cats2")]:
                s = t[(t.scenario == scenario) & (t.sizeMB == size)].sort_values("rttFactor")
                y = s["median"].to_numpy()
                err = [y - s.low.to_numpy(), s.high.to_numpy() - y]
                ax.errorbar(s.rttFactor, y, yerr=err, linestyle=style, marker="o", color=color,
                            capsize=3, linewidth=1.5, markersize=4,
                            alpha=0.55 if suffix == "cats" else 1,
                            label=f"{scenario} {suffix}")
        ax.axhline(0, color=INK, linewidth=0.8)
        ax.set_xscale("log")
        ax.set_xticks([1, 4, 10], ["x1", "x4", "x10"])
        ax.minorticks_off()
        ax.set_xlabel("every RTT multiplied by")
        ax.set_title(f"{size} MB")
    axes[0].set_ylabel("vs Plexo (%)\nmedian, 95% CI")
    axes[1].legend(frameon=False, fontsize=7, ncols=2)
    fig.suptitle("With slow start, as the server moves away: cats dashed, cats2 solid",
                 fontweight="bold", color=INK)
    fig.savefig(BASE / "fig8_round2_rtt.png")
    plt.close(fig)


def main() -> None:
    fluid = pd.read_csv(BASE / "r2-fluid" / "main.csv")
    slow = pd.read_csv(BASE / "r2-slowstart" / "main.csv")
    rtt = pd.read_csv(BASE / "r2-slowstart" / "rtt_sensitivity.csv")
    assert fluid.timedOut.sum() == 0 and slow.timedOut.sum() == 0, "a run timed out"
    assert set(fluid.seed) == set(range(2001, 2101)) == set(slow.seed) == set(rtt.seed)

    lines = [
        "# Round 2: cats2 on fresh seeds 2001-2100",
        "",
        "cats2 prices TCP slow start into the taker's request (a new or long-idle connection restarts",
        "from the initial window). It was designed after seeing seeds 1001-1100, so it is judged on",
        "2001-2100, which no design decision saw. Change = algorithm / baseline - 1 per seed;",
        "negative is faster. p is Wilcoxon signed-rank, Holm-corrected within each table.",
        "",
    ]
    lines += model_section("Without slow start (fluid TCP)", fluid)
    lines += model_section("With TCP slow start", slow)
    rtt_lines, rv1, rv2 = rtt_section(rtt)
    lines += rtt_lines
    lines += churn_section(BASE / "r2-slowstart" / "churn_20MB.csv")
    (BASE / "round2.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    keys = ["scenario", "sizeMB"]
    fig_models({
        "fluid TCP": (change_table(fluid, keys, "cats", "plexo"), change_table(fluid, keys, "cats2", "plexo")),
        "slow start": (change_table(slow, keys, "cats", "plexo"), change_table(slow, keys, "cats2", "plexo")),
    })
    fig_rtt(rv1, rv2)
    print("\n".join(lines))


if __name__ == "__main__":
    main()
