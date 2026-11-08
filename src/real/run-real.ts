import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from '../baselines/resolve.ts'
import { MB, type Scenario } from '../network.ts'
import { mixSeed, Rng } from '../rng.ts'
import { scenario } from '../scenarios.ts'
import { RealEngine } from './engine.ts'
import { Shaper } from './shaper.ts'

// Paired runs on the real testbed: for each scenario, RTT factor, size and seed, every algorithm
// downloads the same file through the same replayed capacity, in an order shuffled per seed.
// Runs inside the client namespace (testbed/run.sh). Rows are appended as they finish, so a
// stopped run keeps what it has; rows already in the file are skipped on a rerun.
//
// Usage: node --experimental-strip-types src/real/run-real.ts <out.csv> <scenarios> <rttFactors>
//        <sizesMB> <firstSeed> <seeds> <algorithms>
// Lists are comma-separated.

const [outPath, scenarioList, factorList, sizeList, firstSeedArg, seedsArg, algorithmList] =
  process.argv.slice(2)
const scenarios = scenarioList.split(',')
const factors = factorList.split(',').map(Number)
const sizes = sizeList.split(',').map(Number)
const firstSeed = Number(firstSeedArg)
const seeds = Number(seedsArg)
const names = algorithmList.split(',')

const COLUMNS = [
  'scenario', 'rttFactor', 'sizeMB', 'seed', 'algorithm', 'order', 'completionS', 'lowerBoundS',
  'tailS', 'appMB', 'ifaceMB', 'meteredIfaceMB', 'requests', 'connections', 'splits', 'hedges',
  'refreshes', 'failures', 'meanTickMs', 'shaperErrors', 'timedOut'
]

function farther(base: Scenario, factor: number): Scenario {
  return { ...base, networks: base.networks.map((n) => ({ ...n, rttMs: n.rttMs * factor })) }
}

function rxBytes(i: number): number {
  return Number(readFileSync(`/sys/class/net/c${i}/statistics/rx_bytes`, 'utf8'))
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const done = new Set<string>()
mkdirSync(outPath.replace(/[^/]+$/, ''), { recursive: true })
if (existsSync(outPath)) {
  for (const line of readFileSync(outPath, 'utf8').trim().split('\n').slice(1)) {
    const cells = line.split(',')
    done.add(cells.slice(0, 5).join(','))
  }
} else {
  writeFileSync(outPath, COLUMNS.join(',') + '\n')
}

for (const id of scenarios) {
  for (const factor of factors) {
    const s = farther(scenario(id), factor)
    const endpoints = Object.fromEntries(
      s.networks.map((n, i) => [n.id, { host: `10.${i + 1}.0.1`, localAddress: `10.${i + 1}.0.2` }])
    )
    for (const sizeMB of sizes) {
      for (let seed = firstSeed; seed < firstSeed + seeds; seed++) {
        const order = [...names]
        const rng = new Rng(mixSeed(seed, 0x5eed))
        for (let i = order.length - 1; i > 0; i--) {
          const j = Math.floor(rng.next() * (i + 1))
          ;[order[i], order[j]] = [order[j], order[i]]
        }
        for (const [position, name] of order.entries()) {
          const key = [id, factor, sizeMB, seed, name].join(',')
          if (done.has(key)) continue

          const shaper = new Shaper(s, seed)
          await shaper.reset()
          // Let queues drain and the previous run's connections close.
          await sleep(1500)
          const before = s.networks.map((_, i) => rxBytes(i))

          const resolved = resolve(name, s)
          const engine = new RealEngine({
            scenario: resolved.scenario,
            fileBytes: sizeMB * MB,
            seed,
            scheduler: resolved.scheduler,
            networkIds: resolved.networkIds,
            tcp: 'slowstart',
            maxTime: 300,
            endpoints,
            path: `/f${sizeMB}.bin`,
            h1Port: 8080,
            h2Port: 8081
          })
          resolved.attach?.(engine)
          shaper.start()
          const r = await engine.runReal()
          shaper.stop()
          await sleep(300)
          const iface = s.networks.map((_, i) => rxBytes(i) - before[i])
          const metered = s.networks.reduce((sum, n, i) => sum + (n.metered ? iface[i] : 0), 0)

          appendFileSync(
            outPath,
            [
              id, factor, sizeMB, seed, name, position, r.completionS.toFixed(3),
              r.lowerBoundS.toFixed(3), r.tailS.toFixed(3), (r.appBytes / MB).toFixed(3),
              (iface.reduce((a, b) => a + b, 0) / MB).toFixed(3), (metered / MB).toFixed(3),
              r.requests, r.connections, r.splits, r.hedges, r.refreshes, r.failures,
              r.meanTickMs.toFixed(2), shaper.errors, r.timedOut ? 1 : 0
            ].join(',') + '\n'
          )
          const errors = Object.entries(r.errors).map(([k, v]) => `${k}x${v}`).join(' ')
          console.log(`${key}: ${r.completionS.toFixed(2)} s (lb ${r.lowerBoundS.toFixed(2)}), ${r.requests} req, tick ${r.meanTickMs.toFixed(1)} ms${errors ? `, errors ${errors}` : ''}${r.timedOut ? ' TIMED OUT' : ''}`)
        }
      }
    }
  }
}
