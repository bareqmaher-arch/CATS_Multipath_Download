import { algorithm } from './algorithms.ts'
import { MB } from './network.ts'
import { scenario, SCENARIOS } from './scenarios.ts'
import { Sim } from './sim.ts'

// Quick look before a sweep: a few runs per scenario, with the invariants every run must keep and
// how long the simulator takes.

const sizeMB = Number(process.argv[2] ?? 200)
const tcp = (process.argv[3] ?? 'fluid') as 'fluid' | 'slowstart'
const names = [
  'plexo',
  'plexo-mux',
  'plexo-mux2',
  'plexo-mux3',
  'cats',
  'cats2',
  'cats3',
  'cats4',
  'cats4-fixedSize',
  'cats5',
  'cats-noSplit',
  'cats-noFactor'
]
let failures = 0

for (const s of SCENARIOS) {
  for (const name of names) {
    const started = performance.now()
    const { scheduler, networkIds } = algorithm(name, scenario(s.id))
    const sim = new Sim({ scenario: s, fileBytes: sizeMB * MB, seed: 1, scheduler, networkIds, tcp })
    const r = sim.run()
    const ms = performance.now() - started

    const covered = sim.blocks.reduce((sum, b) => sum + sim.blockLength(b), 0)
    const problems = [
      r.timedOut && 'timed out',
      Math.abs(covered - sim.fileBytes) > 0.5 && `blocks cover ${covered} of ${sim.fileBytes}`,
      sim.blocks.some((b) => b.status !== 'completed') && 'unfinished blocks',
      r.wastedBytes < -1 && `negative waste ${r.wastedBytes}`,
      sim.live.length > 0 && 'attempts still live',
      r.completionS < r.lowerBoundS - 0.05 && `beat the lower bound (${r.lowerBoundS.toFixed(2)})`
    ].filter(Boolean)
    if (problems.length) failures++

    console.log(
      [
        s.id.padEnd(14),
        name.padEnd(14),
        `T=${r.completionS.toFixed(2)}s`.padEnd(11),
        `LB=${r.lowerBoundS.toFixed(2)}`.padEnd(10),
        `tail=${r.tailS.toFixed(2)}`.padEnd(11),
        `waste=${(r.wastedBytes / MB).toFixed(1)}MB`.padEnd(14),
        `req=${r.requests}`.padEnd(8),
        `split=${r.splits} hedge=${r.hedges} refresh=${r.refreshes} fail=${r.failures}`.padEnd(40),
        `${ms.toFixed(0)}ms`,
        problems.length ? `  !! ${problems.join('; ')}` : ''
      ].join(' ')
    )
  }
}
if (failures) {
  console.error(`${failures} runs broke an invariant`)
  process.exit(1)
}
