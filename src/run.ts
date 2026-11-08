import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from './baselines/resolve.ts'
import { MB } from './network.ts'
import { scenario, SCENARIOS } from './scenarios.ts'
import { Sim } from './sim.ts'

// The sweeps behind the analysis. Every algorithm runs on the same seeds, so a seed's network is
// identical across algorithms and results can be compared pair by pair.
//
//   main   every scenario x size, Plexo against CATS and its two ablations, cost ignored
//   cost   metered 4G priced at a range of lambdas, against Plexo on all networks and on Wi-Fi
//
// Usage: node --experimental-strip-types src/run.ts [main|cost|all] [seeds] [firstSeed] [tcp] [outDir] [algorithms]
//
// CATS was developed against seeds 1-50 under the fluid TCP model and checked on 1001-1100;
// cats2 was designed after seeing 1001-1100, so it is checked on 2001-2100, and cats3 after
// seeing 2001-2100, so on 3001-3100. tcp is 'fluid' or 'slowstart' (see sim.ts); results go to
// results/<outDir>/, by default results/<tcp>/. algorithms is a comma list for the main sweep.

const which = process.argv[2] ?? 'all'
const seeds = Number(process.argv[3] ?? 100)
const firstSeed = Number(process.argv[4] ?? 1001)
const tcp = (process.argv[5] ?? 'fluid') as 'fluid' | 'slowstart'
const outDir = new URL(`../results/${process.argv[6] ?? tcp}/`, import.meta.url)
mkdirSync(outDir, { recursive: true })

const COLUMNS = [
  'experiment',
  'scenario',
  'sizeMB',
  'seed',
  'algorithm',
  'completionS',
  'lowerBoundS',
  'tailS',
  'totalMB',
  'meteredMB',
  'wastedMB',
  'requests',
  'splits',
  'hedges',
  'refreshes',
  'failures',
  'timedOut'
]

function sweep(experiment: string, scenarioIds: string[], sizes: number[], names: string[]): void {
  const rows = [COLUMNS.join(',')]
  const started = performance.now()
  for (const id of scenarioIds) {
    for (const sizeMB of sizes) {
      for (let seed = firstSeed; seed < firstSeed + seeds; seed++) {
        for (const name of names) {
          const resolved = resolve(name, scenario(id))
          const sim = new Sim({
            scenario: resolved.scenario,
            fileBytes: sizeMB * MB,
            seed,
            scheduler: resolved.scheduler,
            networkIds: resolved.networkIds,
            tcp
          })
          resolved.attach?.(sim)
          const r = sim.run()
          rows.push(
            [
              experiment,
              id,
              sizeMB,
              seed,
              name,
              r.completionS.toFixed(3),
              r.lowerBoundS.toFixed(3),
              r.tailS.toFixed(3),
              (r.totalBytes / MB).toFixed(3),
              (r.meteredBytes / MB).toFixed(3),
              (r.wastedBytes / MB).toFixed(3),
              r.requests,
              r.splits,
              r.hedges,
              r.refreshes,
              r.failures,
              r.timedOut ? 1 : 0
            ].join(',')
          )
        }
      }
      console.log(`${experiment} ${id} ${sizeMB} MB done (${((performance.now() - started) / 1000).toFixed(0)} s)`)
    }
  }
  writeFileSync(new URL(`${experiment}.csv`, outDir), rows.join('\n') + '\n')
}

if (which === 'main' || which === 'all') {
  sweep(
    'main',
    SCENARIOS.map((s) => s.id),
    [20, 200, 1000],
    process.argv[7]?.split(',') ?? ['plexo', 'cats', 'cats2', 'cats-noSplit', 'cats-noFactor']
  )
}
if (which === 'cost' || which === 'all') {
  const lambdas = ['0', '0.02', '0.05', '0.1', '0.2', '0.3', '0.5', '1', '2', 'inf']
  sweep(
    'cost',
    ['S1-stable', 'S3-flaky'],
    [200],
    ['plexo', 'plexo-free', ...lambdas.map((l) => `cats-l${l}`)]
  )
}
