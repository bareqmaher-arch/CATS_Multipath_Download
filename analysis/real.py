"""The real-network testbed: cats5 against Plexo and the published baselines over real TCP, and
how well the simulator predicted it.

Reads results/real/real-*.csv (testbed/experiment.sh: plexo, cats5, plexo-mux3),
results/real/base-*.csv (testbed/baselines.sh: mph2, mph2-eq) and results/real/sim-twin.csv
(src/real/sim-twin.ts); writes results/real/real.md, fig15 and fig16.

Every comparison is paired by seed: a seed replays the same capacity trace for every algorithm.
Each pair uses the seeds both algorithms finished, so a cell still running for one algorithm
doesn't drop seeds from the others.

Usage: python analysis/real.py
"""

import numpy as np
import pandas as pd
from scipy.stats import spearmanr

from analyze import CATS, INK, MUTED, PLEXO, ROOT, fmt_p, md_table, plt
from round2 import cell, change_table

BASE = ROOT / "results" / "real"
KEYS = ["scenario", "rttFactor", "sizeMB"]
PAIRS = [("cats5", "plexo"), ("cats5", "mph2-eq"), ("cats5", "mph2"), ("cats5", "plexo-mux3"),
         ("mph2-eq", "plexo"), ("plexo-mux3", "plexo")]
COLORS = {"plexo": PLEXO, "mph2-eq": "#7b5ea7", "mph2": "#d9822b", "plexo-mux3": "#8fd3b6"}


def load() -> pd.DataFrame:
    paths = sorted(BASE.glob("real-*.csv")) + sorted(BASE.glob("base-*.csv"))
    return pd.concat([pd.read_csv(p) for p in paths], ignore_index=True)


def pair(df: pd.DataFrame, new: str, base: str, keys: list[str] = KEYS) -> pd.DataFrame:
    """change_table on the seeds where both algorithms finished, per cell."""
    sub = df[df.algorithm.isin([new, base])]
    both = sub.groupby(keys + ["seed"]).algorithm.nunique()
    full = both[both == 2].index
    sub = sub.set_index(keys + ["seed"]).loc[full].reset_index()
    if sub.empty:
        return pd.DataFrame()
    t = change_table(sub, keys, new, base)
    t["seeds"] = sub.groupby(keys).seed.nunique().to_numpy()
    return t


def available(df: pd.DataFrame, new: str, base: str) -> bool:
    return {new, base} <= set(df.algorithm)


def comparison(df: pd.DataFrame) -> pd.DataFrame:
    out = None
    for new, base in PAIRS:
        if not available(df, new, base):
            continue
        t = pair(df, new, base)
        if t.empty:
            continue
        t = t.set_index(KEYS)
        if out is None:
            out = pd.DataFrame(index=t.index)
        out[f"{new} vs {base} % (seeds)"] = t.apply(lambda r: f"{cell(r)} ({r.seeds})", axis=1)
        if new == "cats5" and base in ("plexo", "mph2-eq"):
            out[f"cats5 vs {base}: seeds >5% worse"] = t.worse5.round(0)
            out[f"cats5 vs {base}: p (Holm)"] = t.p_holm.map(fmt_p)
    return out.reset_index()


def scoreboard(df: pd.DataFrame) -> list[str]:
    rows = []
    for new, base in PAIRS:
        if not available(df, new, base):
            continue
        t = pair(df, new, base)
        if t.empty:
            continue
        sig = t.p_holm < 0.05
        rows.append({
            "comparison": f"{new} vs {base}",
            "cells": len(t),
            "seeds per cell": f"{t.seeds.min()}-{t.seeds.max()}",
            "faster (sig.)": int((sig & (t["median"] < 0)).sum()),
            "slower (sig.)": int((sig & (t["median"] > 0)).sum()),
            "no clear difference": int((~sig | (t["median"] == 0)).sum()),
            "median of medians %": round(float(t["median"].median()), 1),
            "best %": round(float(t["median"].min()), 1),
            "worst %": round(float(t["median"].max()), 1),
        })
    return ["## Scoreboard", "", "Holm-corrected Wilcoxon per comparison; negative means the first is faster.",
            "", md_table(pd.DataFrame(rows), "{:.1f}"), ""]


def agreement(real: pd.DataFrame, twin: pd.DataFrame) -> tuple[list[str], pd.DataFrame]:
    """Per cell: the median change the simulator predicted next to the one measured, and how
    well per-seed changes line up."""
    rows = []
    lines = ["## Did the simulator predict the testbed?", ""]
    for new, base in PAIRS:
        if not available(real, new, base):
            continue
        r = pair(real, new, base)
        s = pair(twin[twin.seed.isin(real.seed.unique())], new, base)
        if r.empty or s.empty:
            continue
        merged = r.merge(s, on=KEYS, suffixes=("_real", "_sim"))
        for _, m in merged.iterrows():
            rows.append({"comparison": f"{new} vs {base}", **{k: m[k] for k in KEYS},
                         "simulated median %": m.median_sim, "measured median %": m.median_real})
        if len(merged) >= 3:
            per_seed = seed_agreement(real, twin, new, base)
            if merged.median_sim.nunique() < 2:
                lines.append(f"- {new} vs {base}: the simulator predicts the same change in every "
                             f"cell, so there is no ranking to correlate; seed by seed {per_seed}.")
                continue
            rho, p = spearmanr(merged.median_sim, merged.median_real)
            lines.append(f"- {new} vs {base}: across cells Spearman {rho:.2f} (p = {fmt_p(p)}, "
                         f"{len(merged)} cells); seed by seed {per_seed}.")
    table = pd.DataFrame(rows)
    lines += ["", "Seed by seed is the stricter test: real TCP adds noise a seed does not fix.", "",
              md_table(table, "{:+.1f}"), ""]
    return lines, table


def seed_agreement(real: pd.DataFrame, twin: pd.DataFrame, new: str, base: str) -> str:
    wide_r = real.pivot_table(index=KEYS + ["seed"], columns="algorithm", values="completionS")
    wide_s = twin.pivot_table(index=KEYS + ["seed"], columns="algorithm", values="completionS")
    joined = (wide_r[new] / wide_r[base] - 1).rename("real").to_frame().join(
        (wide_s[new] / wide_s[base] - 1).rename("sim"), how="inner").dropna()
    if len(joined) < 3:
        return "n/a"
    rho, p = spearmanr(joined.real, joined.sim)
    return f"Spearman {rho:.2f} (p = {fmt_p(p)}, {len(joined)} seed-cells)"


def fig_main(real: pd.DataFrame) -> None:
    rivals = [b for n, b in PAIRS if n == "cats5" and available(real, n, b)]
    tables = {b: pair(real, "cats5", b) for b in rivals}
    keys = tables[rivals[0]][KEYS]
    labels = [f"{s.split('-')[0]}\n{z} MB" + (f"\nRTT x{f}" if f != 1 else "")
              for s, f, z in keys.itertuples(index=False)]
    x = np.arange(len(labels))
    width = 0.8 / len(rivals)
    fig, ax = plt.subplots(figsize=(14, 4.6))
    for i, rival in enumerate(rivals):
        t = tables[rival].set_index(KEYS).reindex(pd.MultiIndex.from_frame(keys))
        y = t["median"].to_numpy()
        ax.bar(x + (i - (len(rivals) - 1) / 2) * width, y, width, color=COLORS[rival],
               label=f"cats5 vs {rival}",
               yerr=np.vstack([y - t.low.to_numpy(), t.high.to_numpy() - y]),
               error_kw={"ecolor": INK, "elinewidth": 0.6, "capsize": 1.5})
    ax.axhline(0, color=INK, linewidth=0.8)
    ax.set_xticks(x, labels, fontsize=8)
    ax.set_ylabel("cats5 completion time change (%)\nmedian of paired seeds, 95% CI")
    ax.set_title("Real TCP testbed (netem, nginx, Linux TCP), seeds 6001-6030: below 0 = cats5 faster")
    ax.legend(frameon=False, fontsize=8, ncols=len(rivals), loc="lower left")
    fig.savefig(BASE / "fig15_real_vs_baselines.png")
    plt.close(fig)


def fig_agreement(table: pd.DataFrame) -> None:
    fig, ax = plt.subplots(figsize=(5.6, 5))
    for comparison, color in [("cats5 vs plexo", CATS), ("cats5 vs mph2-eq", "#7b5ea7"),
                              ("cats5 vs mph2", "#d9822b")]:
        t = table[table.comparison == comparison]
        if t.empty:
            continue
        ax.scatter(t["simulated median %"], t["measured median %"], color=color, label=comparison, zorder=3)
    values = pd.concat([table["simulated median %"], table["measured median %"]])
    low, high = values.min() - 3, values.max() + 3
    ax.plot([low, high], [low, high], color=MUTED, linewidth=1, linestyle="--", label="perfect prediction")
    ax.axhline(0, color=INK, linewidth=0.6)
    ax.axvline(0, color=INK, linewidth=0.6)
    ax.set_xlabel("simulator: median change (%)")
    ax.set_ylabel("testbed: median change (%)")
    ax.set_title("Simulator against the testbed, per cell")
    ax.legend(frameon=False, fontsize=8)
    fig.savefig(BASE / "fig16_sim_vs_real.png")
    plt.close(fig)


def main() -> None:
    real = load()
    assert real.timedOut.sum() == 0, "a real run timed out"
    twin = pd.read_csv(BASE / "sim-twin.csv")

    g = real.groupby(KEYS + ["algorithm"])
    costs = pd.DataFrame({
        "runs": g.size(),
        "median s": g.completionS.median(),
        "p90 s": g.completionS.quantile(0.9),
        "max s": g.completionS.max(),
        "requests": g.requests.mean(),
        "app MB": g.appMB.mean(),
        "interface MB": g.ifaceMB.mean(),
        "metered interface MB": g.meteredIfaceMB.mean(),
        "failures": g.failures.mean(),
    }).reset_index()

    lines = [
        "# Real-network testbed: cats5 against Plexo and MP-H2",
        "",
        "cats5 frozen (FROZEN-cats5.sha256, checked at every container start). One privileged",
        "container per scenario: a server and a client namespace joined by one veth pair per",
        "network, netem replaying Sim's capacity trace for the seed every 100 ms with half the RTT",
        "on each side, nginx serving HTTP/1.1 (Plexo) and HTTP/2 by prior knowledge (cats5,",
        "plexo-mux3, mph2, mph2-eq), Linux TCP (CUBIC, slow start after idle on). Algorithms run",
        "in a per-seed shuffled order. Seeds 6001-6030 were never used before. MP-H2 ran in a",
        "second pass over the same seeds and cells (testbed/baselines.sh); a seed replays the same",
        "capacity, so its runs pair with the first pass's.",
        "",
        "Not reproduced here: the per-connection crawling and stalling of S4, server caps (S5, S7),",
        "disks, MPTCP (the WSL2 kernel has none). Wall-clock engine ticks: mean "
        f"{real.meanTickMs.mean():.2f} ms (max {real.meanTickMs.max():.2f}); shaper errors: "
        f"{int(real.shaperErrors.sum())}; runs: {len(real)}.",
        "",
    ]
    lines += scoreboard(real)
    lines += ["## Per cell", "", md_table(comparison(real)), ""]
    agree_lines, table = agreement(real, twin)
    lines += agree_lines
    lines += ["## Requests, bytes and failures per download", "", md_table(costs, "{:.2f}"), ""]
    (BASE / "real.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    fig_main(real)
    fig_agreement(table)
    print("\n".join(lines))


if __name__ == "__main__":
    main()
