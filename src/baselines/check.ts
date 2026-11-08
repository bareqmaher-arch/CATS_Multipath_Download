import { MB, type NetworkSpec, type Scenario } from '../network.ts'
import { SCENARIOS } from '../scenarios.ts'
import { Sim } from '../sim.ts'
import { resolve } from './resolve.ts'

// Two checks on the published baselines before they are compared with anything.
//
// 1. Invariants on every scenario (as src/check.ts does for the rest).
// 2. MP-H2 against what its paper reports, in the paper's own stable setting (section 5.3):
//    WiFi and LTE at 5 or 10 Mbps, RTT 28 and 65 ms (section 5.5), files of 0.5 to 4 MB.
//    Expected: both paths finish together (Algorithm 1 balances them to within delta = 50 ms
//    plus a round trip), and MP-H2 is 0.1-11% slower than MPTCP for 1 MB and larger files, 2-25%
//    for 512 KB (section 5.3). Our MPTCP is idealised, so MP-H2 should sit at the upper end.
//
// Usage: node --experimental-strip-types src/baselines/check.ts

const BASELINES = [
  'mph2', 'mph2-eq', 'mptcp', 'fl', 'fl-eq', 'mdtp', 'mdtp-eq', 'twoway', 'twoway-eq', 'rb', 'rb-eq', 'cats6', 'cats7', 'cats8'
]

let broken = 0
for (const s of SCENARIOS) {
  for (const sizeMB of [20, 200]) {
    for (const name of BASELINES) {
      const resolved = resolve(name, s)
      const sim = new Sim({
        scenario: resolved.scenario,
        fileBytes: sizeMB * MB,
        seed: 1,
        scheduler: resolved.scheduler,
        networkIds: resolved.networkIds,
        tcp: 'slowstart'
      })
      resolved.attach?.(sim)
      const r = sim.run()
      const covered = sim.blocks.reduce((sum, b) => sum + sim.blockLength(b), 0)
      const problems = [
        r.timedOut && 'timed out',
        Math.abs(covered - sim.fileBytes) > 0.5 && `blocks cover ${covered}`,
        sim.blocks.some((b) => b.status !== 'completed') && 'unfinished blocks',
        r.completionS < r.lowerBoundS - 0.05 && 'beat the lower bound'
      ].filter(Boolean)
      if (problems.length) broken++
      console.log(
        `${s.id.padEnd(14)} ${String(sizeMB).padStart(4)} MB ${name.padEnd(8)} T=${r.completionS.toFixed(2)} ` +
          `LB=${r.lowerBoundS.toFixed(2)} req=${r.requests} split=${r.splits} conn=${r.connections}` +
          (problems.length ? `  !! ${problems.join('; ')}` : '')
      )
    }
  }
}

function link(id: string, mbps: number, rttMs: number, metered: boolean): NetworkSpec {
  return {
    id, baseMBps: mbps / 8, rttMs, metered, sigma: 0, corrSec: 5, fadeRate: 0, fadeLevel: 1,
    fadeMeanSec: 1, outageRate: 0, outageMeanSec: 1
  }
}

console.log('\nMP-H2 in the paper setting (stable, slow start): time, gap between the paths finishing')
for (const [wifi, lte] of [[5, 5], [5, 10], [10, 5]]) {
  const scenario: Scenario = {
    id: `W${wifi}-C${lte}`,
    label: 'paper',
    networks: [link('wifi', wifi, 28, false), link('lte', lte, 65, true)],
    connection: { serverCapMBps: null, badConnProb: 0, stallRate: 0, stallMeanSec: 1, stallPermanentProb: 0 },
    streamsPerNetwork: 1
  }
  for (const sizeMB of [0.5, 1, 2, 4]) {
    const times: Record<string, number> = {}
    let gap = 0
    for (const name of ['mph2', 'mptcp']) {
      const resolved = resolve(name, scenario)
      const sim = new Sim({
        scenario: resolved.scenario,
        fileBytes: sizeMB * MB,
        seed: 1,
        scheduler: resolved.scheduler,
        tcp: 'slowstart'
      })
      resolved.attach?.(sim)
      const finished: Record<string, number> = {}
      const complete = sim.complete.bind(sim)
      sim.complete = (attempt) => {
        finished[attempt.stream.net.id] = sim.t
        complete(attempt)
      }
      times[name] = sim.run().completionS
      if (name === 'mph2') gap = Math.abs((finished.wifi ?? 0) - (finished.lte ?? 0))
    }
    const slower = (times.mph2 / times.mptcp - 1) * 100
    console.log(
      `${scenario.id.padEnd(7)} ${String(sizeMB).padStart(4)} MB  mph2 ${times.mph2.toFixed(3)} s  ` +
        `mptcp ${times.mptcp.toFixed(3)} s  mph2 slower by ${slower.toFixed(1)}%  paths finish ${(gap * 1000).toFixed(0)} ms apart`
    )
  }
}
// 3. Follower-Leader in its paper's simulation (section III): interface N at 8 Mbps, interface M
//    at 1 to 0.1 times that, normal chunk 1 MB. Expected: both interfaces are busy for about the
//    same time (they finish together) and the total is close to one interface with both rates.
console.log('\nFollower-Leader in the paper setting (stable, fluid): time, ideal, gap between the interfaces finishing')
for (const ratio of [1, 0.5, 0.1]) {
  const scenario: Scenario = {
    id: `N8-M${ratio}`,
    label: 'paper',
    networks: [link('n', 8, 20, false), link('m', 8 * ratio, 20, false)],
    connection: { serverCapMBps: null, badConnProb: 0, stallRate: 0, stallMeanSec: 1, stallPermanentProb: 0 },
    streamsPerNetwork: 1
  }
  const sizeMB = 100
  const resolved = resolve('fl', scenario)
  const sim = new Sim({ scenario: resolved.scenario, fileBytes: sizeMB * MB, seed: 1, scheduler: resolved.scheduler })
  const finished: Record<string, number> = {}
  const complete = sim.complete.bind(sim)
  sim.complete = (attempt) => {
    finished[attempt.stream.net.id] = sim.t
    complete(attempt)
  }
  const r = sim.run()
  const ideal = (sizeMB * MB) / (((8 + 8 * ratio) / 8) * MB)
  console.log(
    `${scenario.id.padEnd(8)} fl ${r.completionS.toFixed(1)} s  ideal ${ideal.toFixed(1)} s  ` +
      `interfaces finish ${Math.abs(finished.n - finished.m).toFixed(2)} s apart  requests ${r.requests}`
  )
}

if (broken) {
  console.error(`${broken} runs broke an invariant`)
  process.exit(1)
}
