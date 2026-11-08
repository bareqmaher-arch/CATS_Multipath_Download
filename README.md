# CATS: client-side tail scheduling for multi-network HTTP downloads

Code and data for the manuscript *Splitting Instead of Copying: Client-Side Tail Scheduling for
Multi-Network HTTP Downloads*. **CATS** (Cost-Aware Tail Scheduling) fetches one file over several
networks using only HTTP range requests.

The repository holds the paired-seed simulator, the real-TCP testbed, the real-network harness, the
raw results (`results/`), the analysis scripts (`analysis/`) and the baselines, including the
scheduler of [Plexo](https://github.com/anmolkapil/plexo), a client-side multi-network download
manager, copied unchanged into `vendor/plexo/` under its MIT licence.

In the manuscript, CATS is `cats8`, CATS-base is `cats5`, CATS-pipe is `cats6` and CATS-small is
`cats7`. The real-network data are in `results/wild/wild.csv`; addresses of the server and of the
client are not included.

## Run it

Node 22.6+ (TypeScript runs through `--experimental-strip-types`) and Python 3 with numpy,
pandas, scipy and matplotlib.

```bash
node --experimental-strip-types --no-warnings src/check.ts 200 slowstart
node --experimental-strip-types --no-warnings src/run.ts all 100 1001 fluid
node --experimental-strip-types --no-warnings src/run.ts all 100 1001 slowstart
node --experimental-strip-types --no-warnings src/sensitivity.ts 100 1001
python analysis/analyze.py fluid
python analysis/analyze.py slowstart
node --experimental-strip-types --no-warnings src/trace.ts S4-stragglers 20 1001 cats slowstart
```

`check.ts` runs every scenario once and checks invariants (every block finishes, blocks cover the
file exactly, no run beats the lower bound). `run.ts` writes `results/<tcp>/main.csv` and
`cost.csv` (about 3 minutes each). `sensitivity.ts` scales every RTT by 1, 4 and 10 under slow
start. `analyze.py` writes `summary.md` and figures beside the data, and once both TCP models
have run, `results/compare_tcp.md` and `results/fig5_fluid_vs_slowstart.png`. `trace.ts` prints
one run event by event.

## What is compared

| Name | Blocks | Tail (nothing left to hand out) |
|---|---|---|
| `plexo` | Plexo's `planDownload` (1-8 MiB, fixed) | Plexo's `pickWork` hedging |
| `cats` | factoring: phi x remaining x stream share, 1-32 MiB | split the latest block; copy only stalled or small remainders |
| `cats-noSplit` | factoring | Plexo's hedging |
| `cats-noFactor` | Plexo's fixed blocks | CATS tail |
| `cats-l<x>` | full CATS, metered 4G priced at x seconds per MB | |
| `plexo-free` | Plexo on Wi-Fi only | |

The Plexo baseline runs Plexo's own `scheduler.ts` and `plan.ts`, copied unchanged into
`vendor/plexo/` (MIT, commit in `vendor/plexo/COMMIT`). Everything that is not the scheduling
decision is shared by all algorithms and follows Plexo's `httpTransfer.ts`: connection reuse,
silent and crawling connection refresh, the 20 s stall watchdog and retry backoff.

## The model, and what it leaves out

- Each network's capacity is a log-normal AR(1) process times a good/fade/outage Markov state,
  sampled per seed on a 100 ms grid. Every algorithm sees the same capacity for a given seed.
- Streams share a network max-min fairly, each up to its connection's ceiling: a quality draw q
  times the server's per-connection cap, or times the link. 3% of connections (15% in S4) crawl
  at 0.3-3% of the link. Connections stall at random, a few for good.
- A request costs 1 RTT on a reused connection and 3 RTT on a new one. Dropping a connection
  wastes what was in flight (speed x RTT).
- Two TCP models. `fluid`: a connection gets its share at once. `slowstart`: a congestion window
  that starts at 10 MSS and doubles per RTT while it is the limit, halves (at most once per RTT)
  when it is twice what the connection gets, then grows one MSS per RTT; it restarts from the
  initial window after an idle longer than the RTO, and drops to one MSS after a stall.
- **Not modelled:** disk limits, Plexo's adaptive stream count (both run a fixed 8 per network),
  HTTP/2, CUBIC or BBR, packet-level loss, and real server behaviour. The lower bound ignores
  request overheads, connection quality and slow start.
- **CATS itself ignores slow start:** its split rule prices a new request at 1 or 3 RTT and
  assumes the taker runs at its last block's speed at once. `cats2` prices the taker's ramp
  from the initial window for a new or long-idle connection. On fresh seeds it changed almost
  nothing (see Round 2 below).

## Round 2: cats2 on seeds 2001-2100

```bash
node --experimental-strip-types --no-warnings src/run.ts main 100 2001 fluid r2-fluid
node --experimental-strip-types --no-warnings src/run.ts main 100 2001 slowstart r2-slowstart
node --experimental-strip-types --no-warnings src/sensitivity.ts 100 2001 r2-slowstart
node --experimental-strip-types --no-warnings src/churn.ts 100 2001
cd analysis && python round2.py
```

`results/round2.md` has the tables; `fig7_round2_models.png` and `fig8_round2_rtt.png` the
figures. cats2 matches cats within noise in every cell, with and without slow start, and the
loss on 20 MB files at RTT x10 remains. The taker's ramp was not what cost CATS there: at RTT
x10 CATS loses on the median but has a much shorter tail than Plexo (S6: p90 6.4 s vs 8.3 s,
p99 7.4 s vs 9.9 s), and the seeds where it loses are the ones where it opened more new
connections than Plexo (Spearman 0.46 in S6). Each split truncation and each lost race drops a
warm connection, and the stream's next request pays a handshake and slow start again.

## Round 3: cats3 on seeds 3001-3100

cats3 is cats2 fetching each block as 512 KiB sub-ranges on one connection, kept one
bandwidth-delay product plus a sub-range ahead (HTTP/2 streams or HTTP/1.1 pipelining). A split
cuts no further back than what the holder has asked for, so the holder keeps its connection, and
a lost race cancels a stream instead of dropping a delivering connection. `plexo-mux` runs
Plexo's decisions on the same transport, so cats3 vs plexo-mux is the scheduling gain alone.

```bash
A=plexo,plexo-mux,cats2,cats3
node --experimental-strip-types --no-warnings src/run.ts main 100 3001 fluid r3-fluid $A
node --experimental-strip-types --no-warnings src/run.ts main 100 3001 slowstart r3-slowstart $A
node --experimental-strip-types --no-warnings src/sensitivity.ts 100 3001 r3-slowstart $A
node --experimental-strip-types --no-warnings src/churn.ts 100 3001 r3-slowstart $A
cd analysis && python round3.py
```

What it found (`results/round3.md`, `fig9_round3_rtt.png`, `fig10_round3_main.png`):

- The far-server loss is gone: S6, 20 MB, RTT x10 went from cats2 +5% vs Plexo to cats3 -18%
  [-20, -16], with 2% of seeds over 5% worse (cats2: about half). cats3 opened 19 new
  connections per download there, cats2 24 and Plexo 26.
- It did not get there by splitting. With 1 MiB blocks the sub-ranges already asked for cover
  the whole block, so cats3 made no splits on 20 MB files and copied instead; the gain is the
  lost copies keeping their connections. cats3 wasted 7.3 MB per 20 MB download there (cats2:
  2.2 MB).
- Elsewhere cats3 matches cats2 within about 1%, but is 2-7% slower on 20 MB at RTT x4.
- New tail risk with stragglers (S4, 20 MB): p99 8.8 s vs Plexo 4.5 s. Kept connections include
  crawling ones, which used to be dropped when they lost a race.
- Requests per download: about x2 at 20 MB, x3 at 200 MB, x14 at 1000 MB against Plexo.
- The transport alone does nothing for Plexo: plexo-mux vs plexo is 0.0% in almost every cell.

## Round 4: cats4 on seeds 4001-4100

cats4 runs on `SUBRANGES_V2` (`src/sim.ts`): sub-ranges of half a stream's share of what is
left of the file (512 KiB to 8 MiB), only a bandwidth-delay product asked for ahead, and a
connection under half its network's usual speed dropped rather than kept when it loses a race.
`plexo-mux2` is Plexo on the same transport. `cats4-fixedSize` is a diagnostic: cats4 with
512 KiB sub-ranges.

```bash
A=plexo,plexo-mux2,cats3,cats4
node --experimental-strip-types --no-warnings src/run.ts main 100 4001 fluid r4-fluid $A
node --experimental-strip-types --no-warnings src/run.ts main 100 4001 slowstart r4-slowstart $A
node --experimental-strip-types --no-warnings src/sensitivity.ts 100 4001 r4-slowstart $A
node --experimental-strip-types --no-warnings src/churn.ts 100 4001 r4-slowstart $A
node --experimental-strip-types --no-warnings src/sensitivity.ts 100 4001 r4-diag plexo,cats3,cats4,cats4-fixedSize
cd analysis && python round4.py
```

What it found (`results/round4.md`, `fig11_round4_rtt.png`, `fig12_round4_costs.png`):

- Requests fixed: 246 per 1000 MB download (cats3: 1970, Plexo: 142); 125 per 200 MB.
- Tail risk on 20 MB fixed: S4 p99 2.9 s (cats3 13.3 s, Plexo 5.2 s); S1 at RTT x10 4.4 s.
- Splits are back on small files: 9.5 per download in S6 at RTT x10, where waste fell from
  7.2 MB to 1.9 MB.
- But 200 and 1000 MB regressed badly where networks fade or connections crawl: S2 200 MB
  +10% vs Plexo (+67% at RTT x10), S4 200 MB +34%, with 60-94% of seeds over 5% worse. The
  adaptive size asks for a whole block in one sub-range early on, so a crawling holder's block
  can be neither split (the cut cannot go into what was asked for) nor copied (it is not silent).
- cats4-fixedSize removes every regression and beats cats3 almost everywhere (no cell over 2%
  of seeds worse by 5%, except S2 20 MB at RTT x10: +3.5%, 32%), but brings back cats3's
  request count. Sizing a sub-range by time at the holder's own speed, not by bytes left, is the
  untested next step. These diagnostic numbers come from the seeds that showed the regression.

## Round 5: cats5 on seeds 5001-5100

cats5 runs on `SUBRANGES_V3`: each sub-range is what its connection fetches in one second at its
measured speed (512 KiB to 8 MiB), with the BDP lead and the healthy-connection rule of cats4.
`plexo-mux3` is Plexo on the same transport. cats4-fixedSize is judged here on seeds it was not
diagnosed on.

```bash
A=plexo,plexo-mux3,cats4-fixedSize,cats5
node --experimental-strip-types --no-warnings src/run.ts main 100 5001 fluid r5-fluid $A
node --experimental-strip-types --no-warnings src/run.ts main 100 5001 slowstart r5-slowstart $A
node --experimental-strip-types --no-warnings src/sensitivity.ts 100 5001 r5-slowstart $A
node --experimental-strip-types --no-warnings src/churn.ts 100 5001 r5-slowstart $A
cd analysis && python round5.py
```

What it found (`results/round5.md`, `fig13_round5_rtt.png`, `fig14_round5_costs.png`):

- Against Plexo with slow start, cats5 is significantly faster in 21 of 24 cells; at scaled RTT
  in 23 of 24, with none significantly slower. 20 MB: 15-42% faster; 200 MB: 2-6% (7-12% at
  RTT x4 and x10); 1000 MB: 0.2-5%. Only four cells have more than 5% of seeds over 5% worse,
  all on 20 MB: S3 (19%), and at RTT x10 S2 (32%), S4 (13%) and S6 (8%).
- cats5 finishes exactly as cats4-fixedSize does (0.0% in every cell) with a third fewer
  requests: 1348 per 1000 MB download against 1965, and 316 against 415 per 200 MB. That is
  still about ten times Plexo's 141: roughly one request per connection per second.
- Wasted data: 0.9 MB per download at every size, against Plexo's 0.2 MB (20 MB) to 4.2 MB
  (1000 MB).
- What is left: S2 at RTT x10 on 20 MB (+3.4%, not significant, 32% of seeds over 5% worse),
  S5 on 20 MB (+3.3% median in every round, from factoring), and S4 at RTT x10 on 20 MB, where
  p99 is 7.5 s against Plexo's 6.9 s.
- Plexo on the same transport (plexo-mux3) is no faster than Plexo anywhere: the gain is the
  scheduling.

## Freezing cats5

`FROZEN-cats5.sha256` holds the checksums of every file cats5's behaviour depends on
(`src/schedulers.ts`, `src/sim.ts`, `src/algorithms.ts`, `src/network.ts`, `src/rng.ts`,
`src/scenarios.ts`, `vendor/plexo/*`). The testbed refuses to start if any of them changed:

```bash
sha256sum -c FROZEN-cats5.sha256
```

## Real-network testbed

`src/real/engine.ts` is Sim with its modelled parts replaced by real I/O: bytes come from
sockets, the clock is the wall clock (10 ms ticks), and drops and cancels act on real
connections. Every decision is still Sim's and the schedulers' own code. Plexo asks for each
block with one HTTP/1.1 request on a keep-alive connection; cats5 and plexo-mux3 ask for
sub-ranges as HTTP/2 streams on one connection per stream (cancel = RST_STREAM). The only
translation is rounding: Sim sizes sub-ranges in fractional bytes, a Range header needs whole
ones.

`testbed/` builds it in one privileged Docker container (Linux kernel through WSL2):

- `setup.sh`: namespaces `srv` (nginx) and `cli` (the client), three veth pairs `c<i>`/`s<i>`,
  one per network (10.<i+1>.0.0/24), offloads off, sparse 20/200/1000 MB files.
- `src/real/shaper.ts`: netem on `s<i>` replays Sim's capacity trace for the seed every 100 ms
  (outages as 100% loss) with half the RTT; `c<i>` adds the other half. Queue: two
  bandwidth-delay products.
- `nginx.conf`: port 8080 HTTP/1.1, port 8081 HTTP/2 by prior knowledge.
- `experiment.sh`: one scenario, 20 and 200 MB at its RTT, then 20 MB at four times it.

```bash
docker build -t cats-testbed testbed
# one container per scenario (Git Bash on Windows needs MSYS_NO_PATHCONV=1)
docker run --rm --privileged -v "$PWD:/work" cats-testbed \
  bash testbed/experiment.sh S1-stable results/real/real-S1-stable.csv 6001 30
node --experimental-strip-types --no-warnings src/real/sim-twin.ts 6001 30
cd analysis && python real.py
```

Not reproduced on the testbed: the per-connection crawling and stalling drawn in S4 (S4 is
left out, as it would be S1 again), per-connection server caps (S5, S7), and disks.

A limitation of frozen cats5 found on the testbed: its transport keeps one bandwidth-delay
product asked for ahead using the path's base RTT. Queues lengthen the real RTT (up to three
times here), so with one-second sub-ranges cats5 can wait briefly between them, costing it up
to a few percent. It was left as frozen.

## Published baselines

`src/baselines/` adds the baselines without touching a frozen file; `resolve.ts` names them for
every runner, alongside everything in `src/algorithms.ts`.

- `mph2`: MP-H2+FS (Nikravesh et al., "MP-H2: A Client-only Multipath Solution for HTTP/2",
  MobiCom 2019), implemented from the paper: even initial split over the paths, Algorithm 1
  (delta = 50 ms, take the slow path's tail by Equation 1 when within one response delay of
  finishing, at most two streams per connection), a pipelined second stream asked for early,
  20 KB / 500 KB bandwidth estimate, HTTP/2 PING response delay (testbed), range ends moved
  without tail bytes. One connection per path, as in the paper.
- `mph2-eq`: the same on as many connections as cats5 and Plexo, each treated as a path.
- `mptcp`: MPTCP on the simulator only, idealised: one subflow per path, pieces always queued,
  no requests. The testbed's kernel (WSL2 6.18) has no MPTCP (`CONFIG_MPTCP` off, no KVM for a
  VM), so MPTCP on real TCP needs another Linux kernel.

`src/baselines/check.ts` checks invariants and MP-H2 in its paper's own setting (stable WiFi and
LTE at 5/10 Mbps, 28/65 ms, 0.5-4 MB): the paths finish within 0-20 ms of each other for 1 MB
and larger files, and MP-H2 lands within about 11% of the MPTCP model.

```bash
node --experimental-strip-types --no-warnings src/baselines/check.ts
A=plexo,cats5,mph2,mph2-eq,mptcp
node --experimental-strip-types --no-warnings src/run.ts main 100 7001 slowstart b-slowstart $A
node --experimental-strip-types --no-warnings src/run.ts main 100 7001 fluid b-fluid $A
node --experimental-strip-types --no-warnings src/sensitivity.ts 100 7001 b-slowstart $A
cd analysis && python baselines.py
# testbed (one container per scenario)
docker run --rm --privileged -v "$PWD:/work" cats-testbed \
  bash testbed/baselines.sh S1-stable results/real/base-S1-stable.csv 6001 30
```

The full testbed analysis (all five algorithms, and the simulator against the testbed) and the
diagnosis of why MP-H2 does worse on the testbed than on the simulator:

```bash
node --experimental-strip-types --no-warnings src/real/sim-twin.ts 6001 30 plexo,cats5,plexo-mux3,mph2,mph2-eq
docker run --rm --privileged -v "$PWD:/work" cats-testbed bash -c "bash testbed/setup.sh && \
  ip netns exec cli node --experimental-strip-types --no-warnings src/real/run-real.ts \
  results/real/diag/diag.csv S2-hetero,S6-three 1,4 20 6001 30 mph2-eq,mph2-eq-basedelay,mph2-eq-coarse"
cd analysis && python real.py && python diag.py
```

`REPORT.md` gathers what all of it shows.

Two fixes were needed before MP-H2 matched its paper, both in how it is hosted, not in its
logic: a pipelined range now starts the moment the one before ends (Sim's 10 ms step had
delayed it), and MP-H2 keeps asked-for data ahead by its measured response delay, as its window
updates are timed in the paper, not by the base RTT.

## Baselines from the literature review

Four more, each from its paper, with the assumptions stated at the top of its file; the plain
name is the paper's design (one connection per path), `-eq` has cats5's connection count:
`fl` Follower-Leader (ICC-W 2025), `mdtp` MDTP's chunk sizing (ICCCN 2025), `twoway` two-way
download after MPRD (ICDCS 2025) and DEMS, `rb` Rodriguez-Biersack dynamic parallel access with
end-game copies (ToN 2002). `src/baselines/check.ts` checks their invariants on every scenario and
Follower-Leader in its paper's own setting. Simulator on seeds 8001-8100 (split in four groups
of algorithms so they run in parallel), testbed on 6001-6030 with cats5 rerun in the same batch:

```bash
A=(plexo,cats5,mph2 mph2-eq,mptcp,fl fl-eq,mdtp,mdtp-eq twoway,twoway-eq,rb,rb-eq)
for i in 0 1 2 3; do
  node --experimental-strip-types --no-warnings src/run.ts main 100 8001 slowstart c-slowstart-$i ${A[$i]}
  node --experimental-strip-types --no-warnings src/run.ts main 100 8001 fluid c-fluid-$i ${A[$i]}
  node --experimental-strip-types --no-warnings src/sensitivity.ts 100 8001 c-slowstart-$i ${A[$i]}
done
node --experimental-strip-types --no-warnings src/real/sim-twin.ts 6001 30 \
  cats5,fl,fl-eq,mdtp,mdtp-eq,twoway,twoway-eq,rb,rb-eq sim-twin-new.csv
# testbed, one container per scenario and seed part, e.g.
docker run --rm --privileged -v "$PWD:/work" cats-testbed bash testbed/baselines.sh \
  S1-stable results/real/new-S1-stable-a.csv 6001 15 cats5,fl,fl-eq,mdtp,mdtp-eq,twoway,twoway-eq,rb,rb-eq
cd analysis && python newbase.py && python newreal.py
```

Reports: `results/newbase.md` (fig19) and `results/real/newreal.md` (fig20). One fault was
found and fixed before any comparison: MDTP's geometric mean, computed as exp(mean log), came out
a hair above a lone path's own throughput, so that path was never "fast" and its chunks collapsed
to 1 KiB.

### Round 6: cats6 (cats5 with its next block pipelined)

`src/cats6.ts`, resolved as `cats6` (and the diagnostic `cats6-fine`, no block larger than an
even share per connection). Developed on seeds 9001-9030, judged on 10001-10100 with every
algorithm (same four groups as above plus `cats6`, in `results/e-{slowstart,fluid}-{0..4}/`):

```bash
node --experimental-strip-types --no-warnings src/run.ts main 100 10001 slowstart e-slowstart-4 cats6
node --experimental-strip-types --no-warnings src/run.ts main 100 10001 fluid e-fluid-4 cats6
node --experimental-strip-types --no-warnings src/sensitivity.ts 100 10001 e-slowstart-4 cats6
cd analysis && python round6.py
```

### Round 7: cats7 (cats6 with a tail for small files)

`src/cats7.ts`, resolved as `cats7`; `cats7-<letters>` keeps only some of its tail changes, for
development (the letters are listed in `src/baselines/resolve.ts`). Developed on seeds 9001-9030,
judged on 11001-11100 on the simulator (in `results/f-*`) and on new
testbed seeds 6101-6130 with cats6, cats5 and the strongest rivals in the same batch:

```bash
A=(plexo,cats5,mph2 mph2-eq,mptcp,fl fl-eq,mdtp,mdtp-eq twoway,twoway-eq,rb,rb-eq cats6,cats7)
for i in 0 1 2 3 4; do
  node --experimental-strip-types --no-warnings src/run.ts main 100 11001 slowstart f-slowstart-$i ${A[$i]}
  node --experimental-strip-types --no-warnings src/run.ts main 100 11001 fluid f-fluid-$i ${A[$i]}
  node --experimental-strip-types --no-warnings src/sensitivity.ts 100 11001 f-slowstart-$i ${A[$i]}
done
node --experimental-strip-types --no-warnings src/real/sim-twin.ts 6101 30 \
  cats7,cats6,cats5,rb-eq,twoway-eq,mph2-eq,plexo sim-twin-r7.csv
docker run --rm --privileged -v "$PWD:/work" cats-testbed bash testbed/baselines.sh \
  S1-stable results/real/r7-S1-stable-a.csv 6101 15 cats7,cats6,cats5,rb-eq,twoway-eq,mph2-eq,plexo
cd analysis && python round7.py && python real7.py
```

Reports: `results/round7.md` and `results/real/real7.md` (fig21).

### Round 8: cats8 (cats6 with its pre-pick timed by the base RTT)

`src/cats8.ts`, resolved as `cats8`; `cats8-<letters>` keeps only some of the parts tried during
development (letters in `src/cats8.ts`). Designed from tick-by-tick testbed traces
(`src/real/trace-real.ts`, run by `testbed/trace.sh`, development seeds 690x, output in
`results/trace/`). On the simulator cats8 is cats6 exactly (no queues, so base RTT and response
delay agree), checked on held-out seeds 12001-12010. Judged on new testbed seeds 6201-6230:

```bash
# one trace, e.g. S1 200 MB on development seed 6904
MSYS_NO_PATHCONV=1 docker run --rm --privileged -v "$PWD:/work" cats-testbed \
  bash testbed/trace.sh S1-stable 1 200 6904 cats5,cats6
node --experimental-strip-types --no-warnings src/real/sim-twin.ts 6201 30 \
  cats8,cats6,cats5,rb-eq,twoway-eq,mph2-eq,plexo sim-twin-r8.csv
docker run --rm --privileged -v "$PWD:/work" cats-testbed bash testbed/baselines.sh \
  S1-stable results/real/r8-S1-stable-a.csv 6201 15 cats8,cats6,cats5,rb-eq,twoway-eq,mph2-eq,plexo
cd analysis && python real8.py
```

Report: `results/real/real8.md` (fig22).

### Real networks (`wild/`)

A laptop's Wi-Fi (home fibre) and a phone tethered by USB (LTE), each bound to its own local
address, downloading from a server in Germany; nothing shaped or replayed. The server is an
nginx container (`wild/portainer-stack.yml`, host network, ports 18080 for HTTP/1.1 and 18081 for
HTTP/2 without TLS; `wild/server-setup.sh` does the same on a plain VPS). Reach it by its own IP,
not through a CDN proxy. `src/real/run-wild.ts` checks that the server sees two different public
addresses, measures each network's base RTT before every round (fastest of five TCP handshakes)
and gives it to the schedulers, then runs every algorithm once per round on the same file in
shuffled order. `wild/campaign.ps1` (or `wild/campaign.cmd`) runs five blocks six hours
apart, finding both networks' addresses before each block:

```bash
powershell -ExecutionPolicy Bypass -File wild/campaign.ps1 -Server <server IP> -Prefix <random path set in the stack>
cd analysis && python wild.py
```

Each block is 5 rounds of 20 and 100 MB and 3 more of 20 MB, sized to a phone's data allowance:
the campaign reads the phone adapter's counter and starts no block past `-PhoneBudgetGB`; `-StartAt`
resumes a schedule. `wild.py` leaves out a round and size in which any algorithm received nothing
over a network (the link had died). The phone must not be Windows's default route: set its
interface metric above the Wi-Fi's.

Report: `results/wild/wild.md` (fig23), summarised in REPORT.md section 6f. `results/wild/smoke*.csv`
are the setup checks, not data.

## Method notes

CATS was developed and debugged against seeds 1-50 (`results/dev-main.csv`). Three flaws found
there were fixed before the final run: a crawling holder with too little left to split; copies
made on a network that had itself stalled; and a wait for another network's stream that could
never take the work. The reported results use seeds 1001-1100, which no design decision saw.
Comparisons are per seed; medians carry 95% bootstrap intervals; p-values are two-sided Wilcoxon
signed-rank, Holm-corrected over the 24 scenario x size cells. The slow-start model was added
after CATS was frozen, and CATS was not retuned for it.
