import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from './baselines/resolve.ts'
import { scenario } from './scenarios.ts'
import { Sim } from './sim.ts'

// 20 MB downloads with slow start, at RTT x1 and x10, recording how many new connections each
// algorithm opens: dropped connections (split truncations, lost races) reconnect from scratch.
//
// Usage: node --experimental-strip-types src/churn.ts [seeds] [firstSeed] [outDir] [algorithms]

const seeds = Number(process.argv[2] ?? 100)
const firstSeed = Number(process.argv[3] ?? 2001)
const outDir = process.argv[4] ?? 'r2-slowstart'
const names = process.argv[5]?.split(',') ?? ['plexo', 'cats', 'cats2']
const rows = ['scenario,rttFactor,seed,algorithm,completionS,connections,requests,splits,hedges,wastedMB']
for (const id of ['S6-three', 'S1-stable', 'S4-stragglers']) {
  for (const factor of [1, 10]) {
    const base = scenario(id)
    const s = { ...base, networks: base.networks.map((n) => ({ ...n, rttMs: n.rttMs * factor })) }
    for (let seed = firstSeed; seed < firstSeed + seeds; seed++) {
      for (const name of names) {
        const resolved = resolve(name, s)
        const sim = new Sim({
          scenario: resolved.scenario,
          fileBytes: 20e6,
          seed,
          scheduler: resolved.scheduler,
          networkIds: resolved.networkIds,
          tcp: 'slowstart'
        })
        resolved.attach?.(sim)
        const r = sim.run()
        rows.push(
          [id, factor, seed, name, r.completionS.toFixed(3), r.connections, r.requests, r.splits,
            r.hedges, (r.wastedBytes / 1e6).toFixed(3)].join(',')
        )
      }
    }
  }
}
mkdirSync(new URL(`../results/${outDir}/`, import.meta.url), { recursive: true })
writeFileSync(new URL(`../results/${outDir}/churn_20MB.csv`, import.meta.url), rows.join('\n') + '\n')
