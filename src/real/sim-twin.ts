import { writeFileSync } from 'node:fs'
import { resolve } from '../baselines/resolve.ts'
import { MB } from '../network.ts'
import { scenario } from '../scenarios.ts'
import { Sim } from '../sim.ts'

// The simulator's prediction for exactly the cells and seeds the real testbed runs
// (testbed/experiment.sh), with slow start, so the two can be compared seed by seed.
//
// Usage: node --experimental-strip-types src/real/sim-twin.ts [firstSeed] [seeds] [algorithms] [out]

const firstSeed = Number(process.argv[2] ?? 6001)
const seeds = Number(process.argv[3] ?? 30)
const names = process.argv[4]?.split(',') ?? ['plexo', 'cats5', 'plexo-mux3']
const out = process.argv[5] ?? 'sim-twin.csv'
const cells: [string, number, number][] = []
for (const id of ['S1-stable', 'S2-hetero', 'S3-flaky', 'S6-three']) {
  cells.push([id, 1, 20], [id, 1, 200], [id, 4, 20])
}

const rows = ['scenario,rttFactor,sizeMB,seed,algorithm,completionS,requests']
for (const [id, factor, sizeMB] of cells) {
  const base = scenario(id)
  const s = { ...base, networks: base.networks.map((n) => ({ ...n, rttMs: n.rttMs * factor })) }
  for (let seed = firstSeed; seed < firstSeed + seeds; seed++) {
    for (const name of names) {
      const resolved = resolve(name, s)
      const sim = new Sim({
        scenario: resolved.scenario,
        fileBytes: sizeMB * MB,
        seed,
        scheduler: resolved.scheduler,
        networkIds: resolved.networkIds,
        tcp: 'slowstart'
      })
      resolved.attach?.(sim)
      const r = sim.run()
      rows.push([id, factor, sizeMB, seed, name, r.completionS.toFixed(3), r.requests].join(','))
    }
  }
}
writeFileSync(new URL(`../../results/real/${out}`, import.meta.url), rows.join('\n') + '\n')
