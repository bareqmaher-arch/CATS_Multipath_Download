import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from './baselines/resolve.ts'
import { MB, type Scenario } from './network.ts'
import { scenario } from './scenarios.ts'
import { Sim } from './sim.ts'

// Does the CATS gain hold as the server moves further away? Slow start and new connections cost
// in round trips, so every network's RTT is scaled up, with TCP slow start on. Held-out seeds.
//
// Usage: node --experimental-strip-types src/sensitivity.ts [seeds] [firstSeed] [outDir] [algorithms]

const seeds = Number(process.argv[2] ?? 100)
const firstSeed = Number(process.argv[3] ?? 1001)
const outDir = new URL(`../results/${process.argv[4] ?? 'slowstart'}/`, import.meta.url)
const names = process.argv[5]?.split(',') ?? ['plexo', 'cats', 'cats2']
mkdirSync(outDir, { recursive: true })

function farther(base: Scenario, factor: number): Scenario {
  return {
    ...base,
    networks: base.networks.map((n) => ({ ...n, rttMs: n.rttMs * factor }))
  }
}

const rows = ['scenario,rttFactor,sizeMB,seed,algorithm,completionS,lowerBoundS,wastedMB,splits,hedges']
for (const id of ['S1-stable', 'S2-hetero', 'S4-stragglers', 'S6-three']) {
  for (const factor of [1, 4, 10]) {
    const s = farther(scenario(id), factor)
    for (const sizeMB of [20, 200]) {
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
          if (r.timedOut) throw new Error(`${id} x${factor} ${sizeMB} MB seed ${seed} ${name} timed out`)
          rows.push(
            [id, factor, sizeMB, seed, name, r.completionS.toFixed(3), r.lowerBoundS.toFixed(3),
              (r.wastedBytes / MB).toFixed(3), r.splits, r.hedges].join(',')
          )
        }
      }
    }
    console.log(`${id} RTT x${factor} done`)
  }
}
writeFileSync(new URL('rtt_sensitivity.csv', outDir), rows.join('\n') + '\n')
