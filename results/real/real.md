# Real-network testbed: cats5 against Plexo and MP-H2

cats5 frozen (FROZEN-cats5.sha256, checked at every container start). One privileged
container per scenario: a server and a client namespace joined by one veth pair per
network, netem replaying Sim's capacity trace for the seed every 100 ms with half the RTT
on each side, nginx serving HTTP/1.1 (Plexo) and HTTP/2 by prior knowledge (cats5,
plexo-mux3, mph2, mph2-eq), Linux TCP (CUBIC, slow start after idle on). Algorithms run
in a per-seed shuffled order. Seeds 6001-6030 were never used before. MP-H2 ran in a
second pass over the same seeds and cells (testbed/baselines.sh); a seed replays the same
capacity, so its runs pair with the first pass's.

Not reproduced here: the per-connection crawling and stalling of S4, server caps (S5, S7),
disks, MPTCP (the WSL2 kernel has none). Wall-clock engine ticks: mean 10.00 ms (max 10.03); shaper errors: 0; runs: 1800.

## Scoreboard

Holm-corrected Wilcoxon per comparison; negative means the first is faster.

| comparison | cells | seeds per cell | faster (sig.) | slower (sig.) | no clear difference | median of medians % | best % | worst % |
|---|---|---|---|---|---|---|---|---|
| cats5 vs plexo | 12 | 30-30 | 10 | 0 | 2 | -9.0 | -40.5 | 1.9 |
| cats5 vs mph2-eq | 12 | 30-30 | 8 | 0 | 4 | -5.3 | -20.2 | -1.6 |
| cats5 vs mph2 | 12 | 30-30 | 11 | 0 | 1 | -6.9 | -32.3 | -1.0 |
| cats5 vs plexo-mux3 | 12 | 30-30 | 11 | 0 | 1 | -9.2 | -44.8 | 0.7 |
| mph2-eq vs plexo | 12 | 30-30 | 6 | 5 | 1 | -5.2 | -29.7 | 6.5 |
| plexo-mux3 vs plexo | 12 | 30-30 | 0 | 1 | 11 | 0.5 | 0.1 | 5.0 |

## Per cell

| scenario | rttFactor | sizeMB | cats5 vs plexo % (seeds) | cats5 vs plexo: seeds >5% worse | cats5 vs plexo: p (Holm) | cats5 vs mph2-eq % (seeds) | cats5 vs mph2-eq: seeds >5% worse | cats5 vs mph2-eq: p (Holm) | cats5 vs mph2 % (seeds) | cats5 vs plexo-mux3 % (seeds) | mph2-eq vs plexo % (seeds) | plexo-mux3 vs plexo % (seeds) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| S1-stable | 1 | 20 | -12.5 [-16.7, -5.6] (30.0) | 7.0 | <0.001 | -1.6 [-2.9, +0.9] (30.0) | 17.0 | 0.266 | -6.9 [-8.9, -4.5] (30.0) | -13.1 [-17.9, -6.1] (30.0) | -11.4 [-14.4, -7.8] (30.0) | +0.6 [+0.4, +1.0] (30.0) |
| S1-stable | 1 | 200 | -1.5 [-2.6, -1.1] (30.0) | 0.0 | <0.001 | -3.4 [-5.9, -1.6] (30.0) | 0.0 | <0.001 | -1.7 [-2.6, -1.5] (30.0) | -2.7 [-3.6, -1.9] (30.0) | +1.4 [+0.5, +3.1] (30.0) | +0.7 [+0.3, +1.8] (30.0) |
| S1-stable | 4 | 20 | -22.1 [-28.4, -16.1] (30.0) | 0.0 | <0.001 | -3.5 [-5.3, +1.2] (30.0) | 20.0 | 0.198 | -26.8 [-27.7, -24.0] (30.0) | -27.7 [-29.6, -25.5] (30.0) | -19.7 [-26.6, -16.8] (30.0) | +2.1 [-0.3, +17.5] (30.0) |
| S2-hetero | 1 | 20 | -40.5 [-48.5, -36.3] (30.0) | 0.0 | <0.001 | -14.2 [-18.6, -9.7] (30.0) | 0.0 | <0.001 | -22.6 [-23.5, -19.8] (30.0) | -44.8 [-51.8, -37.9] (30.0) | -29.7 [-45.3, -24.3] (30.0) | +0.5 [-0.8, +2.5] (30.0) |
| S2-hetero | 1 | 200 | -5.1 [-6.2, -3.6] (30.0) | 0.0 | <0.001 | -10.2 [-14.2, -5.9] (30.0) | 0.0 | <0.001 | -4.5 [-8.4, -2.7] (30.0) | -5.4 [-6.7, -4.5] (30.0) | +6.5 [+1.1, +13.6] (30.0) | +0.5 [-0.8, +2.3] (30.0) |
| S2-hetero | 4 | 20 | -35.8 [-42.3, -28.6] (30.0) | 3.0 | <0.001 | -20.2 [-25.8, -14.4] (30.0) | 3.0 | <0.001 | -32.3 [-33.9, -30.0] (30.0) | -36.0 [-42.1, -31.4] (30.0) | -17.1 [-30.2, -6.9] (30.0) | +4.6 [+3.9, +5.6] (30.0) |
| S3-flaky | 1 | 20 | +1.9 [-1.4, +5.2] (30.0) | 37.0 | 1.000 | -4.1 [-10.5, +1.5] (30.0) | 20.0 | 0.094 | -6.9 [-11.5, -3.8] (30.0) | +0.7 [-3.8, +5.0] (30.0) | +4.1 [-2.0, +14.6] (30.0) | +0.2 [-0.6, +1.5] (30.0) |
| S3-flaky | 1 | 200 | -0.4 [-1.2, +0.1] (30.0) | 0.0 | 0.055 | -4.3 [-8.2, -2.0] (30.0) | 0.0 | <0.001 | -1.0 [-2.1, -0.4] (30.0) | -0.7 [-1.1, -0.1] (30.0) | +3.8 [+1.6, +8.1] (30.0) | +0.1 [-0.7, +0.6] (30.0) |
| S3-flaky | 4 | 20 | -5.4 [-11.5, -1.6] (30.0) | 17.0 | 0.006 | -6.4 [-14.6, +0.5] (30.0) | 17.0 | 0.036 | -9.6 [-11.3, -8.0] (30.0) | -3.1 [-9.7, +0.7] (30.0) | +1.0 [-4.4, +6.2] (30.0) | +0.3 [-3.5, +1.0] (30.0) |
| S6-three | 1 | 20 | -20.2 [-25.2, -17.6] (30.0) | 0.0 | <0.001 | -2.8 [-4.3, -0.7] (30.0) | 20.0 | 0.266 | -1.2 [-6.7, +1.1] (30.0) | -19.8 [-26.0, -17.1] (30.0) | -19.8 [-24.4, -17.4] (30.0) | +0.3 [-1.3, +0.5] (30.0) |
| S6-three | 1 | 200 | -2.6 [-3.7, -1.1] (30.0) | 0.0 | <0.001 | -6.3 [-8.6, -3.8] (30.0) | 0.0 | <0.001 | -2.3 [-4.4, -1.5] (30.0) | -2.6 [-3.3, -1.9] (30.0) | +4.4 [+1.3, +7.8] (30.0) | +0.4 [-0.7, +1.3] (30.0) |
| S6-three | 4 | 20 | -25.8 [-28.0, -24.3] (30.0) | 0.0 | <0.001 | -13.7 [-19.8, -10.2] (30.0) | 7.0 | <0.001 | -23.4 [-24.7, -20.2] (30.0) | -28.4 [-31.7, -27.1] (30.0) | -12.4 [-16.3, -6.5] (30.0) | +5.0 [+2.0, +8.9] (30.0) |

## Did the simulator predict the testbed?

- cats5 vs plexo: across cells Spearman 0.88 (p = <0.001, 12 cells); seed by seed Spearman 0.76 (p = <0.001, 360 seed-cells).
- cats5 vs mph2-eq: across cells Spearman 0.17 (p = 0.602, 12 cells); seed by seed Spearman 0.13 (p = 0.012, 360 seed-cells).
- cats5 vs mph2: across cells Spearman -0.32 (p = 0.308, 12 cells); seed by seed Spearman -0.04 (p = 0.446, 360 seed-cells).
- cats5 vs plexo-mux3: across cells Spearman 0.87 (p = <0.001, 12 cells); seed by seed Spearman 0.74 (p = <0.001, 360 seed-cells).
- mph2-eq vs plexo: across cells Spearman 0.87 (p = <0.001, 12 cells); seed by seed Spearman 0.50 (p = <0.001, 360 seed-cells).
- plexo-mux3 vs plexo: the simulator predicts the same change in every cell, so there is no ranking to correlate; seed by seed Spearman -0.03 (p = 0.630, 360 seed-cells).

Seed by seed is the stricter test: real TCP adds noise a seed does not fix.

| comparison | scenario | rttFactor | sizeMB | simulated median % | measured median % |
|---|---|---|---|---|---|
| cats5 vs plexo | S1-stable | 1 | 20 | -15.8 | -12.5 |
| cats5 vs plexo | S1-stable | 1 | 200 | -5.6 | -1.5 |
| cats5 vs plexo | S1-stable | 4 | 20 | -13.5 | -22.1 |
| cats5 vs plexo | S2-hetero | 1 | 20 | -39.2 | -40.5 |
| cats5 vs plexo | S2-hetero | 1 | 200 | -4.0 | -5.1 |
| cats5 vs plexo | S2-hetero | 4 | 20 | -33.2 | -35.8 |
| cats5 vs plexo | S3-flaky | 1 | 20 | +0.3 | +1.9 |
| cats5 vs plexo | S3-flaky | 1 | 200 | -2.5 | -0.4 |
| cats5 vs plexo | S3-flaky | 4 | 20 | +0.1 | -5.4 |
| cats5 vs plexo | S6-three | 1 | 20 | -20.4 | -20.2 |
| cats5 vs plexo | S6-three | 1 | 200 | -4.7 | -2.6 |
| cats5 vs plexo | S6-three | 4 | 20 | -20.7 | -25.8 |
| cats5 vs mph2-eq | S1-stable | 1 | 20 | +7.8 | -1.6 |
| cats5 vs mph2-eq | S1-stable | 1 | 200 | +0.9 | -3.4 |
| cats5 vs mph2-eq | S1-stable | 4 | 20 | +5.5 | -3.5 |
| cats5 vs mph2-eq | S2-hetero | 1 | 20 | -0.6 | -14.2 |
| cats5 vs mph2-eq | S2-hetero | 1 | 200 | -0.6 | -10.2 |
| cats5 vs mph2-eq | S2-hetero | 4 | 20 | +8.0 | -20.2 |
| cats5 vs mph2-eq | S3-flaky | 1 | 20 | +2.0 | -4.1 |
| cats5 vs mph2-eq | S3-flaky | 1 | 200 | +0.0 | -4.3 |
| cats5 vs mph2-eq | S3-flaky | 4 | 20 | +5.4 | -6.4 |
| cats5 vs mph2-eq | S6-three | 1 | 20 | +3.2 | -2.8 |
| cats5 vs mph2-eq | S6-three | 1 | 200 | +0.3 | -6.3 |
| cats5 vs mph2-eq | S6-three | 4 | 20 | +4.3 | -13.7 |
| cats5 vs mph2 | S1-stable | 1 | 20 | +3.3 | -6.9 |
| cats5 vs mph2 | S1-stable | 1 | 200 | -6.3 | -1.7 |
| cats5 vs mph2 | S1-stable | 4 | 20 | -3.6 | -26.8 |
| cats5 vs mph2 | S2-hetero | 1 | 20 | -4.1 | -22.6 |
| cats5 vs mph2 | S2-hetero | 1 | 200 | -7.0 | -4.5 |
| cats5 vs mph2 | S2-hetero | 4 | 20 | -3.5 | -32.3 |
| cats5 vs mph2 | S3-flaky | 1 | 20 | +0.9 | -6.9 |
| cats5 vs mph2 | S3-flaky | 1 | 200 | -20.6 | -1.0 |
| cats5 vs mph2 | S3-flaky | 4 | 20 | -4.5 | -9.6 |
| cats5 vs mph2 | S6-three | 1 | 20 | +7.0 | -1.2 |
| cats5 vs mph2 | S6-three | 1 | 200 | -8.0 | -2.3 |
| cats5 vs mph2 | S6-three | 4 | 20 | -3.3 | -23.4 |
| cats5 vs plexo-mux3 | S1-stable | 1 | 20 | -15.8 | -13.1 |
| cats5 vs plexo-mux3 | S1-stable | 1 | 200 | -5.6 | -2.7 |
| cats5 vs plexo-mux3 | S1-stable | 4 | 20 | -13.5 | -27.7 |
| cats5 vs plexo-mux3 | S2-hetero | 1 | 20 | -39.2 | -44.8 |
| cats5 vs plexo-mux3 | S2-hetero | 1 | 200 | -4.0 | -5.4 |
| cats5 vs plexo-mux3 | S2-hetero | 4 | 20 | -33.2 | -36.0 |
| cats5 vs plexo-mux3 | S3-flaky | 1 | 20 | -0.1 | +0.7 |
| cats5 vs plexo-mux3 | S3-flaky | 1 | 200 | -2.5 | -0.7 |
| cats5 vs plexo-mux3 | S3-flaky | 4 | 20 | +0.1 | -3.1 |
| cats5 vs plexo-mux3 | S6-three | 1 | 20 | -20.4 | -19.8 |
| cats5 vs plexo-mux3 | S6-three | 1 | 200 | -4.7 | -2.6 |
| cats5 vs plexo-mux3 | S6-three | 4 | 20 | -20.7 | -28.4 |
| mph2-eq vs plexo | S1-stable | 1 | 20 | -19.7 | -11.4 |
| mph2-eq vs plexo | S1-stable | 1 | 200 | -6.2 | +1.4 |
| mph2-eq vs plexo | S1-stable | 4 | 20 | -18.1 | -19.7 |
| mph2-eq vs plexo | S2-hetero | 1 | 20 | -36.9 | -29.7 |
| mph2-eq vs plexo | S2-hetero | 1 | 200 | -2.1 | +6.5 |
| mph2-eq vs plexo | S2-hetero | 4 | 20 | -36.1 | -17.1 |
| mph2-eq vs plexo | S3-flaky | 1 | 20 | -3.1 | +4.1 |
| mph2-eq vs plexo | S3-flaky | 1 | 200 | -2.0 | +3.8 |
| mph2-eq vs plexo | S3-flaky | 4 | 20 | -4.6 | +1.0 |
| mph2-eq vs plexo | S6-three | 1 | 20 | -21.9 | -19.8 |
| mph2-eq vs plexo | S6-three | 1 | 200 | -4.0 | +4.4 |
| mph2-eq vs plexo | S6-three | 4 | 20 | -22.7 | -12.4 |
| plexo-mux3 vs plexo | S1-stable | 1 | 20 | +0.0 | +0.6 |
| plexo-mux3 vs plexo | S1-stable | 1 | 200 | +0.0 | +0.7 |
| plexo-mux3 vs plexo | S1-stable | 4 | 20 | +0.0 | +2.1 |
| plexo-mux3 vs plexo | S2-hetero | 1 | 20 | +0.0 | +0.5 |
| plexo-mux3 vs plexo | S2-hetero | 1 | 200 | +0.0 | +0.5 |
| plexo-mux3 vs plexo | S2-hetero | 4 | 20 | +0.0 | +4.6 |
| plexo-mux3 vs plexo | S3-flaky | 1 | 20 | +0.0 | +0.2 |
| plexo-mux3 vs plexo | S3-flaky | 1 | 200 | +0.0 | +0.1 |
| plexo-mux3 vs plexo | S3-flaky | 4 | 20 | +0.0 | +0.3 |
| plexo-mux3 vs plexo | S6-three | 1 | 20 | +0.0 | +0.3 |
| plexo-mux3 vs plexo | S6-three | 1 | 200 | +0.0 | +0.4 |
| plexo-mux3 vs plexo | S6-three | 4 | 20 | +0.0 | +5.0 |

## Requests, bytes and failures per download

| scenario | rttFactor | sizeMB | algorithm | runs | median s | p90 s | max s | requests | app MB | interface MB | metered interface MB | failures |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| S1-stable | 1 | 20 | cats5 | 30 | 2.10 | 2.28 | 2.40 | 46.73 | 21.49 | 23.67 | 8.16 | 0.00 |
| S1-stable | 1 | 20 | mph2 | 30 | 2.24 | 2.41 | 2.49 | 45.90 | 20.00 | 20.95 | 6.81 | 0.00 |
| S1-stable | 1 | 20 | mph2-eq | 30 | 2.14 | 2.32 | 2.44 | 138.27 | 20.00 | 20.98 | 7.49 | 0.00 |
| S1-stable | 1 | 20 | plexo | 30 | 2.49 | 2.96 | 3.47 | 20.00 | 20.00 | 20.92 | 8.78 | 0.00 |
| S1-stable | 1 | 20 | plexo-mux3 | 30 | 2.51 | 2.87 | 3.50 | 39.03 | 20.00 | 20.96 | 8.78 | 0.00 |
| S1-stable | 1 | 200 | cats5 | 30 | 17.83 | 19.73 | 22.55 | 303.07 | 200.91 | 211.17 | 69.28 | 0.00 |
| S1-stable | 1 | 200 | mph2 | 30 | 18.27 | 20.34 | 24.08 | 132.67 | 200.00 | 209.38 | 68.60 | 0.00 |
| S1-stable | 1 | 200 | mph2-eq | 30 | 18.16 | 21.37 | 23.24 | 332.13 | 200.00 | 209.57 | 71.26 | 0.00 |
| S1-stable | 1 | 200 | plexo | 30 | 18.11 | 20.04 | 22.90 | 129.33 | 200.29 | 209.57 | 69.82 | 0.00 |
| S1-stable | 1 | 200 | plexo-mux3 | 30 | 18.53 | 20.02 | 23.15 | 325.10 | 200.26 | 209.98 | 70.05 | 0.00 |
| S1-stable | 4 | 20 | cats5 | 30 | 2.52 | 2.68 | 2.80 | 45.53 | 20.94 | 22.74 | 6.58 | 0.00 |
| S1-stable | 4 | 20 | mph2 | 30 | 3.41 | 3.54 | 8.88 | 32.67 | 20.00 | 20.95 | 4.75 | 0.00 |
| S1-stable | 4 | 20 | mph2-eq | 30 | 2.55 | 2.86 | 3.02 | 90.87 | 20.00 | 20.98 | 6.00 | 0.00 |
| S1-stable | 4 | 20 | plexo | 30 | 3.31 | 3.68 | 3.94 | 22.07 | 20.27 | 21.39 | 7.71 | 0.00 |
| S1-stable | 4 | 20 | plexo-mux3 | 30 | 3.47 | 3.67 | 4.03 | 41.83 | 20.23 | 21.61 | 8.07 | 0.00 |
| S2-hetero | 1 | 20 | cats5 | 30 | 1.66 | 1.82 | 1.94 | 46.70 | 20.31 | 21.73 | 3.01 | 0.00 |
| S2-hetero | 1 | 20 | mph2 | 30 | 2.14 | 2.35 | 2.42 | 41.43 | 20.00 | 20.95 | 3.24 | 0.00 |
| S2-hetero | 1 | 20 | mph2-eq | 30 | 1.90 | 2.39 | 2.54 | 137.77 | 20.00 | 20.99 | 3.07 | 0.00 |
| S2-hetero | 1 | 20 | plexo | 30 | 2.75 | 3.82 | 5.06 | 25.87 | 20.37 | 21.55 | 5.20 | 0.00 |
| S2-hetero | 1 | 20 | plexo-mux3 | 30 | 3.00 | 3.86 | 4.08 | 45.20 | 20.39 | 21.78 | 5.41 | 0.00 |
| S2-hetero | 1 | 200 | cats5 | 30 | 15.44 | 16.80 | 18.90 | 242.77 | 200.38 | 210.33 | 27.95 | 0.00 |
| S2-hetero | 1 | 200 | mph2 | 30 | 16.24 | 18.87 | 21.63 | 129.57 | 200.00 | 209.38 | 29.12 | 0.00 |
| S2-hetero | 1 | 200 | mph2-eq | 30 | 17.05 | 20.66 | 23.94 | 327.53 | 200.00 | 209.66 | 30.53 | 0.00 |
| S2-hetero | 1 | 200 | plexo | 30 | 16.22 | 17.73 | 20.13 | 132.20 | 200.32 | 209.68 | 29.19 | 0.00 |
| S2-hetero | 1 | 200 | plexo-mux3 | 30 | 16.35 | 17.78 | 20.48 | 286.13 | 200.30 | 210.42 | 29.48 | 0.00 |
| S2-hetero | 4 | 20 | cats5 | 30 | 2.13 | 2.33 | 6.76 | 45.97 | 20.47 | 22.19 | 3.23 | 0.00 |
| S2-hetero | 4 | 20 | mph2 | 30 | 3.10 | 3.45 | 8.88 | 32.63 | 20.00 | 20.96 | 2.49 | 0.00 |
| S2-hetero | 4 | 20 | mph2-eq | 30 | 2.77 | 3.44 | 5.40 | 89.03 | 20.00 | 21.01 | 3.40 | 0.00 |
| S2-hetero | 4 | 20 | plexo | 30 | 3.43 | 4.01 | 4.37 | 26.40 | 20.64 | 22.15 | 4.79 | 0.00 |
| S2-hetero | 4 | 20 | plexo-mux3 | 30 | 3.21 | 4.18 | 4.40 | 46.83 | 20.64 | 22.47 | 5.15 | 0.00 |
| S3-flaky | 1 | 20 | cats5 | 30 | 4.76 | 6.12 | 7.42 | 45.87 | 21.09 | 22.67 | 9.18 | 0.00 |
| S3-flaky | 1 | 20 | mph2 | 30 | 5.29 | 7.46 | 15.59 | 46.50 | 20.00 | 20.95 | 9.18 | 0.00 |
| S3-flaky | 1 | 20 | mph2-eq | 30 | 5.10 | 8.03 | 21.13 | 115.33 | 20.00 | 21.01 | 9.26 | 0.00 |
| S3-flaky | 1 | 20 | plexo | 30 | 4.72 | 6.30 | 7.86 | 22.27 | 20.28 | 21.35 | 8.72 | 0.00 |
| S3-flaky | 1 | 20 | plexo-mux3 | 30 | 4.72 | 6.23 | 8.03 | 41.47 | 20.25 | 21.36 | 8.68 | 0.00 |
| S3-flaky | 1 | 200 | cats5 | 30 | 41.09 | 49.23 | 55.39 | 387.30 | 201.42 | 211.75 | 88.25 | 0.00 |
| S3-flaky | 1 | 200 | mph2 | 30 | 42.47 | 50.20 | 57.33 | 134.20 | 200.00 | 209.38 | 87.92 | 0.00 |
| S3-flaky | 1 | 200 | mph2-eq | 30 | 44.20 | 54.95 | 66.37 | 302.60 | 200.00 | 209.77 | 92.12 | 0.00 |
| S3-flaky | 1 | 200 | plexo | 30 | 41.33 | 49.66 | 55.33 | 131.37 | 200.76 | 210.23 | 87.35 | 0.00 |
| S3-flaky | 1 | 200 | plexo-mux3 | 30 | 41.36 | 50.01 | 55.36 | 377.70 | 200.80 | 210.75 | 87.84 | 0.00 |
| S3-flaky | 4 | 20 | cats5 | 30 | 5.81 | 7.48 | 8.16 | 48.90 | 21.25 | 23.08 | 8.07 | 0.00 |
| S3-flaky | 4 | 20 | mph2 | 30 | 6.30 | 8.61 | 22.23 | 22.70 | 20.00 | 20.95 | 6.52 | 0.00 |
| S3-flaky | 4 | 20 | mph2-eq | 30 | 6.30 | 10.57 | 23.87 | 79.47 | 20.00 | 21.02 | 7.95 | 0.00 |
| S3-flaky | 4 | 20 | plexo | 30 | 6.19 | 7.90 | 10.05 | 24.60 | 20.65 | 22.00 | 7.91 | 0.00 |
| S3-flaky | 4 | 20 | plexo-mux3 | 30 | 6.15 | 7.41 | 8.84 | 45.37 | 20.60 | 22.15 | 8.07 | 0.00 |
| S6-three | 1 | 20 | cats5 | 30 | 2.41 | 2.67 | 3.38 | 54.00 | 22.27 | 24.90 | 11.53 | 0.00 |
| S6-three | 1 | 20 | mph2 | 30 | 2.50 | 2.83 | 3.82 | 51.40 | 20.00 | 20.95 | 10.13 | 0.00 |
| S6-three | 1 | 20 | mph2-eq | 30 | 2.48 | 2.67 | 4.46 | 158.70 | 20.00 | 21.00 | 10.43 | 0.00 |
| S6-three | 1 | 20 | plexo | 30 | 3.13 | 3.62 | 3.90 | 21.83 | 20.45 | 21.50 | 12.56 | 0.00 |
| S6-three | 1 | 20 | plexo-mux3 | 30 | 3.12 | 3.70 | 4.04 | 42.13 | 20.56 | 21.76 | 12.74 | 0.00 |
| S6-three | 1 | 200 | cats5 | 30 | 19.74 | 21.94 | 24.36 | 370.80 | 201.90 | 212.97 | 93.92 | 0.00 |
| S6-three | 1 | 200 | mph2 | 30 | 20.18 | 23.81 | 28.19 | 138.23 | 200.00 | 209.38 | 94.07 | 0.00 |
| S6-three | 1 | 200 | mph2-eq | 30 | 20.85 | 25.09 | 25.69 | 413.17 | 200.00 | 209.68 | 96.68 | 0.00 |
| S6-three | 1 | 200 | plexo | 30 | 20.27 | 22.49 | 24.38 | 193.57 | 200.24 | 209.58 | 93.88 | 0.00 |
| S6-three | 1 | 200 | plexo-mux3 | 30 | 20.22 | 22.77 | 25.30 | 385.07 | 200.25 | 210.17 | 94.37 | 0.00 |
| S6-three | 4 | 20 | cats5 | 30 | 2.84 | 3.05 | 3.10 | 46.47 | 20.84 | 22.67 | 8.12 | 0.00 |
| S6-three | 4 | 20 | mph2 | 30 | 3.66 | 3.90 | 5.60 | 39.33 | 20.00 | 20.97 | 7.07 | 0.00 |
| S6-three | 4 | 20 | mph2-eq | 30 | 3.28 | 3.69 | 5.48 | 110.77 | 20.00 | 21.02 | 9.32 | 0.00 |
| S6-three | 4 | 20 | plexo | 30 | 3.75 | 4.23 | 5.21 | 26.13 | 20.87 | 22.41 | 11.76 | 0.00 |
| S6-three | 4 | 20 | plexo-mux3 | 30 | 4.10 | 4.75 | 5.84 | 45.53 | 21.02 | 22.79 | 12.51 | 0.00 |

