# cats5 against the added baselines on the real testbed

Same testbed, seeds and cells as results/real/real.md; cats5 rerun in the same batch.

## Testbed health

- runs: 3240; timed out: 0; shaper errors: 0
- engine tick: mean 10.00 ms, max 10.19 ms (target 10)

## Scoreboard

Holm-corrected Wilcoxon per baseline over the 12 cells; negative is cats5 faster.

| cats5 against | cells | seeds per cell | faster (sig.) | slower (sig.) | no clear difference | median of medians % | best % | worst % |
|---|---|---|---|---|---|---|---|---|
| fl | 12 | 30-30 | 12 | 0 | 0 | -27.6 | -47.8 | -11.1 |
| fl-eq | 12 | 30-30 | 9 | 0 | 3 | -16.4 | -72.6 | 0.3 |
| mdtp | 12 | 30-30 | 12 | 0 | 0 | -11.0 | -27.2 | -5.5 |
| mdtp-eq | 12 | 30-30 | 12 | 0 | 0 | -21.1 | -72.9 | -3.7 |
| twoway | 12 | 30-30 | 9 | 0 | 3 | -5.5 | -33.9 | 1.0 |
| twoway-eq | 12 | 30-30 | 6 | 3 | 3 | -0.3 | -36.9 | 8.7 |
| rb | 12 | 30-30 | 10 | 0 | 2 | -4.3 | -37.0 | 1.8 |
| rb-eq | 12 | 30-30 | 8 | 2 | 2 | -3.4 | -9.2 | 5.1 |

## Per cell: cats5 change against each, median [95% CI]; · = not significant (Holm)

| scenario | rttFactor | sizeMB | vs fl % | vs fl-eq % | vs mdtp % | vs mdtp-eq % | vs twoway % | vs twoway-eq % | vs rb % | vs rb-eq % |
|---|---|---|---|---|---|---|---|---|---|---|
| S1-stable | 1 | 20 | -17.7 [-18.8, -15.9] | -14.6 [-18.1, -5.2] | -6.0 [-7.5, -4.6] | -14.5 [-18.5, -5.8] | -8.3 [-10.6, -6.9] | +8.7 [+6.4, +10.3] | -3.9 [-5.4, -2.7] | +4.0 [+2.0, +5.9] |
| S1-stable | 1 | 200 | -26.1 [-27.0, -25.3] | -0.3 [-1.5, +0.3] · | -14.4 [-15.1, -13.2] | -4.4 [-9.4, -1.7] | -1.0 [-1.1, -0.6] | +0.8 [+0.3, +1.1] | -3.0 [-3.3, -2.3] | -4.0 [-4.8, -3.3] |
| S1-stable | 4 | 20 | -47.8 [-48.7, -45.9] | -33.2 [-36.1, -29.6] | -21.7 [-23.7, -20.5] | -32.5 [-36.2, -29.7] | -29.0 [-30.2, -27.1] | -12.5 [-14.6, -9.3] | -21.6 [-23.3, -19.2] | -2.0 [-4.8, +0.2] |
| S2-hetero | 1 | 20 | -29.2 [-33.3, -27.6] | -72.6 [-75.7, -69.7] | -10.1 [-10.2, -9.2] | -72.9 [-75.3, -69.6] | -25.1 [-28.3, -24.0] | -30.3 [-34.1, -24.9] | -15.3 [-16.5, -13.7] | -7.8 [-10.7, -6.9] |
| S2-hetero | 1 | 200 | -31.7 [-32.9, -30.1] | -5.5 [-7.9, -2.3] | -11.2 [-12.0, -10.9] | -3.7 [-7.3, -3.0] | -2.5 [-2.6, -1.8] | -0.9 [-1.8, -0.3] | -4.6 [-5.1, -4.2] | -3.0 [-4.0, -2.1] |
| S2-hetero | 4 | 20 | -45.4 [-46.7, -44.2] | -66.0 [-70.5, -62.7] | -14.1 [-15.1, -12.1] | -66.1 [-70.5, -62.8] | -33.9 [-36.2, -31.5] | -36.9 [-41.2, -31.6] | -37.0 [-39.0, -34.5] | -9.2 [-10.6, -8.0] |
| S3-flaky | 1 | 20 | -11.3 [-14.7, -9.5] | -0.4 [-12.3, +2.8] · | -5.5 [-8.1, -2.0] | -9.7 [-18.4, -3.5] | -2.8 [-6.8, -1.9] | +4.8 [-0.9, +7.6] · | +1.8 [-1.6, +3.0] · | +2.1 [-0.7, +3.1] · |
| S3-flaky | 1 | 200 | -20.2 [-21.6, -17.4] | +0.3 [-0.7, +0.7] · | -8.2 [-9.9, -7.2] | -11.8 [-14.5, -5.6] | +1.0 [+0.2, +1.3] · | +0.9 [+0.3, +1.4] · | -1.8 [-2.4, -1.2] | -5.0 [-6.3, -3.6] |
| S3-flaky | 4 | 20 | -39.8 [-42.6, -37.3] | -18.2 [-31.4, -13.5] | -23.9 [-30.3, -17.8] | -17.1 [-32.0, -11.7] | -23.0 [-27.7, -21.8] | -9.4 [-14.1, -2.9] | -12.0 [-14.6, -9.5] | -4.0 [-6.1, -1.2] |
| S6-three | 1 | 20 | -11.1 [-17.5, -9.0] | -27.8 [-32.2, -19.5] | -10.5 [-16.2, -3.1] | -25.1 [-33.2, -20.9] | -1.6 [-4.5, -0.0] · | +6.7 [+1.0, +10.4] | -1.9 [-4.2, +1.0] · | +5.1 [+2.6, +8.4] |
| S6-three | 1 | 200 | -23.0 [-24.5, -21.7] | -1.7 [-3.6, -0.3] | -10.9 [-13.2, -10.3] | -29.9 [-34.1, -22.7] | -0.5 [-0.8, -0.2] · | +0.4 [+0.0, +0.6] · | -2.8 [-3.2, -2.0] | -3.8 [-4.7, -3.1] |
| S6-three | 4 | 20 | -42.9 [-45.4, -41.6] | -37.9 [-42.1, -34.9] | -27.2 [-33.1, -22.0] | -38.2 [-42.0, -35.0] | -33.4 [-35.8, -31.9] | -8.5 [-14.4, -3.7] | -15.3 [-17.2, -13.1] | -1.7 [-4.4, +0.7] · |

## Does the testbed repeat? cats5 in this batch against the first

Same seeds and cells, runs a day apart. Seed by seed Spearman 0.99 (p = <0.001, 360 seed-cells).

| scenario | rttFactor | sizeMB | median s before | median s now | median change % | p |
|---|---|---|---|---|---|---|
| S1-stable | 1 | 20 | 2.10 | 2.05 | -0.62 | 0.72 |
| S1-stable | 1 | 200 | 17.83 | 17.87 | 0.24 | 0.26 |
| S1-stable | 4 | 20 | 2.52 | 2.50 | -1.21 | 0.03 |
| S2-hetero | 1 | 20 | 1.66 | 1.67 | -0.06 | 0.78 |
| S2-hetero | 1 | 200 | 15.44 | 15.47 | 0.06 | 0.84 |
| S2-hetero | 4 | 20 | 2.13 | 2.15 | 0.69 | 0.23 |
| S3-flaky | 1 | 20 | 4.76 | 4.83 | 0.47 | 0.48 |
| S3-flaky | 1 | 200 | 41.09 | 41.28 | 0.01 | 0.82 |
| S3-flaky | 4 | 20 | 5.81 | 5.84 | -0.09 | 0.16 |
| S6-three | 1 | 20 | 2.41 | 2.39 | -1.68 | 0.09 |
| S6-three | 1 | 200 | 19.74 | 19.76 | -0.26 | 0.30 |
| S6-three | 4 | 20 | 2.84 | 2.86 | -0.16 | 0.83 |

## Every algorithm on the testbed: median completion time (s)

Plexo, MP-H2 and plexo-mux3 come from the first batch, the rest from this one, so the
strongest-baseline column compares medians across batches (the check above bounds
how much a batch moves).

| scenario | rttFactor | sizeMB | cats5 | fl | fl-eq | mdtp | mdtp-eq | mph2 | mph2-eq | plexo | plexo-mux3 | rb | rb-eq | twoway | twoway-eq | strongest baseline | cats5 vs it, medians % |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| S1-stable | 1 | 20 | 2.05 | 2.56 | 2.48 | 2.22 | 2.49 | 2.24 | 2.14 | 2.49 | 2.51 | 2.19 | 2.02 | 2.31 | 1.91 | twoway-eq | 7.59 |
| S1-stable | 1 | 200 | 17.87 | 23.96 | 17.89 | 20.79 | 18.52 | 18.27 | 18.16 | 18.11 | 18.53 | 18.30 | 18.57 | 17.92 | 17.76 | twoway-eq | 0.59 |
| S1-stable | 4 | 20 | 2.50 | 4.66 | 3.68 | 3.15 | 3.68 | 3.41 | 2.55 | 3.31 | 3.47 | 3.15 | 2.52 | 3.48 | 2.79 | rb-eq | -1.07 |
| S2-hetero | 1 | 20 | 1.67 | 2.42 | 6.05 | 1.85 | 5.93 | 2.14 | 1.90 | 2.75 | 3.00 | 1.92 | 1.83 | 2.26 | 2.38 | rb-eq | -9.19 |
| S2-hetero | 1 | 200 | 15.47 | 22.49 | 16.37 | 17.40 | 16.38 | 16.24 | 17.05 | 16.22 | 16.35 | 16.21 | 16.01 | 15.77 | 15.68 | twoway-eq | -1.34 |
| S2-hetero | 4 | 20 | 2.15 | 3.95 | 6.28 | 2.52 | 6.25 | 3.10 | 2.77 | 3.43 | 3.21 | 3.37 | 2.33 | 3.27 | 3.48 | rb-eq | -7.88 |
| S3-flaky | 1 | 20 | 4.83 | 5.59 | 4.81 | 5.21 | 5.16 | 5.29 | 5.10 | 4.72 | 4.72 | 4.79 | 4.76 | 5.15 | 4.68 | twoway-eq | 3.11 |
| S3-flaky | 1 | 200 | 41.28 | 50.83 | 41.25 | 44.76 | 46.43 | 42.47 | 44.20 | 41.33 | 41.36 | 41.72 | 43.66 | 41.03 | 41.00 | twoway-eq | 0.69 |
| S3-flaky | 4 | 20 | 5.84 | 9.63 | 7.32 | 7.71 | 7.21 | 6.30 | 6.30 | 6.19 | 6.15 | 6.55 | 6.11 | 7.45 | 6.06 | twoway-eq | -3.71 |
| S6-three | 1 | 20 | 2.39 | 2.76 | 3.40 | 2.62 | 3.35 | 2.50 | 2.48 | 3.13 | 3.12 | 2.46 | 2.26 | 2.46 | 2.29 | rb-eq | 5.73 |
| S6-three | 1 | 200 | 19.76 | 25.78 | 20.38 | 22.07 | 27.30 | 20.18 | 20.85 | 20.27 | 20.22 | 20.43 | 20.53 | 19.86 | 19.68 | twoway-eq | 0.36 |
| S6-three | 4 | 20 | 2.86 | 4.97 | 4.68 | 3.84 | 4.69 | 3.66 | 3.28 | 3.75 | 4.10 | 3.35 | 2.85 | 4.27 | 3.11 | rb-eq | 0.33 |

## Did the simulator predict the testbed?

- cats5 vs fl: across cells Spearman 0.93 (p = <0.001); seed by seed Spearman 0.49 (p = <0.001, 360 seed-cells); median predicted -30.6%, measured -27.6%.
- cats5 vs fl-eq: across cells Spearman 0.97 (p = <0.001); seed by seed Spearman 0.62 (p = <0.001, 360 seed-cells); median predicted -28.2%, measured -16.4%.
- cats5 vs mdtp: across cells Spearman 0.41 (p = 0.183); seed by seed Spearman 0.35 (p = <0.001, 360 seed-cells); median predicted -18.4%, measured -11.0%.
- cats5 vs mdtp-eq: across cells Spearman 0.94 (p = <0.001); seed by seed Spearman 0.55 (p = <0.001, 360 seed-cells); median predicted -33.3%, measured -21.1%.
- cats5 vs twoway: across cells Spearman 0.17 (p = 0.587); seed by seed Spearman 0.15 (p = 0.004, 360 seed-cells); median predicted -8.5%, measured -5.5%.
- cats5 vs twoway-eq: across cells Spearman 0.80 (p = 0.002); seed by seed Spearman 0.53 (p = <0.001, 360 seed-cells); median predicted -12.7%, measured -0.3%.
- cats5 vs rb: across cells Spearman 0.50 (p = 0.095); seed by seed Spearman 0.24 (p = <0.001, 360 seed-cells); median predicted -9.3%, measured -4.3%.
- cats5 vs rb-eq: across cells Spearman 0.73 (p = 0.007); seed by seed Spearman 0.32 (p = <0.001, 360 seed-cells); median predicted +1.1%, measured -3.4%.

## Requests and bytes per download

| sizeMB | algorithm | requests | received MB | copies |
|---|---|---|---|---|
| 20 | cats5 | 47.5 | 22.9 | 7.7 |
| 20 | fl | 30.2 | 20.9 | 0.0 |
| 20 | fl-eq | 20.0 | 20.9 | 0.0 |
| 20 | mdtp | 8.2 | 20.9 | 0.0 |
| 20 | mdtp-eq | 17.8 | 20.9 | 0.0 |
| 20 | rb | 50.2 | 21.6 | 1.8 |
| 20 | rb-eq | 232.2 | 23.9 | 45.5 |
| 20 | twoway | 45.0 | 21.0 | 0.0 |
| 20 | twoway-eq | 197.6 | 21.0 | 0.0 |
| 200 | cats5 | 325.4 | 211.5 | 7.8 |
| 200 | fl | 304.3 | 209.2 | 0.0 |
| 200 | fl-eq | 387.5 | 209.3 | 0.0 |
| 200 | mdtp | 138.1 | 209.2 | 0.0 |
| 200 | mdtp-eq | 130.6 | 209.2 | 0.0 |
| 200 | rb | 171.4 | 212.8 | 1.8 |
| 200 | rb-eq | 533.4 | 222.7 | 44.3 |
| 200 | twoway | 226.4 | 209.4 | 0.0 |
| 200 | twoway-eq | 1641.8 | 209.8 | 0.0 |

