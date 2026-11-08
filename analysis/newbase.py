"""cats5 against every baseline on the simulator, seeds 8001-8100: the four added after the
literature review and the ones before them.

  fl, fl-eq          Follower-Leader (Salkintzis, ICC Workshops 2025)
  mdtp, mdtp-eq      MDTP's chunk sizing (Abdollah et al., ICCCN 2025)
  twoway, twoway-eq  two-way download: MPRD (ICDCS 2025) with descending range requests
  rb, rb-eq          dynamic parallel access with end-game copies (Rodriguez, Biersack, ToN 2002)
  mph2, mph2-eq      MP-H2+FS (MobiCom 2019)
  mptcp              MPTCP, idealised
  plexo              Plexo as shipped
The plain name is the paper's own design (one connection per path, or per source); -eq gives it
as many connections as cats5.

Reads results/c-{slowstart,fluid}-{0..3}/ (the sweep is split in four groups of algorithms);
writes results/newbase.md and fig19.

Usage: python analysis/newbase.py
"""

import numpy as np
import pandas as pd

from analyze import INK, ROOT, holm, md_table, plt
from round2 import cell, change_table

BASE = ROOT / "results"
NEW = ["fl", "fl-eq", "mdtp", "mdtp-eq", "twoway", "twoway-eq", "rb", "rb-eq"]
RIVALS = NEW + ["mph2", "mph2-eq", "mptcp", "plexo"]


def load(sweep: str, file: str, prefix: str = "c", groups: int = 4) -> pd.DataFrame:
    parts = [pd.read_csv(BASE / f"{prefix}-{sweep}-{i}" / file) for i in range(groups)]
    df = pd.concat(parts, ignore_index=True)
    if "timedOut" in df and df.timedOut.sum():
        # Kept at the time limit: a lower bound on that run's time, which favours whoever timed out.
        late = df[df.timedOut == 1].groupby(["scenario", "sizeMB", "algorithm"]).size()
        print(f"{prefix}-{sweep}/{file}: runs at the time limit:", late.to_dict())
    return df


def scoreboard(sweeps: dict[str, tuple[pd.DataFrame, list[str]]], focal: str = "cats5",
               rivals: list[str] = RIVALS) -> pd.DataFrame:
    rows = []
    for sweep, (df, keys) in sweeps.items():
        for rival in rivals:
            t = change_table(df, keys, focal, rival)
            sig = t.p_holm < 0.05
            rows.append({
                "sweep": sweep,
                f"{focal} against": rival,
                "cells": len(t),
                "faster (sig.)": int((sig & (t["median"] < 0)).sum()),
                "slower (sig.)": int((sig & (t["median"] > 0)).sum()),
                "no clear difference": int((~sig | (t["median"] == 0)).sum()),
                "median of medians %": round(float(t["median"].median()), 1),
                "best %": round(float(t["median"].min()), 1),
                "worst %": round(float(t["median"].max()), 1),
            })
    return pd.DataFrame(rows)


def strongest(df: pd.DataFrame, keys: list[str], focal: str = "cats5",
              rivals: list[str] = RIVALS) -> pd.DataFrame:
    """Per cell, the baseline with the lowest median time, and the focal algorithm against it."""
    med = df.groupby(keys + ["algorithm"]).completionS.median().unstack()
    best = med[rivals].idxmin(axis=1).rename("strongest baseline")
    out = []
    for cell_keys, rival in best.items():
        cell_keys = cell_keys if isinstance(cell_keys, tuple) else (cell_keys,)
        mask = np.logical_and.reduce([df[k] == v for k, v in zip(keys, cell_keys)])
        t = change_table(df[mask], keys, focal, rival).iloc[0]
        out.append({**dict(zip(keys, cell_keys)), "strongest baseline": rival,
                    f"{focal} vs it %": cell(t), "p": t.p})
    table = pd.DataFrame(out)
    table["p (Holm)"] = [f"{p:.3g}" for p in holm(table.p.tolist())]
    return table.drop(columns="p")


def comparison(df: pd.DataFrame, keys: list[str], rivals: list[str], focal: str = "cats5") -> pd.DataFrame:
    out = None
    for rival in rivals:
        t = change_table(df, keys, focal, rival)
        if out is None:
            out = t[keys].copy()
        out[f"vs {rival} %"] = t.apply(cell, axis=1)
    return out


def fig_heat(slow: pd.DataFrame) -> None:
    keys = ["scenario", "sizeMB"]
    tables = {r: change_table(slow, keys, "cats5", r) for r in RIVALS}
    first = tables[RIVALS[0]]
    labels = [f"{s.split('-')[0]} {z} MB" for s, z in first[keys].itertuples(index=False)]
    grid = np.array([tables[r]["median"].to_numpy() for r in RIVALS])
    sig = np.array([(tables[r].p_holm < 0.05).to_numpy() for r in RIVALS])
    fig, ax = plt.subplots(figsize=(14, 5.6))
    lim = 50
    im = ax.imshow(np.clip(grid, -lim, lim), cmap="RdBu", vmin=-lim, vmax=lim, aspect="auto")
    for i in range(grid.shape[0]):
        for j in range(grid.shape[1]):
            text = f"{grid[i, j]:+.0f}" + ("" if sig[i, j] else "·")
            ax.text(j, i, text, ha="center", va="center", fontsize=6.5,
                    color="white" if abs(grid[i, j]) > 30 else INK)
    ax.set_xticks(range(len(labels)), labels, rotation=60, ha="right", fontsize=7)
    ax.set_yticks(range(len(RIVALS)), [f"vs {r}" for r in RIVALS], fontsize=8)
    ax.set_title("Simulator, slow start, seeds 8001-8100: cats5 completion time change (%), "
                 "median of paired seeds; blue = cats5 faster, · = not significant (Holm)",
                 fontsize=9)
    fig.colorbar(im, ax=ax, shrink=0.8, label="% (clipped at ±50)")
    fig.tight_layout()
    fig.savefig(BASE / "fig19_all_baselines.png", dpi=150)
    plt.close(fig)


def main() -> None:
    fluid = load("fluid", "main.csv")
    slow = load("slowstart", "main.csv")
    rtt = load("slowstart", "rtt_sensitivity.csv")
    main_keys = ["scenario", "sizeMB"]
    rtt_keys = ["scenario", "rttFactor", "sizeMB"]

    board = scoreboard({"fluid": (fluid, main_keys), "slow start": (slow, main_keys),
                        "RTT scaled, slow start": (rtt, rtt_keys)})
    g = slow.groupby(["sizeMB", "algorithm"])
    costs = pd.DataFrame({"requests": g.requests.mean(), "wasted MB": g.wastedMB.mean()}).reset_index()

    lines = [
        "# cats5 against every baseline (simulator)",
        "",
        "Seeds 8001-8100, never used before. cats5 frozen. The four baselines added after the",
        "literature review are implemented from their papers, each with the",
        "assumptions it needed stated at the top of its file in src/baselines/: Follower-Leader",
        "(fl.ts), MDTP's chunk sizing (mdtp.ts), two-way download after MPRD and DEMS (twoway.ts),",
        "Rodriguez and Biersack's dynamic parallel access with end-game copies (rb.ts). The plain",
        "name is the paper's design, one connection per path; -eq has as many connections as cats5.",
        "",
        "Caveat, as before: the simulator draws each connection's quality (q <= 1), which costs the",
        "one-connection-per-path designs more than the many-connection ones; the testbed has none.",
        "",
        "## Scoreboard: cats5 against each baseline",
        "",
        "Holm-corrected Wilcoxon per sweep and baseline; negative is cats5 faster.",
        "",
        md_table(board, "{:.1f}"),
        "",
        "## cats5 against the strongest baseline in each cell (slow start)",
        "",
        "The baseline with the lowest median time in the cell, chosen after the fact (which",
        "favours the baselines).",
        "",
        md_table(strongest(slow, main_keys)),
        "",
        "## cats5 against the strongest baseline in each cell (RTT scaled, slow start)",
        "",
        md_table(strongest(rtt, rtt_keys)),
        "",
        "## Requests and waste per download (slow start)",
        "",
        md_table(costs, "{:.1f}"),
        "",
        "## With slow start: cats5 against the new baselines",
        "",
        md_table(comparison(slow, main_keys, NEW)),
        "",
        "## Every RTT scaled up, with slow start",
        "",
        md_table(comparison(rtt, rtt_keys, NEW)),
        "",
        "## Without slow start",
        "",
        md_table(comparison(fluid, main_keys, NEW)),
        "",
    ]
    (BASE / "newbase.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    fig_heat(slow)
    print("\n".join(lines[:40]))


if __name__ == "__main__":
    main()
