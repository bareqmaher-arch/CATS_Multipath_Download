import { writeFileSync } from 'node:fs'
import { resolve } from '../baselines/resolve.ts'
import { MB, type Scenario } from '../network.ts'
import { scenario } from '../scenarios.ts'
import { RealEngine } from './engine.ts'
import { Shaper } from './shaper.ts'

// A tick-by-tick trace of single testbed runs, for diagnosis: what every connection received and
// had outstanding on each 10 ms tick. One row per stream per tick, and the run's summary on stdout.
// Runs inside the client namespace, after testbed/setup.sh. Development seeds only (690x).
//
// Usage: node --experimental-strip-types src/real/trace-real.ts <out-prefix> <scenario> <rttFactor>
//        <sizeMB> <seed> <algorithms>
// Writes <out-prefix>-<algorithm>.csv.

const [prefix, id, factorArg, sizeArg, seedArg, algorithmList] = process.argv.slice(2)
const factor = Number(factorArg)
const sizeMB = Number(sizeArg)
const seed = Number(seedArg)

function farther(base: Scenario, f: number): Scenario {
  return { ...base, networks: base.networks.map((n) => ({ ...n, rttMs: n.rttMs * f })) }
}

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))
const s = farther(scenario(id), factor)
const endpoints = Object.fromEntries(
  s.networks.map((n, i) => [n.id, { host: `10.${i + 1}.0.1`, localAddress: `10.${i + 1}.0.2` }])
)

for (const name of algorithmList.split(',')) {
  const shaper = new Shaper(s, seed)
  await shaper.reset()
  await sleep(1500)
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
  const rows = ['t,stream,net,block,kind,startup,raw,committedAhead,issuedAhead,prefetched,speed,tail']
  const transfer = engine.transfer.bind(engine)
  engine.transfer = ((...args: Parameters<RealEngine['transfer']>) => {
    const raw = new Map(engine.rawByStream)
    transfer(...args)
    const tail = engine.allAssigned() ? 1 : 0
    const prefetchedBy = new Set([...engine.prefetched.values()].map((p) => p.stream))
    for (const [i, stream] of engine.streams.entries()) {
      const a = stream.attempt
      const io = a ? engine.io.get(a) : undefined
      const pos = a ? engine.position(a) : 0
      rows.push([
        engine.t.toFixed(3), i, stream.net.id, a ? a.block.index : -1, a ? a.kind[0] : '-',
        a ? (a.startupLeft > 0 ? 1 : 0) : 0, raw.get(stream) ?? 0,
        a ? Math.round(Math.min(a.committed, engine.blockLength(a.block)) - pos) : 0,
        io ? Math.round(io.issuedEnd - pos) : 0, prefetchedBy.has(stream) ? 1 : 0,
        Math.round(stream.speed), tail
      ].join(','))
    }
  }) as RealEngine['transfer']
  shaper.start()
  const r = await engine.runReal()
  shaper.stop()
  writeFileSync(`${prefix}-${name}.csv`, rows.join('\n') + '\n')
  console.log(`${name}: ${r.completionS.toFixed(2)} s (lb ${r.lowerBoundS.toFixed(2)}), tail ${r.tailS.toFixed(2)}, ` +
    `${r.requests} req, ${r.connections} conn, ${r.splits} splits, ${r.hedges} copies`)
  await sleep(300)
}
