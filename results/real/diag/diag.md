# Why MP-H2 is slower on the testbed than on the simulator

Same seeds and cells as the main testbed run. Negative means the variant is faster than
mph2-eq as implemented. A variant that closes the gap to the simulator names the cause.

## Median completion times (s)

| scenario | rttFactor | sizeMB | mph2-eq | mph2-eq-basedelay | mph2-eq-coarse | simulated mph2-eq s |
|---|---|---|---|---|---|---|
| S2-hetero | 1 | 20 | 1.98 | 1.88 | 2.31 | 1.69 |
| S2-hetero | 1 | 200 | 16.67 | 16.71 | 17.05 | 15.64 |
| S2-hetero | 4 | 20 | 2.89 | 2.48 | 3.36 | 1.96 |
| S6-three | 1 | 20 | 2.49 | 2.58 | 3.13 | 2.25 |
| S6-three | 1 | 200 | 20.56 | 21.21 | 20.40 | 19.12 |
| S6-three | 4 | 20 | 3.25 | 3.26 | 4.28 | 2.81 |

## Variants against mph2-eq

| scenario | rttFactor | sizeMB | mph2-eq-basedelay vs mph2-eq % | mph2-eq-basedelay: p (Holm) | mph2-eq-coarse vs mph2-eq % | mph2-eq-coarse: p (Holm) |
|---|---|---|---|---|---|---|
| S2-hetero | 1 | 20 | -3.4 [-6.3, +0.8] | 0.399 | +15.2 [+11.1, +21.2] | <0.001 |
| S2-hetero | 1 | 200 | -2.2 [-7.4, +0.2] | 0.399 | +2.0 [-3.0, +2.3] | 0.847 |
| S2-hetero | 4 | 20 | -7.1 [-12.8, -3.5] | 0.048 | +26.9 [+16.6, +35.3] | <0.001 |
| S6-three | 1 | 20 | +1.6 [+0.4, +4.0] | 0.399 | +24.0 [+15.6, +30.5] | <0.001 |
| S6-three | 1 | 200 | +0.5 [-1.8, +3.2] | 0.842 | -0.8 [-1.7, +0.5] | 0.505 |
| S6-three | 4 | 20 | -0.1 [-1.5, +3.0] | 0.842 | +24.0 [+22.1, +33.6] | <0.001 |

