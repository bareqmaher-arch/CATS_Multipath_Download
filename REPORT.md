# CATS: where the evidence stands

A record of what was built, what was measured and what it supports, for writing the paper.
Every number below comes from a file in `results/` that the commands in `README.md` regenerate.

## 1. The question

Plexo (open source, MIT) downloads one file over several networks at once with HTTP range
requests. CATS (Cost-Aware Tail Scheduling) changes only who fetches which bytes: blocks cut by
factoring, tail work by splitting a slow holder's range instead of copying it, copies only for
silent holders or small remainders, and a price on metered bytes. The question was whether CATS
is faster than what exists, and why.

## 2. The algorithm that was tested: cats5, frozen

cats5 = CATS with a slow-start-aware cost for the taker's request and blocks fetched as
sub-ranges on one connection (HTTP/2 streams): each sub-range is what the connection fetches in
one second at its measured speed (512 KiB to 8 MiB), one bandwidth-delay product is kept asked
for ahead, and a connection under half its network's usual speed is dropped rather than kept
when it loses a race. It is frozen: `FROZEN-cats5.sha256` fingerprints every file its behaviour
depends on, and the testbed refuses to start if one changes.

How it got there (`README.md`, rounds 1-5, each judged on seeds no earlier decision saw):
cats (round 1) lost on small files at far servers; pricing slow start (cats2) did not help, as
the cost was connections dropped by splits and lost races; sub-ranges on one connection (cats3)
fixed that but brought many requests and a tail risk from kept crawling connections; cats4 fixed
those but its byte-sized sub-ranges locked whole blocks and regressed large files; cats5 sizes
sub-ranges by time, which kept every gain without the regressions. Five rounds of design on a
simulator is a risk of fitting the simulator; the testbed below is the check on that.

## 3. Baselines

| Name | What | Where |
|---|---|---|
| plexo | Plexo as shipped: its own `pickWork` and `planDownload`, HTTP/1.1 | simulator, testbed |
| plexo-mux3 | Plexo's decisions on cats5's transport (separates transport from scheduling) | simulator, testbed |
| mph2 | MP-H2+FS (Nikravesh et al., MobiCom 2019), from the paper: even split, Algorithm 1 (delta 50 ms, Equation 1), pipelined second stream, 20 KB / 500 KB bandwidth estimate, PING response delay, range ends moved without tail bytes; one connection per path | simulator, testbed |
| mph2-eq | the same with as many connections as cats5 | simulator, testbed |
| mptcp | MPTCP, idealised (one subflow per path, near-perfect scheduling) | simulator only |
| fl, fl-eq | Follower-Leader (Salkintzis, ICC Workshops 2025): leader takes 1 MB chunks, follower's chunk sized by the paper's formula to end with the leader's next | simulator, testbed |
| mdtp, mdtp-eq | MDTP's chunk sizing (ICCCN 2025): initial chunk C, then large chunks for sources above the geometric-mean throughput and C x th_i / th_fastest for all | simulator, testbed |
| twoway, twoway-eq | Two-way download after MPRD (ICDCS 2025) and DEMS: fastest path forward, the rest backward from Equation 2 offsets as descending range requests, reassigned at crossovers | simulator, testbed |
| rb, rb-eq | Dynamic parallel access (Rodriguez, Biersack, ToN 2002): equal blocks (B = max(30, 7.5 M)), pipelined, end-game copies of outstanding blocks | simulator, testbed |

The last four were added after the literature review; each file in
`src/baselines/` states what comes from the paper and what had to be assumed. Plain names are the
papers' designs (one connection per path or source); `-eq` gives them cats5's connection count.

MP-H2 was checked against its paper before use (`src/baselines/check.ts`): in the paper's own
stable setting its paths finish within 0-20 ms of each other for 1 MB+ files and it lands within
about 11% of the MPTCP model, as the paper reports. Three hosting faults were found and fixed
before any comparison, all in favour of MP-H2 (a pipelined range started a step late; ranges
were too coarse for its flow-control-style range ends; on the testbed its read-ahead used the
base RTT, which queues exceed).

MPTCP on real TCP was not possible: the WSL2 kernel (6.18) has no `CONFIG_MPTCP` and there is no
KVM for a VM. A kernel with MPTCP is needed for that (section 8).

## 4. Real TCP testbed

One privileged Docker container per scenario: server and client network namespaces joined by one
veth pair per network; netem replays the simulator's capacity trace for the seed every 100 ms,
half the RTT on each side, queue of two bandwidth-delay products; nginx serves HTTP/1.1 and
HTTP/2; Linux TCP (CUBIC, slow start after idle). `src/real/engine.ts` runs the simulator's own
decision code over real sockets. Seeds 6001-6030 (new), 12 cells (S1 stable, S2 volatile 4G, S3
outages, S6 three networks; 20 and 200 MB; 20 MB at RTT x4), 5 algorithms, 1800 runs. Engine
ticks 10.00 ms on average (max 10.03), no shaper errors, no timeouts. A control showed one
connection reaches 95% of a link over HTTP/1.1 and HTTP/2 alike, so the HTTP stack is not a
handicap for anyone.

### Results (`results/real/real.md`, `fig15_real_vs_baselines.png`)

Change in completion time, cats5 against each, median of 30 paired seeds [95% CI]; negative is
cats5 faster.

| Cell | vs Plexo | vs MP-H2 (equal connections) | vs MP-H2 (paper) |
|---|---|---|---|
| S1 20 MB | -12.5 [-16.7, -5.6] | -1.6 [-3.0, +0.9] | -6.9 [-8.9, -4.5] |
| S1 200 MB | -1.5 [-2.6, -1.1] | -3.4 [-5.9, -1.6] | -1.7 [-2.6, -1.5] |
| S1 20 MB, RTT x4 | -22.1 [-28.4, -16.1] | -3.5 [-5.3, +1.2] | -26.8 [-27.7, -24.0] |
| S2 20 MB | -40.5 [-48.5, -36.3] | -14.2 [-18.8, -9.7] | -22.6 [-23.5, -19.8] |
| S2 200 MB | -5.1 [-6.2, -3.6] | -10.2 [-14.2, -5.8] | -4.5 [-8.6, -2.7] |
| S2 20 MB, RTT x4 | -35.8 [-42.3, -28.6] | -20.2 [-25.8, -14.4] | -32.3 [-33.9, -30.0] |
| S3 20 MB | +1.9 [-1.5, +5.2] | -4.1 [-10.5, +1.5] | -6.9 [-11.5, -3.8] |
| S3 200 MB | -0.4 [-1.2, +0.1] | -4.3 [-8.2, -1.9] | -1.0 [-2.1, -0.4] |
| S3 20 MB, RTT x4 | -5.4 [-11.5, -1.6] | -6.4 [-14.6, +0.6] | -9.6 [-11.3, -8.0] |
| S6 20 MB | -20.2 [-24.9, -17.6] | -2.8 [-4.3, -0.7] | -1.2 [-6.7, +1.0] |
| S6 200 MB | -2.6 [-3.7, -1.1] | -6.3 [-8.6, -3.8] | -2.3 [-4.4, -1.5] |
| S6 20 MB, RTT x4 | -25.8 [-28.0, -24.3] | -13.7 [-19.8, -9.9] | -23.4 [-24.7, -20.2] |
| **Significantly faster / slower / no difference** (Holm) | **10 / 0 / 2** | **8 / 0 / 4** | **11 / 0 / 1** |

Plexo on cats5's transport (plexo-mux3) is no faster than Plexo (0 / 1 / 11): the gain is the
scheduling, not HTTP/2.

Costs per download: cats5 sends about twice Plexo's requests (48 vs 24 at 20 MB, 326 vs 147 at
200 MB) and receives about 1 MB more (copies), about as many requests as MP-H2 with equal
connections (115 and 344).

## 5. Simulator against testbed (`fig16_sim_vs_real.png`)

- cats5 vs Plexo: the simulator ranks the cells as the testbed does (Spearman 0.88 across cells,
  0.76 seed by seed, both p < 0.001) and gets the size of the gains right (S2 20 MB: -39% vs
  -40.5% measured).
- MP-H2 comparisons: the simulator does not predict them (0.17 across cells). It expected cats5
  and mph2-eq to tie; on real TCP cats5 is ahead by a median 5.3%. Real cats5 and Plexo run close
  to their simulated times; real MP-H2 runs slower than simulated MP-H2.
- Diagnosis (`results/real/diag/diag.md`, same seeds and cells): MP-H2 with coarser sub-ranges
  gets worse (+15% to +27%), so the fine ranges standing in for its flow-control window are not
  what holds it back; with the base RTT in place of the PING delay it improves in one cell of six
  (-7%). Neither closes the gap. The likely cause, not yet tested, is that the simulator shares a
  link fairly between connections and real TCP does not, which unsettles Equation 1's per-path
  rates more than CATS's reactive tail.

## 6. Simulator against all baselines (`results/baselines.md`, seeds 7001-7100)

With slow start, cats5 against each (24 cells; significantly faster / slower / no difference):

| Against | Faster | Slower | No difference | Median of medians |
|---|---|---|---|---|
| MP-H2 (paper) | 23 | 0 | 1 | -11.3% |
| MP-H2, equal connections | 6 | 7 | 11 | +0.6% |
| MPTCP (idealised) | 24 | 0 | 0 | -14.7% |
| Plexo | 21 | 1 | 2 | -2.4% |

Against mph2-eq the simulator splits by condition: mph2-eq is ahead by 0.1-5% on steady networks
(up to 12% on the far server S7), from its pipelining, which saves a round trip per block;
cats5 is ahead by 20-36% where connections crawl or stall (S4) and by 64% on volatile 4G at
RTT x10. Single-connection designs (mph2, mptcp) are also hurt by the simulator's per-connection
quality draw, which the testbed does not have.

## 6b. Four more baselines from the literature review

### Testbed (`results/real/newreal.md`, `fig20_real_new_baselines.png`)

Seeds 6001-6030, the same 12 cells; cats5 rerun in the same batch, interleaved seed by seed; 3240
runs, engine tick 10.00 ms (max 10.19), no shaper errors or timeouts. cats5 in this batch against
the first: Spearman 0.99 seed by seed, cell medians within 1.7%, so the testbed repeats.

| cats5 against | Faster | Slower | No difference | Median of medians | Where cats5 is slower |
|---|---|---|---|---|---|
| fl (paper) | 12 | 0 | 0 | -27.6% | |
| fl-eq | 9 | 0 | 3 | -16.4% | |
| mdtp (paper) | 12 | 0 | 0 | -11.0% | |
| mdtp-eq | 12 | 0 | 0 | -21.1% | |
| twoway (paper) | 9 | 0 | 3 | -5.5% | |
| twoway-eq | 6 | 3 | 3 | -0.3% | S1 20 MB +8.7%, S6 20 MB +6.7%, S1 200 MB +0.8% |
| rb (paper) | 10 | 0 | 2 | -4.3% | |
| rb-eq | 8 | 2 | 2 | -3.4% | S1 20 MB +4.0%, S6 20 MB +5.1% |

Bytes received per 20 MB download: cats5 22.9 MB, rb-eq 23.9, twoway-eq 21.0, the copy-free
ones 20.9-21.0 (headers included). Requests per 20 MB: cats5 48, rb-eq 232, twoway-eq 198.

### Simulator (`results/newbase.md`, `fig19_all_baselines.png`, seeds 8001-8100, slow start)

cats5 is faster in 22-24 of 24 cells against fl, mdtp, twoway (both variants) and rb, and in
18 of 24 against rb-eq (slower in 6: 20 MB files, by 2-9%, and S5 20 MB by 38%); with every RTT
scaled, cats5 and rb-eq split 9 / 10 / 5. rb-eq pays for it: about 8 times cats5's requests and
9-50 MB wasted per 200-1000 MB download (cats5: about 1 MB). The simulator predicts the testbed
well for fl, fl-eq and mdtp-eq (Spearman 0.93-0.97 across cells), less so for twoway-eq (0.80;
predicted -12.7% median, measured -0.3%) and rb-eq (0.73; predicted +1.1%, measured -3.4%).

### What it adds

The two strongest rivals are the old ideas with many connections: two-way meeting (twoway-eq)
and small equal blocks with end-game copies (rb-eq). On steady links with small files each beats
cats5 by 4-9% on real TCP; twoway-eq does so with no copies at all. cats5's lead over them is on
volatile links (S2: 1-37% faster than both, every cell significant), at long RTTs (RTT x4:
8.5-37% faster than twoway-eq, 2-9% than rb-eq, S6 not significant) and for 200 MB against rb-eq
(3-5%); against rb-eq it also costs a fifth of the requests and fewer bytes.

## 6c. cats6: cats5 with its next block pipelined (`results/round6.md`)

cats6 (`src/cats6.ts`) runs cats5's own pick for a stream one response delay before its block
ends and asks for the chosen work at once on the same connection, so no block costs an idle
round trip. Nothing else changes; cats5's files stay frozen. Developed on seeds 9001-9030,
judged on 10001-10100 (simulator, every algorithm):

- Against cats5: faster in 18 of 24 cells, slower in none (slow start; median -0.4%, best
  -5.9%, largest at the far server S7); with every RTT scaled, 18 / 0 / 6, median -1.4%, best -6.3%.
- Against Plexo it is now faster in all 24 cells (cats5: 21 / 1 / 2 on 8001-8100).
- It does not close the small-file gap: rb-eq stays ahead at 20 MB on S1 (+5.4%), S3 (+4.6%),
  S4 (+2.1%), S5 (+32.6%) and S6 (+11.1%).

Why, from the development seeds: the idle round trip between blocks was not the cost. At 20 MB
the tail (after the last block is handed out) takes about 1.2 s of a 2 s download for cats5 and
cats6 against 0.25 s for rb-eq. CATS's tail rules are scaled for long downloads (no split under
512 KiB, a holder watched 0.5 s before it is judged, a split only if it gains 0.25 s), so in a
2 s download it almost never splits, while rb-eq's 111 KB blocks end close together on their own.
On S6 (24 connections) cats5's 1 MiB minimum block also leaves 5 connections without work; giving
every connection a block (diagnostic cats6-fine) gains 3.5% there and nothing elsewhere.

Two runs each of the six single-connection designs hit the 4000 s limit on S0 1000 MB (a
connection drawn "bad"); they are kept at 4000 s, which favours them. On the testbed see 6d.

## 6d. cats7: a tail for small files (`results/round7.md`, `results/real/real7.md`)

cats7 (`src/cats7.ts`) is cats6 with three tail changes, chosen on seeds 9001-9030 from seven
candidates (the dropped ones are listed in the file's header):

- once every block is handed out, sub-ranges shrink to 0.2 s of data (at least 64 KiB), so a
  split can cut close to where the holder is;
- the smallest split scales with the holder's bandwidth-delay product (64-512 KiB), but only
  when every holder of the block is healthy;
- no tail work goes to a new connection on the holder's own network, where it would share the
  holder's bottleneck and pay a handshake and slow start.

**Simulator, held-out seeds 11001-11100 (slow start).** Against cats5 faster in 21 of 24 cells,
slower in none; against cats6 8 faster, 2 slower (both under 1%); against rb-eq 18 / 3 / 3. At
20 MB the gap to rb-eq closes on S1 (0.0%), S3 (+1.1%, not significant) and S4 (-0.2%), and
narrows on S6 (+3.4%) and S5 (+9.5%), with 60 requests to rb-eq's 348 and 0.22 MB wasted to its
0.97.

**Testbed, seeds 6101-6130, all seven algorithms in one batch** (2520 runs, none timed out, no
shaper errors, tick 10.00 ms): the simulator's gain did not carry over.

| cats7 against | faster (sig.) | slower (sig.) | no clear difference | median of cells |
|---|---|---|---|---|
| cats6 | 0 | 2 | 10 | +0.6% |
| cats5 | 2 | 7 | 3 | +2.0% |
| rb-eq | 6 | 2 | 4 | -1.2% |
| twoway-eq | 3 | 6 | 3 | +2.0% |
| mph2-eq | 9 | 0 | 3 | -5.4% |
| plexo | 6 | 1 | 5 | -11.2% |

- Small files, steady links, against the rivals of 6b: on S1 20 MB the gap to rb-eq is gone
  (-0.8%, ns; cats5 +1.6%) and to twoway-eq it shrinks from +7.0% (cats5) to +3.9%. On S6 20 MB it
  shrinks from +7.0% to +3.2% against rb-eq and from +7.1% to +3.6% (ns) against twoway-eq. Most
  of that is pipelining: cats6 alone is at -0.3% to -2.4% against cats5 there.
- A new loss: S6 at RTT x4, 20 MB, +13.6% against cats6, +5.1% against cats5, +10.7% against
  rb-eq. cats7 opens 21.6 connections there to cats6's 19.0 and makes 12.0 copies to 4.2: the
  guard keeps tail work off the holder's network, but a new connection on another network still
  pays a handshake and slow start at four times the RTT, which on real TCP costs more than the
  simulator's model of it.
- Simulator and testbed agree across cells for cats7 against cats5, rb-eq, twoway-eq and Plexo
  (Spearman 0.69-0.87) but not against cats6 (0.18): the tail changes are below what the
  simulator predicts reliably.

The same batch is also the first testbed run of **cats6**: against cats5 it is 3.5-5.3% faster
at RTT x4 for 20 MB (S1, S2, S6), and 0.9-3.0% slower for 200 MB (every scenario significant).
On the simulator it was never slower.

## 6e. cats8: cats6 with its pre-pick timed by the base RTT (`results/real/real8.md`)

Both of cats7's testbed losses, and cats6's at 200 MB, were traced tick by tick on the testbed
(`src/real/trace-real.ts`, development seeds 6901-6910, never used for judging):

- **200 MB.** cats6 delivered byte for byte what cats5 did up to 98% of the file in every traced
  seed; the whole loss was the last 2%. There a slow LTE connection had pipelined one of the last
  1 MiB blocks and finished it alone at about 250 KB/s while the other 15 connections idled.
  Pipelining picks one response delay before a block ends, and on the testbed that delay is a
  PING that waits behind the link's queue: much longer on a slow, queued LTE link than on Wi-Fi,
  so the slow connections picked first and took the last blocks.
- **S6 at RTT x4.** cats7's smaller tail splits went to connections on a network that was
  collapsing (lte2 fell to almost nothing in the slowest seed), and to new connections.

cats8 (`src/cats8.ts`) changes one thing in cats6: the pre-pick runs one base round trip before
a block ends, not one measured response delay. On the simulator, which has no queues, the two
are equal and cats8 is cats6 exactly (checked on held-out seeds 12001-12010), so its simulator
results are cats6's (section 6c). Five other fixes were tried on the testbed's development seeds
and left out (listed in the file's header): cats7's tail gained nothing over cats6 there; keeping
new connections out of a busy network's tail and pricing a taker at its share of its network
cut connections but not the loss; releasing a late reservation wasted 4-10% more bytes; no
pipelining once the file is all cut halved both the loss and the gain; judging silence by a
block's own progress changed nothing measurable.

**Testbed, new seeds 6201-6230, every algorithm in one batch** (2520 runs, none timed out, no
shaper errors, tick 10.00 ms; the batch was interrupted once by a Docker restart and resumed,
skipping finished runs):

| cats8 against | faster (sig.) | slower (sig.) | no clear difference | median of cells |
|---|---|---|---|---|
| cats6 | 4 | 0 | 8 | -0.5% |
| cats5 | 2 | 0 | 10 | -0.0% |
| rb-eq | 8 | 2 | 2 | -3.6% |
| twoway-eq | 6 | 4 | 2 | -0.8% |
| mph2-eq | 11 | 0 | 1 | -7.9% |
| plexo | 10 | 0 | 2 | -13.7% |

- 200 MB: 1.4-2.4% faster than cats6 in every scenario (all significant) and level with cats5
  (-0.1 to +0.2%, none significant): the pipelining loss is gone.
- 20 MB at RTT x4: faster than cats5 on S2 (-3.9%) and S6 (-1.7%), not significantly different
  on S1 and S3.
- cats8 is significantly slower than neither of its predecessors in any cell, the first version
  after cats5 of which that holds on real TCP.
- Small files on steady links remain the one place two published designs lead: twoway-eq by
  5.0% (S1), 5.6% (S3, S6 not significant) and rb-eq by 2.7% (S3) and 6.6% (S6), at 4-5 times
  cats8's requests.
- The simulator cannot see the difference between cats8 and cats6 (it predicts none) or between
  cats8 and cats5 (Spearman 0.30 across cells); it still ranks cats8 against Plexo and twoway-eq
  correctly (0.94 and 0.71).

## 6f. cats8 over real networks (`results/wild/wild.md`, `fig23_wild.png`)

cats8 was fixed before any of this data existed, so this is a verdict on it, not part of its
design. The client was a laptop on home fibre over Wi-Fi and a phone on a commercial LTE network,
tethered by USB; the server was a dedicated machine in Germany, reached by its own IP. Nothing was
shaped. Median base RTTs were 81.5 ms (Wi-Fi) and 101.2 ms (LTE), and LTE carried 36-39% of the bytes.
Seven algorithms ran once per round on the same file in shuffled order, in five blocks six hours
apart from midnight to the next midnight (2026-11-05 to 06).

The phone's data allowance limited the design: 8 rounds per block, 5 of them with 100 MB. Planned
40 rounds at 20 MB and 25 at 100 MB; obtained 37 and 24, because the LTE link stopped carrying data
at 01:01 on the last night, in round 37 (see below). 427 runs are analysed; none timed out, and the
engine tick stayed at 10.0 ms (highest mean in a run 10.93 ms).

Median change in cats8's completion time, with 95% CI; negative is cats8 faster:

| cats8 against | 20 MB (37 rounds) | Holm p | 100 MB (24 rounds) | Holm p |
|---|---|---|---|---|
| Plexo | **-14.1% [-20.8, -5.7]** | 0.001 | -7.1% [-13.4, -1.7] | 0.049 (fragile) |
| cats6 | -0.7% [-14.3, +11.5] | 0.24 | **-18.1% [-31.9, -1.7]** | 0.014 |
| cats5 | -5.9% [-9.9, +1.6] | 0.07 | -8.0% [-11.3, -3.8] | 0.046 (fragile) |
| twoway-eq | -7.7% [-14.3, +1.8] | 0.21 | -7.3% [-13.3, +1.4] | 0.21 |
| mph2-eq | +1.0% [-4.5, +10.5] | 1.00 | -3.4% [-14.0, +8.3] | 1.00 |
| rb-eq | +8.0% [-6.4, +9.5] | 0.56 | -3.2% [-8.4, +7.7] | 0.99 |

Median times, 20 / 100 MB, in seconds: rb-eq 2.23 / 7.97, mph2-eq 2.25 / 8.65, cats8 2.41 / 8.10,
cats5 2.42 / 9.47, cats6 2.46 / 10.04, twoway-eq 2.50 / 8.71, Plexo 2.58 / 9.07.

- **Firm:** cats8 is significantly faster than Plexo at 20 MB and than cats6 at 100 MB under every
  treatment of the failed round below, and significantly slower than nothing.
- **Fragile:** the 100 MB results against cats5 and Plexo. Holm p against cats5 is 0.046 with the
  failed round left out, 0.097 with it kept and 0.055 with rounds 36-37 both left out; against Plexo
  it is 0.030-0.049. They point the same way but should be reported as borderline.
- **Tied:** rb-eq, mph2-eq and twoway-eq. The data can only resolve differences of roughly 9-10% at
  20 MB and 9-16% at 100 MB (normal approximation from the measured spread, 80% power, Holm's first step), so this is "no clear
  difference", not equality. The direction against rb-eq at 20 MB agrees with the testbed's
  small-file gap; twoway-eq's testbed lead does not appear here.
- **Cost:** cats8 issues 151 requests per 100 MB against 336 for rb-eq, 640 for twoway-eq, 202 for
  mph2-eq and 96 for Plexo, and receives 101.0 MB against rb-eq's 105.0 MB. At 20 MB it issues 42
  against 199, 169, 104 and 21. These are descriptive means, untested.
- **cats8 against cats6 is much larger here than on the testbed** (-18% against -1.4 to -2.4% at
  the largest size), which fits the mechanism in 6e but does not prove it: no traces were taken
  on the real links.
- Per-block cells have 4-8 pairs and cannot reach significance after correction; they are in
  `wild.md` as description only and do not establish a time-of-day effect.

**The failed round.** During round 37 at 100 MB the phone stayed connected by USB and answered
pings, but passed no data to any host, and still did not at 01:11. The cause is unknown: the
adapter had counted 10.13 GB, plus whatever the phone used directly, against a 12 GB allowance, so
the allowance may have run out. The four algorithms that ran after the cut got nothing over LTE.
`wild.py` leaves out any round and size in which an algorithm received nothing over a network,
which removes exactly this one. That rule was written after the cut was seen, hence the sensitivity
figures above.

**A silent link death, seen once.** Those four runs are an unplanned observation: Plexo and rb-eq
finished in about 15 s, while cats6 took 33.3 s and mph2-eq 38.2 s, each with 8 failed requests.
cats8 had already run in that round and shares cats6's pipelining, so it may stall the same way.
One run each; the testbed's outage scenario has not been checked against a link that goes silent
while staying up.

## 7. What the evidence supports

1. On real TCP, cats5 downloads faster than Plexo, than MP-H2 as published and than MP-H2 with
   as many connections, in most conditions tested, and is significantly slower than none of them
   in any cell. Gains are largest for small files and far or volatile networks (20-40% against
   Plexo, 14-20% against MP-H2 with equal connections), and small for 200 MB on steady networks
   (1.5-6%).
2. The gain comes from the scheduling decision: the same transport does nothing for Plexo.
3. CATS's distinctive strength is the tail under stragglers and volatile links; on steady links
   MP-H2's pipelining is as good or slightly better on the simulator.
4. The simulator is validated for CATS against Plexo, not for MP-H2; MP-H2 claims rest on the
   testbed.
5. Against the four baselines added after the literature review, cats5 is significantly slower
   than none of the papers' own designs on real TCP. With cats5's connection count, two-way
   download and Rodriguez-Biersack are faster on small files over steady links (4-9%), so "fastest
   everywhere" cannot be claimed; "fastest or tied in most conditions, clearly ahead on volatile
   and long-RTT links, at a fraction of rb-eq's requests and waste" can.
6. cats6 and cats7 were not uniform improvements on real TCP (cats6 traded 1-3% on 200 MB for
   3.5-5% on small files at long RTTs; cats7 lost 13.6% on three networks at RTT x4). cats8,
   designed from testbed traces and judged on new seeds, is: never significantly slower than
   cats5 or cats6, up to 3.9% faster than cats5 for small files at long RTTs and 1.4-2.4% faster
   than cats6 for 200 MB. The gain over cats5 is small; the claim it supports is "pipelining
   timed by the base RTT adds a little and costs nothing", not a new large effect.
7. Effects of a few percent in the tail are below what the simulator resolves; the testbed,
   with real queues and HTTP/2, is needed to judge them.
8. Over real Wi-Fi and LTE, cats8 (fixed beforehand) is significantly faster than Plexo for 20 MB
   (-14.1%) and than cats6 for 100 MB (-18.1%), borderline faster than cats5 and Plexo for 100 MB,
   tied with rb-eq, mph2-eq and twoway-eq within what 24-37 rounds can resolve, and significantly
   slower than nothing, with under half of rb-eq's requests.

## 8. Limitations and open items

- No MPTCP on real TCP (needs a kernel with `CONFIG_MPTCP`: a custom WSL2 kernel or a Linux
  machine). The MP-H2 paper's own measurement (MP-H2 within 0.1-11% of MPTCP for 1 MB+) is the
  only real-TCP link to MPTCP for now.
- MP-H2 is a reimplementation from the paper on HTTP/2 sub-ranges, not its OkHttp code with
  flow-control windows. The two diagnostics bound two implementation choices, not all of them.
- The testbed does not reproduce per-connection crawling and stalling (S4), per-connection server
  caps (S5, S7) or disks; those results are simulator-only.
- The testbed is one emulated host, netem links, a single server, no CDN. The real-network
  experiments (6f) add one home, one carrier, one phone, one server in Germany and about 24 hours,
  so they show the result on real links, not across networks in general.
- Real networks: 37 of 40 and 24 of 25 planned rounds, the LTE link's failure excluded by a rule
  written after it happened; other use of the fibre during the day was not controlled, and some
  phone traffic in the first minutes was not the experiment's; no tick traces on the real links.
- A link that goes silent while staying up may stall cats6 (seen once, 33.3 s against about 15 s;
  section 6f). Not yet tested for cats8.
- cats5's transport keeps a base-RTT bandwidth-delay product asked for ahead; queues lengthen the
  real RTT, which can cost it a few percent. Left as frozen.
- S3 (outages) shows no clear gain against Plexo at 20 and 200 MB.
- Five design rounds on the simulator: the held-out seeds and the testbed guard against fitting
  it, but a final confirmation on new seeds after any further change would still be needed.
- The literature review is done and its four recommended baselines are in.
  They are reimplementations from the papers with stated assumptions: MDTP's sizes scaled from
  GB files to these, Follower-Leader generalised beyond two interfaces, MPRD's reverse sending
  imitated with descending range requests.
- Pipelining is in (cats6, section 6c): a small, consistent gain on held-out simulator seeds, but
  on the testbed it costs 1-3% for 200 MB while gaining 3.5-5% for 20 MB at long RTTs.
- The small-file tail (cats7, section 6d) closes the gap to rb-eq on the simulator and on S1 of
  the testbed, but on the testbed it loses 13.6% to cats6 on S6 at RTT x4. cats8 (section 6e)
  drops it; the 5-7% gap to twoway-eq and rb-eq on small files over steady links remains open.
- cats8 was designed on testbed development seeds 6901-6910 after cats7's testbed result was
  seen; it was judged once, on new seeds 6201-6230. Seven design rounds in all: any further
  change would again need new seeds on both the simulator and the testbed.
