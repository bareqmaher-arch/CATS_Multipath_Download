# cats7 on the real testbed

Seeds 6101-6130, never used before; same cells as results/real/real.md; every
algorithm in one batch, interleaved seed by seed.

## Testbed health

- runs: 2520; timed out: 0; shaper errors: 0
- engine tick: mean 10.00 ms, max 10.03 ms (target 10)

## Scoreboard

Holm-corrected Wilcoxon over the 12 cells; negative is cats7 faster.

| cats7 against | cells | seeds per cell | faster (sig.) | slower (sig.) | no clear difference | median of medians % | best % | worst % |
|---|---|---|---|---|---|---|---|---|
| cats6 | 12 | 30-30 | 0 | 2 | 10 | 0.6 | -1.3 | 13.6 |
| cats5 | 12 | 30-30 | 2 | 7 | 3 | 2.0 | -5.1 | 5.1 |
| rb-eq | 12 | 30-30 | 6 | 2 | 4 | -1.2 | -13.1 | 10.7 |
| twoway-eq | 12 | 30-30 | 3 | 6 | 3 | 2.0 | -38.5 | 3.9 |
| mph2-eq | 12 | 30-30 | 9 | 0 | 3 | -5.4 | -29.7 | -0.7 |
| plexo | 12 | 30-30 | 6 | 1 | 5 | -11.2 | -37.4 | 1.2 |

## Per cell, median [95% CI]; ns = not significant (Holm)

| scenario | rttFactor | sizeMB | vs cats6 % | vs cats5 % | vs rb-eq % | vs twoway-eq % | vs mph2-eq % | vs plexo % |
|---|---|---|---|---|---|---|---|---|
| S1-stable | 1 | 20 | -0.5 [-2.8, +2.4] ns | -2.0 [-5.9, +0.2] ns | -0.8 [-1.7, +1.7] ns | +3.9 [+2.6, +7.0] | -5.3 [-7.4, -2.3] | -18.3 [-22.3, -11.2] |
| S1-stable | 1 | 200 | +0.7 [-1.0, +1.5] ns | +2.6 [+1.8, +4.0] | -2.3 [-3.1, -0.8] | +3.6 [+2.2, +4.0] | -0.7 [-1.5, +0.9] ns | +1.2 [+0.2, +2.0] ns |
| S1-stable | 4 | 20 | +3.9 [+0.8, +4.8] | -0.6 [-2.6, +2.1] ns | -4.7 [-7.1, -1.9] | -13.2 [-15.4, -9.3] | -5.4 [-7.6, -2.1] | -19.4 [-23.7, -16.6] |
| S2-hetero | 1 | 20 | +1.5 [+0.6, +4.0] ns | +2.3 [+0.9, +3.9] | -6.6 [-7.3, -3.5] | -30.7 [-35.5, -25.0] | -19.2 [-23.5, -11.8] | -37.4 [-45.8, -34.0] |
| S2-hetero | 1 | 200 | +0.2 [-0.5, +2.4] ns | +4.6 [+2.6, +5.9] | +0.5 [-1.1, +1.7] ns | +2.0 [+1.4, +3.2] | -5.3 [-10.2, -2.6] | +0.4 [-2.0, +3.1] ns |
| S2-hetero | 4 | 20 | +2.5 [-0.0, +4.7] ns | -3.1 [-4.9, -1.7] | -13.1 [-16.0, -11.7] | -38.5 [-43.5, -34.8] | -29.7 [-33.9, -24.1] | -32.3 [-36.5, -28.0] |
| S3-flaky | 1 | 20 | +0.5 [-1.8, +3.2] ns | -1.8 [-2.3, +1.5] ns | +0.7 [-1.4, +3.0] ns | +3.2 [+0.8, +4.3] | -3.2 [-5.3, -0.3] | -1.8 [-4.4, +1.6] ns |
| S3-flaky | 1 | 200 | -0.2 [-0.7, +0.7] ns | +1.6 [+1.0, +2.1] | -2.7 [-4.0, -1.5] | +1.9 [+1.7, +2.8] | -1.9 [-4.9, -1.5] | +0.9 [+0.6, +1.9] |
| S3-flaky | 4 | 20 | +4.5 [+0.0, +8.6] ns | +2.5 [+0.5, +8.5] | +2.0 [-2.0, +5.1] ns | -3.4 [-8.1, -0.9] ns | -2.9 [-6.8, +0.7] ns | -4.6 [-8.9, +4.8] ns |
| S6-three | 1 | 20 | -1.3 [-4.5, +1.7] ns | -5.1 [-7.6, -1.2] | +3.2 [+0.4, +4.9] | +3.6 [+1.0, +6.4] ns | -6.5 [-8.5, -0.2] | -25.4 [-28.6, -20.6] |
| S6-three | 1 | 200 | -0.6 [-2.3, +0.4] ns | +2.7 [+1.5, +3.1] | -1.7 [-2.7, -0.4] | +2.3 [+1.5, +3.4] | -5.4 [-9.1, -3.9] | +0.8 [-0.8, +1.8] ns |
| S6-three | 4 | 20 | +13.6 [+7.9, +22.4] | +5.1 [+1.1, +17.4] | +10.7 [+4.1, +14.3] | -4.0 [-7.5, +4.0] ns | -7.1 [-10.6, -3.3] ns | -17.8 [-24.4, -14.2] |

## Median completion time (s)

| scenario | rttFactor | sizeMB | cats5 | cats6 | cats7 | mph2-eq | plexo | rb-eq | twoway-eq |
|---|---|---|---|---|---|---|---|---|---|
| S1-stable | 1 | 20 | 2.07 | 2.06 | 2.05 | 2.16 | 2.47 | 2.06 | 1.96 |
| S1-stable | 1 | 200 | 17.41 | 17.86 | 18.52 | 18.58 | 17.73 | 18.24 | 17.30 |
| S1-stable | 4 | 20 | 2.50 | 2.42 | 2.44 | 2.65 | 3.17 | 2.58 | 2.82 |
| S2-hetero | 1 | 20 | 1.66 | 1.67 | 1.70 | 2.07 | 2.89 | 1.83 | 2.36 |
| S2-hetero | 1 | 200 | 15.24 | 15.84 | 15.77 | 17.15 | 15.98 | 15.87 | 15.59 |
| S2-hetero | 4 | 20 | 2.17 | 2.06 | 2.08 | 2.91 | 3.11 | 2.48 | 3.48 |
| S3-flaky | 1 | 20 | 4.94 | 4.71 | 4.91 | 5.08 | 5.12 | 4.86 | 4.71 |
| S3-flaky | 1 | 200 | 42.58 | 43.38 | 43.19 | 44.42 | 42.28 | 44.36 | 42.40 |
| S3-flaky | 4 | 20 | 5.72 | 5.82 | 6.10 | 6.30 | 6.23 | 5.95 | 6.42 |
| S6-three | 1 | 20 | 2.50 | 2.39 | 2.37 | 2.55 | 3.08 | 2.34 | 2.32 |
| S6-three | 1 | 200 | 19.60 | 20.40 | 20.02 | 21.42 | 19.88 | 20.57 | 19.61 |
| S6-three | 4 | 20 | 2.94 | 2.79 | 3.11 | 3.32 | 3.87 | 2.91 | 3.21 |

## Did the simulator predict the testbed?

- cats7 vs cats6: across cells Spearman 0.18 (p = 0.584); seed by seed Spearman 0.02 (p = 0.679, 360 seed-cells); median predicted -0.2%, measured +0.6%.
- cats7 vs cats5: across cells Spearman 0.69 (p = 0.013); seed by seed Spearman 0.25 (p = <0.001, 360 seed-cells); median predicted -2.6%, measured +2.0%.
- cats7 vs rb-eq: across cells Spearman 0.74 (p = 0.006); seed by seed Spearman 0.25 (p = <0.001, 360 seed-cells); median predicted -2.2%, measured -1.2%.
- cats7 vs twoway-eq: across cells Spearman 0.75 (p = 0.005); seed by seed Spearman 0.50 (p = <0.001, 360 seed-cells); median predicted -10.0%, measured +2.0%.
- cats7 vs mph2-eq: across cells Spearman -0.17 (p = 0.602); seed by seed Spearman 0.05 (p = 0.306, 360 seed-cells); median predicted +0.5%, measured -5.4%.
- cats7 vs plexo: across cells Spearman 0.87 (p = <0.001); seed by seed Spearman 0.72 (p = <0.001, 360 seed-cells); median predicted -15.2%, measured -11.2%.

## Requests and bytes per download

| sizeMB | algorithm | requests | received MB | splits | copies |
|---|---|---|---|---|---|
| 20 | cats5 | 47.5 | 22.8 | 3.9 | 7.8 |
| 20 | cats6 | 44.6 | 22.5 | 4.9 | 6.9 |
| 20 | cats7 | 54.6 | 22.3 | 9.1 | 8.3 |
| 20 | mph2-eq | 114.9 | 21.0 | 9.8 | 0.0 |
| 20 | plexo | 23.9 | 21.7 | 0.0 | 3.9 |
| 20 | rb-eq | 233.0 | 23.9 | 0.0 | 45.6 |
| 20 | twoway-eq | 197.3 | 21.0 | 130.1 | 0.0 |
| 200 | cats5 | 325.3 | 211.5 | 3.1 | 8.1 |
| 200 | cats6 | 322.6 | 213.5 | 8.9 | 10.9 |
| 200 | cats7 | 328.6 | 213.0 | 15.6 | 10.4 |
| 200 | mph2-eq | 339.4 | 209.7 | 15.6 | 0.0 |
| 200 | plexo | 146.9 | 209.7 | 0.0 | 3.0 |
| 200 | rb-eq | 527.6 | 223.2 | 0.0 | 44.4 |
| 200 | twoway-eq | 1639.6 | 209.8 | 1427.9 | 0.0 |

