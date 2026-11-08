"""Statistics and figures for the CATS vs Plexo sweeps.

Reads results/<tcp>/main.csv and cost.csv (written by src/run.ts) and writes summary.md plus
fig*.png beside them. With both TCP models run, also writes results/compare_tcp.md and
results/fig5_fluid_vs_slowstart.png.

Every comparison is paired: the same seed gives the same network to every algorithm, so the unit
of analysis is the per-seed relative change (CATS / Plexo - 1). Medians carry 95% bootstrap
confidence intervals; significance is a two-sided Wilcoxon signed-rank test, Holm-corrected
across all scenario x size cells.

Usage: python analysis/analyze.py [fluid|slowstart]
"""

import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy.stats import wilcoxon

ROOT = Path(__file__).resolve().parent.parent
TCP = sys.argv[1] if len(sys.argv) > 1 else "fluid"
RESULTS = ROOT / "results" / TCP
RNG = np.random.default_rng(2026)
BOOT = 5000

INK = "#1f2933"
MUTED = "#7b8794"
GRID = "#e4e7eb"
PLEXO = "#9aa5b1"
CATS = "#0b6e4f"
NOSPLIT = "#d9822b"
NOFACTOR = "#7b5ea7"

plt.rcParams.update(
    {
        "font.family": "DejaVu Sans",
        "font.size": 10,
        "axes.edgecolor": MUTED,
        "axes.labelcolor": INK,
        "axes.titlecolor": INK,
        "axes.titlesize": 11,
        "axes.titleweight": "bold",
        "xtick.color": INK,
        "ytick.color": INK,
        "axes.grid": True,
        "grid.color": GRID,
        "grid.linewidth": 0.8,
        "axes.axisbelow": True,
        "axes.spines.top": False,
        "axes.spines.right": False,
        "figure.dpi": 150,
        "savefig.bbox": "tight",
    }
)


def boot_median_ci(values: np.ndarray) -> tuple[float, float]:
    samples = RNG.choice(values, size=(BOOT, len(values)), replace=True)
    medians = np.median(samples, axis=1)
    return float(np.percentile(medians, 2.5)), float(np.percentile(medians, 97.5))


def holm(pvalues: list[float]) -> list[float]:
    p = np.array([1.0 if np.isnan(v) else v for v in pvalues])
    order = np.argsort(p)
    adjusted = np.empty_like(p)
    running = 0.0
    for rank, index in enumerate(order):
        running = max(running, (len(p) - rank) * p[index])
        adjusted[index] = min(1.0, running)
    return adjusted.tolist()


def paired(main: pd.DataFrame, alg: str, metric: str = "completionS") -> pd.DataFrame:
    wide = main.pivot_table(index=["scenario", "sizeMB", "seed"], columns="algorithm", values=metric)
    rows = []
    for (scenario, size), group in wide.groupby(level=[0, 1]):
        base, new = group["plexo"].to_numpy(), group[alg].to_numpy()
        change = (new / base - 1) * 100
        low, high = boot_median_ci(change)
        diff = new - base
        p = wilcoxon(diff).pvalue if np.any(diff != 0) else np.nan
        rows.append(
            {
                "scenario": scenario,
                "sizeMB": size,
                "n": len(change),
                "plexo_median_s": np.median(base),
                "alg_median_s": np.median(new),
                "median_change_pct": np.median(change),
                "ci_low": low,
                "ci_high": high,
                "p95_change_pct": (np.percentile(new, 95) / np.percentile(base, 95) - 1) * 100,
                "worst_seed_pct": change.max(),
                "win_pct": (change < 0).mean() * 100,
                "loss_over_5pct": (change > 5).mean() * 100,
                "p": p,
            }
        )
    table = pd.DataFrame(rows)
    table["p_holm"] = holm(table["p"].tolist())
    return table


def overhead(main: pd.DataFrame) -> pd.DataFrame:
    main = main.assign(over=main.completionS - main.lowerBoundS)
    g = main.groupby(["scenario", "sizeMB", "algorithm"]).over.mean().unstack()
    g["removed_pct"] = (1 - g["cats"] / g["plexo"]) * 100
    return g[["plexo", "cats", "removed_pct"]]


def md_table(df: pd.DataFrame, floatfmt: str = "{:.1f}") -> str:
    cols = list(df.columns)
    lines = ["| " + " | ".join(str(c) for c in cols) + " |", "|" + "---|" * len(cols)]
    for _, row in df.iterrows():
        cells = []
        for c in cols:
            v = row[c]
            if isinstance(v, (float, np.floating)):
                cells.append("n/a" if np.isnan(v) else floatfmt.format(v))
            else:
                cells.append(str(v))
        lines.append("| " + " | ".join(cells) + " |")
    return "\n".join(lines)


def fmt_p(p: float) -> str:
    if np.isnan(p):
        return "n/a"
    return "<0.001" if p < 0.001 else f"{p:.3f}"


# --- figures ------------------------------------------------------------------------------------


def fig_improvement(table: pd.DataFrame) -> None:
    scenarios = list(dict.fromkeys(table.scenario))
    sizes = sorted(table.sizeMB.unique())
    shades = {20: "#8fd3b6", 200: "#2f9e75", 1000: CATS}
    fig, ax = plt.subplots(figsize=(10, 4.2))
    width = 0.26
    x = np.arange(len(scenarios))
    for i, size in enumerate(sizes):
        t = table[table.sizeMB == size].set_index("scenario").loc[scenarios]
        y = t.median_change_pct.to_numpy()
        err = np.vstack([y - t.ci_low.to_numpy(), t.ci_high.to_numpy() - y])
        ax.bar(x + (i - 1) * width, y, width, color=shades[size], label=f"{size} MB",
               yerr=err, error_kw={"ecolor": INK, "elinewidth": 0.8, "capsize": 2})
    ax.axhline(0, color=INK, linewidth=0.8)
    ax.set_xticks(x, scenarios, rotation=0, fontsize=9)
    ax.set_ylabel("Completion time vs Plexo (%)\nmedian of paired seeds, 95% CI")
    ax.set_title("CATS vs Plexo: below zero means CATS finishes sooner")
    ax.legend(frameon=False, ncols=3, loc="lower left")
    fig.savefig(RESULTS / "fig1_completion_vs_plexo.png")
    plt.close(fig)


def fig_ablation(main: pd.DataFrame) -> None:
    variants = [("cats", "CATS (full)"), ("cats-noSplit", "factoring only"),
                ("cats-noFactor", "split tail only")]
    tables = {alg: paired(main, alg) for alg, _ in variants}
    keys = tables["cats"][["scenario", "sizeMB"]]
    cells = [f"{s.split('-')[0]}\n{size}" for s, size in zip(keys.scenario, keys.sizeMB)]
    grid = np.vstack([tables[alg].median_change_pct.to_numpy() for alg, _ in variants])
    fig, ax = plt.subplots(figsize=(12, 2.8))
    limit = np.nanmax(np.abs(grid))
    im = ax.imshow(grid, cmap="RdYlGn_r", vmin=-limit, vmax=limit, aspect="auto")
    ax.set_yticks(range(len(variants)), [label for _, label in variants])
    ax.set_xticks(range(len(cells)), cells, fontsize=7)
    ax.set_xlabel("scenario / file size (MB)", fontsize=8)
    ax.grid(False)
    for (r, c), v in np.ndenumerate(grid):
        ax.text(c, r, f"{v:.0f}", ha="center", va="center", fontsize=7,
                color="white" if abs(v) > limit * 0.6 else INK)
    ax.set_title("Which part of CATS does the work? Median % change in completion time vs Plexo")
    fig.colorbar(im, ax=ax, fraction=0.015, pad=0.01)
    fig.savefig(RESULTS / "fig2_ablation.png")
    plt.close(fig)


def fig_cdf(main: pd.DataFrame, scenario: str, size: int) -> None:
    sub = main[(main.scenario == scenario) & (main.sizeMB == size)]
    fig, ax = plt.subplots(figsize=(5.5, 3.6))
    for alg, color, label in [("plexo", PLEXO, "Plexo"), ("cats", CATS, "CATS")]:
        v = np.sort(sub[sub.algorithm == alg].completionS.to_numpy())
        ax.step(v, np.arange(1, len(v) + 1) / len(v), where="post", color=color, linewidth=2,
                label=label)
    lb = np.sort(sub[sub.algorithm == "plexo"].lowerBoundS.to_numpy())
    ax.step(lb, np.arange(1, len(lb) + 1) / len(lb), where="post", color=MUTED, linewidth=1,
            linestyle="--", label="lower bound")
    ax.set_xlabel("Completion time (s)")
    ax.set_ylabel("Fraction of seeds")
    ax.set_title(f"{scenario}, {size} MB")
    ax.legend(frameon=False, loc="lower right")
    fig.savefig(RESULTS / f"fig3_cdf_{scenario}_{size}.png")
    plt.close(fig)


def cost_summary(cost: pd.DataFrame) -> pd.DataFrame:
    g = cost.groupby(["scenario", "algorithm"])
    out = g.agg(mean_s=("completionS", "mean"), p95_s=("completionS", lambda v: np.percentile(v, 95)),
                metered_MB=("meteredMB", "mean"), wasted_MB=("wastedMB", "mean")).reset_index()
    return out


def fig_pareto(cost: pd.DataFrame) -> None:
    summary = cost_summary(cost)
    scenarios = list(dict.fromkeys(cost.scenario))
    fig, axes = plt.subplots(1, len(scenarios), figsize=(11, 4.2))
    for ax, scenario in zip(np.atleast_1d(axes), scenarios):
        s = summary[summary.scenario == scenario]
        curve = s[s.algorithm.str.startswith("cats-l")].copy()
        curve["lam"] = curve.algorithm.str[6:].replace("inf", "inf").map(
            lambda v: np.inf if v == "inf" else float(v))
        curve = curve.sort_values("lam")
        ax.plot(curve.metered_MB, curve.mean_s, "-o", color=CATS, label="CATS, sweeping lambda",
                markersize=4)
        # Lambdas that land on the same point share one label: "0.02-0.1".
        span_x = max(curve.metered_MB.max(), 1)
        span_y = max(curve.mean_s.max() - curve.mean_s.min(), 1)
        groups: list[list] = []
        for _, row in curve.iterrows():
            last = groups[-1][-1] if groups else None
            if last is not None and abs(row.metered_MB - last.metered_MB) / span_x < 0.03 and \
                    abs(row.mean_s - last.mean_s) / span_y < 0.03:
                groups[-1].append(row)
            else:
                groups.append([row])
        for group in groups:
            names = ["inf" if np.isinf(r.lam) else f"{r.lam:g}" for r in group]
            text = names[0] if len(names) == 1 else f"{names[0]}-{names[-1]}"
            ax.annotate(f"λ={text}", (group[0].metered_MB, group[0].mean_s),
                        textcoords="offset points", xytext=(6, 6), fontsize=7, color=CATS)
        for alg, marker, label in [("plexo", "s", "Plexo, all networks"),
                                   ("plexo-free", "D", "Plexo, Wi-Fi only")]:
            row = s[s.algorithm == alg].iloc[0]
            ax.plot(row.metered_MB, row.mean_s, marker, color=INK, markersize=7, label=label,
                    linestyle="none", markerfacecolor="white" if alg == "plexo-free" else INK)
        ax.set_xlabel("Metered 4G data used (MB, mean)")
        ax.set_ylabel("Completion time (s, mean)")
        ax.set_title(f"{scenario}, 200 MB file")
        ax.legend(frameon=False, fontsize=8)
    fig.suptitle("Time vs metered data: labels are lambda, the seconds a user would wait to save 1 MB",
                 fontsize=10, color=MUTED)
    fig.savefig(RESULTS / "fig4_cost_pareto.png")
    plt.close(fig)


# --- report -------------------------------------------------------------------------------------


def main() -> None:
    main_df = pd.read_csv(RESULTS / "main.csv")
    cost_df = pd.read_csv(RESULTS / "cost.csv")
    assert main_df.timedOut.sum() == 0 and cost_df.timedOut.sum() == 0, "a run timed out"

    full = paired(main_df, "cats")
    fig_improvement(full)
    fig_ablation(main_df)
    fig_cdf(main_df, "S4-stragglers", 200)
    fig_cdf(main_df, "S3-flaky", 20)
    fig_pareto(cost_df)

    seeds = main_df.seed
    lines = [
        f"# CATS vs Plexo: simulation results ({TCP} TCP model)",
        "",
        f"Held-out seeds {seeds.min()}-{seeds.max()} ({seeds.nunique()} per cell); CATS was developed on seeds 1-50.",
        "Change = CATS / Plexo - 1 per seed; negative means CATS finishes sooner.",
        "",
        "## Completion time, full CATS vs Plexo",
        "",
    ]
    t = full.copy()
    t["median change % [95% CI]"] = t.apply(
        lambda r: f"{r.median_change_pct:+.1f} [{r.ci_low:+.1f}, {r.ci_high:+.1f}]", axis=1)
    t["p (Holm)"] = t.p_holm.map(fmt_p)
    lines.append(md_table(t[["scenario", "sizeMB", "plexo_median_s", "alg_median_s",
                             "median change % [95% CI]", "p95_change_pct", "worst_seed_pct",
                             "win_pct", "loss_over_5pct", "p (Holm)"]]))

    lines += ["", "## Ablation: median change % vs Plexo", ""]
    abl = full[["scenario", "sizeMB"]].copy()
    for alg in ["cats", "cats-noSplit", "cats-noFactor"]:
        abl[alg] = paired(main_df, alg).median_change_pct.to_numpy()
    lines.append(md_table(abl))

    lines += ["", "## Time above the lower bound (mean seconds) and share CATS removes", ""]
    lines.append(md_table(overhead(main_df).reset_index()))

    lines += ["", "## Cost of the work (means over all cells)", ""]
    work = main_df.groupby("algorithm").agg(requests=("requests", "mean"), wasted_MB=("wastedMB", "mean"),
                                            splits=("splits", "mean"), hedges=("hedges", "mean"),
                                            refreshes=("refreshes", "mean")).reset_index()
    lines.append(md_table(work))

    lines += ["", "## Metered 4G priced at lambda (200 MB)", ""]
    lines.append(md_table(cost_summary(cost_df)))
    (RESULTS / "summary.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))
    compare_tcp()


def compare_tcp() -> None:
    """Full CATS vs Plexo under both TCP models, side by side, when both have been run."""
    base = ROOT / "results"
    if not all((base / tcp / "main.csv").exists() for tcp in ("fluid", "slowstart")):
        return
    tables = {tcp: paired(pd.read_csv(base / tcp / "main.csv"), "cats") for tcp in ("fluid", "slowstart")}
    keys = ["scenario", "sizeMB"]
    merged = tables["fluid"][keys].copy()
    for tcp, t in tables.items():
        merged[f"{tcp} median %"] = t.apply(
            lambda r: f"{r.median_change_pct:+.1f} [{r.ci_low:+.1f}, {r.ci_high:+.1f}]", axis=1)
        merged[f"{tcp} win %"] = t.win_pct.round(0)
        merged[f"{tcp} seeds >5% worse"] = t.loss_over_5pct.round(0)
        merged[f"{tcp} p (Holm)"] = t.p_holm.map(fmt_p)
    text = ["# Full CATS vs Plexo: fluid TCP vs TCP with slow start", "",
            "Median paired change in completion time [95% CI]; negative means CATS is faster.", "",
            md_table(merged)]
    (base / "compare_tcp.md").write_text("\n".join(text) + "\n", encoding="utf-8")

    scenarios = list(dict.fromkeys(tables["fluid"].scenario))
    sizes = sorted(tables["fluid"].sizeMB.unique())
    fig, axes = plt.subplots(1, len(sizes), figsize=(13, 3.8), sharey=False)
    x = np.arange(len(scenarios))
    for ax, size in zip(axes, sizes):
        for offset, tcp, color, label in [(-0.2, "fluid", "#8fd3b6", "fluid TCP"),
                                          (0.2, "slowstart", CATS, "with slow start")]:
            t = tables[tcp]
            t = t[t.sizeMB == size].set_index("scenario").loc[scenarios]
            y = t.median_change_pct.to_numpy()
            err = np.vstack([y - t.ci_low.to_numpy(), t.ci_high.to_numpy() - y])
            ax.bar(x + offset, y, 0.4, color=color, label=label, yerr=err,
                   error_kw={"ecolor": INK, "elinewidth": 0.8, "capsize": 2})
        ax.axhline(0, color=INK, linewidth=0.8)
        ax.set_xticks(x, [s.split("-")[0] for s in scenarios])
        ax.set_title(f"{size} MB")
    axes[0].set_ylabel("Completion time vs Plexo (%)\nmedian, 95% CI")
    handles, labels = axes[0].get_legend_handles_labels()
    fig.legend(handles, labels, frameon=False, ncols=2, loc="upper right")
    fig.suptitle("Does the CATS gain survive TCP slow start?", fontweight="bold", color=INK, x=0.3)
    fig.savefig(base / "fig5_fluid_vs_slowstart.png")
    plt.close(fig)
    print("\n".join(text))
    rtt_sensitivity(base / "slowstart")


def rtt_sensitivity(directory: Path) -> None:
    """CATS vs Plexo as every RTT is scaled up, with slow start (src/sensitivity.ts)."""
    path = directory / "rtt_sensitivity.csv"
    if not path.exists():
        return
    d = pd.read_csv(path)
    wide = d.pivot_table(index=["scenario", "rttFactor", "sizeMB", "seed"], columns="algorithm",
                         values="completionS")
    change = (wide["cats"] / wide["plexo"] - 1) * 100
    sizes = sorted(d.sizeMB.unique())
    colors = ["#0b6e4f", "#2f9e75", "#d9822b", "#7b5ea7"]
    fig, axes = plt.subplots(1, len(sizes), figsize=(10, 3.8))
    for ax, size in zip(axes, sizes):
        for color, scenario in zip(colors, dict.fromkeys(d.scenario)):
            factors, mids, lows, highs = [], [], [], []
            for factor in sorted(d.rttFactor.unique()):
                v = change.loc[(scenario, factor, size)].to_numpy()
                low, high = boot_median_ci(v)
                factors.append(factor)
                mids.append(np.median(v))
                lows.append(low)
                highs.append(high)
            ax.errorbar(factors, mids, yerr=[np.subtract(mids, lows), np.subtract(highs, mids)],
                        marker="o", color=color, capsize=3, label=scenario, linewidth=1.6)
        ax.axhline(0, color=INK, linewidth=0.8)
        ax.set_xscale("log")
        ax.set_xticks([1, 4, 10], ["x1", "x4", "x10"])
        ax.minorticks_off()
        ax.set_xlabel("every RTT multiplied by")
        ax.set_title(f"{size} MB")
    axes[0].set_ylabel("Completion time vs Plexo (%)\nmedian, 95% CI")
    axes[1].legend(frameon=False, fontsize=8)
    fig.suptitle("With slow start, as the server moves away", fontweight="bold", color=INK)
    fig.savefig(directory / "fig6_rtt_sensitivity.png")
    plt.close(fig)


if __name__ == "__main__":
    main()
