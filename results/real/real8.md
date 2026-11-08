# cats8 on the real testbed

Seeds 6201-6230, never used before; same cells as results/real/real.md; every
algorithm in one batch, interleaved seed by seed.

## Testbed health

- runs: 2520; timed out: 0; shaper errors: 0
- engine tick: mean 10.00 ms, max 10.04 ms (target 10)

## Scoreboard

Holm-corrected Wilcoxon over the 12 cells; negative is cats8 faster.

| cats8 against | cells | seeds per cell | faster (sig.) | slower (sig.) | no clear difference | median of medians % | best % | worst % |
|---|---|---|---|---|---|---|---|---|
| cats6 | 12 | 30-30 | 4 | 0 | 8 | -0.5 | -2.4 | 1.5 |
| cats5 | 12 | 30-30 | 2 | 0 | 10 | -0.0 | -3.9 | 1.3 |
| rb-eq | 12 | 30-30 | 8 | 2 | 2 | -3.6 | -13.6 | 6.6 |
| twoway-eq | 12 | 30-30 | 6 | 4 | 2 | -0.8 | -38.1 | 5.6 |
| mph2-eq | 12 | 30-30 | 11 | 0 | 1 | -7.9 | -27.2 | -3.3 |
| plexo | 12 | 30-30 | 10 | 0 | 2 | -13.7 | -41.4 | 0.6 |

## Per cell, median [95% CI]; ns = not significant (Holm)

| scenario | rttFactor | sizeMB | vs cats6 % | vs cats5 % | vs rb-eq % | vs twoway-eq % | vs mph2-eq % | vs plexo % |
|---|---|---|---|---|---|---|---|---|
| S1-stable | 1 | 20 | -0.5 [-1.7, +1.2] ns | -1.9 [-3.5, -0.3] ns | -1.0 [-3.2, +1.8] ns | +5.0 [+2.9, +6.0] | -6.9 [-9.3, -4.2] | -17.8 [-25.9, -11.2] |
| S1-stable | 1 | 200 | -1.5 [-2.3, -0.5] | +0.1 [-0.1, +0.3] ns | -3.8 [-4.7, -2.9] | +0.6 [+0.3, +0.9] | -3.3 [-6.0, -1.5] | -1.9 [-2.5, -1.0] |
| S1-stable | 4 | 20 | +1.1 [+0.0, +1.9] ns | -0.8 [-3.5, +1.6] ns | -4.8 [-5.9, -2.6] | -12.7 [-15.9, -10.7] | -9.6 [-9.8, -7.9] | -24.5 [-28.7, -20.3] |
| S2-hetero | 1 | 20 | -0.6 [-1.2, +0.6] ns | +0.6 [-0.9, +0.9] ns | -6.5 [-9.6, -5.0] | -28.7 [-35.8, -27.3] | -17.2 [-22.1, -12.5] | -41.4 [-49.9, -37.8] |
| S2-hetero | 1 | 200 | -1.9 [-2.8, -1.1] | +0.2 [-0.1, +0.5] ns | -3.3 [-3.8, -2.6] | -1.8 [-2.4, -1.2] | -11.5 [-16.3, -6.8] | -4.5 [-6.0, -3.7] |
| S2-hetero | 4 | 20 | -0.0 [-0.9, +0.3] ns | -3.9 [-8.6, -2.0] | -13.6 [-15.1, -10.0] | -38.1 [-44.4, -33.1] | -27.2 [-29.5, -22.7] | -36.1 [-39.7, -30.6] |
| S3-flaky | 1 | 20 | +1.5 [-0.0, +3.1] ns | +0.1 [-1.1, +0.8] ns | +2.7 [+0.3, +4.9] | +5.6 [+2.4, +8.1] | -3.4 [-8.5, +2.9] ns | +0.6 [-1.2, +2.5] ns |
| S3-flaky | 1 | 200 | -1.4 [-2.4, -0.7] | -0.1 [-0.2, +0.3] ns | -4.4 [-5.1, -3.2] | +0.8 [+0.3, +1.3] | -4.8 [-8.1, -3.1] | -0.6 [-1.1, -0.0] ns |
| S3-flaky | 4 | 20 | -0.9 [-2.8, +0.4] ns | -1.6 [-4.4, +0.0] ns | -1.2 [-4.0, +0.7] ns | -6.9 [-9.2, -4.3] | -7.5 [-11.5, -4.9] | -9.6 [-12.5, -7.6] |
| S6-three | 1 | 20 | -0.0 [-2.7, +2.0] ns | +1.3 [-1.2, +2.1] ns | +6.6 [+4.4, +8.0] | +5.6 [-1.8, +10.1] ns | -4.0 [-6.9, -1.5] | -21.4 [-27.5, -20.0] |
| S6-three | 1 | 200 | -2.4 [-3.1, -2.1] | +0.0 [-0.5, +0.3] ns | -3.4 [-4.6, -2.8] | +0.3 [-0.3, +0.7] ns | -8.3 [-11.7, -6.0] | -2.3 [-3.0, -1.4] |
| S6-three | 4 | 20 | +1.1 [-0.3, +3.1] ns | -1.7 [-3.4, -0.4] | -4.6 [-7.1, -1.4] | -13.3 [-18.9, -8.5] | -13.4 [-20.0, -10.7] | -29.1 [-31.9, -27.8] |

## Median completion time (s)

| scenario | rttFactor | sizeMB | cats5 | cats6 | cats8 | mph2-eq | plexo | rb-eq | twoway-eq |
|---|---|---|---|---|---|---|---|---|---|
| S1-stable | 1 | 20 | 2.06 | 2.03 | 2.01 | 2.15 | 2.40 | 2.01 | 1.94 |
| S1-stable | 1 | 200 | 18.21 | 18.53 | 18.39 | 19.35 | 18.77 | 18.98 | 18.25 |
| S1-stable | 4 | 20 | 2.45 | 2.37 | 2.43 | 2.62 | 3.30 | 2.55 | 2.78 |
| S2-hetero | 1 | 20 | 1.64 | 1.66 | 1.65 | 2.05 | 2.80 | 1.79 | 2.33 |
| S2-hetero | 1 | 200 | 15.84 | 16.20 | 15.89 | 18.47 | 16.46 | 16.28 | 16.27 |
| S2-hetero | 4 | 20 | 2.19 | 2.08 | 2.05 | 2.83 | 3.19 | 2.38 | 3.42 |
| S3-flaky | 1 | 20 | 4.91 | 4.86 | 4.86 | 4.97 | 4.83 | 4.79 | 4.67 |
| S3-flaky | 1 | 200 | 43.10 | 44.05 | 43.33 | 46.24 | 43.78 | 45.29 | 42.94 |
| S3-flaky | 4 | 20 | 5.91 | 5.95 | 5.90 | 6.30 | 6.60 | 6.03 | 6.17 |
| S6-three | 1 | 20 | 2.39 | 2.37 | 2.39 | 2.49 | 3.24 | 2.24 | 2.25 |
| S6-three | 1 | 200 | 20.33 | 20.72 | 20.19 | 22.32 | 20.88 | 21.00 | 20.25 |
| S6-three | 4 | 20 | 2.90 | 2.75 | 2.78 | 3.28 | 3.86 | 2.90 | 3.21 |

## Did the simulator predict the testbed?

- cats8 vs cats6: the simulator predicts one change in every cell; seed by seed Spearman nan (p = n/a, 360 seed-cells); median predicted +0.0%, measured -0.5%.
- cats8 vs cats5: across cells Spearman 0.30 (p = 0.341); seed by seed Spearman 0.01 (p = 0.891, 360 seed-cells); median predicted -0.5%, measured -0.0%.
- cats8 vs rb-eq: across cells Spearman 0.42 (p = 0.175); seed by seed Spearman 0.39 (p = <0.001, 360 seed-cells); median predicted -1.8%, measured -3.6%.
- cats8 vs twoway-eq: across cells Spearman 0.71 (p = 0.009); seed by seed Spearman 0.56 (p = <0.001, 360 seed-cells); median predicted -10.6%, measured -0.8%.
- cats8 vs mph2-eq: across cells Spearman 0.58 (p = 0.048); seed by seed Spearman 0.15 (p = 0.004, 360 seed-cells); median predicted -0.7%, measured -7.9%.
- cats8 vs plexo: across cells Spearman 0.94 (p = <0.001); seed by seed Spearman 0.76 (p = <0.001, 360 seed-cells); median predicted -11.4%, measured -13.7%.

## Requests and bytes per download

| sizeMB | algorithm | requests | received MB | splits | copies |
|---|---|---|---|---|---|
| 20 | cats5 | 47.7 | 22.9 | 3.9 | 7.8 |
| 20 | cats6 | 44.2 | 22.5 | 5.0 | 6.6 |
| 20 | cats8 | 45.2 | 22.7 | 4.3 | 7.2 |
| 20 | mph2-eq | 114.7 | 21.0 | 9.9 | 0.0 |
| 20 | plexo | 23.7 | 21.7 | 0.0 | 3.7 |
| 20 | rb-eq | 231.7 | 23.7 | 0.0 | 45.3 |
| 20 | twoway-eq | 196.1 | 21.0 | 128.3 | 0.0 |
| 200 | cats5 | 329.9 | 211.4 | 3.2 | 8.6 |
| 200 | cats6 | 327.9 | 213.1 | 8.7 | 11.2 |
| 200 | cats8 | 321.8 | 211.6 | 4.4 | 8.5 |
| 200 | mph2-eq | 343.6 | 209.7 | 15.7 | 0.0 |
| 200 | plexo | 147.4 | 209.9 | 0.0 | 3.6 |
| 200 | rb-eq | 533.4 | 222.7 | 0.0 | 44.5 |
| 200 | twoway-eq | 1676.6 | 209.9 | 1468.0 | 0.0 |

