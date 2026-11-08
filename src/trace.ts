import { algorithm } from './algorithms.ts'
import { MB } from './network.ts'
import { scenario } from './scenarios.ts'
import { Sim } from './sim.ts'

// Prints one run's events, to see why a run went the way it did.
// Usage: node --experimental-strip-types src/trace.ts <scenario> <sizeMB> <seed> <algorithm> [tcp] [rttFactor]

const [id, size, seedArg, name, tcpArg, rttArg] = process.argv.slice(2)
const base = scenario(id)
const factor = Number(rttArg ?? 1)
const s = { ...base, networks: base.networks.map((n) => ({ ...n, rttMs: n.rttMs * factor })) }
const { scheduler, networkIds } = algorithm(name, s)
const tcp = (tcpArg ?? 'fluid') as 'fluid' | 'slowstart'
const sim = new Sim({ scenario: s, fileBytes: Number(size) * MB, seed: Number(seedArg), scheduler, networkIds, tcp })

const mb = (bytes: number): string => (bytes / MB).toFixed(2)
const at = (): string => sim.t.toFixed(2).padStart(6)

const pick = scheduler.pick
scheduler.pick = (simArg, stream) => {
  const before = sim.splits
  const work = pick(simArg, stream)
  if (work) {
    const b = work.block
    console.log(
      `${at()} s${stream.id}@${stream.net.id} ${work.kind}${sim.splits > before ? '(split)' : ''} ` +
        `#${b.index} [${mb(b.rangeStart)}-${mb(b.rangeEnd + 1)}] ${mb(sim.blockLength(b))}MB ` +
        `last=${mb(stream.lastBlockSpeed)}MB/s conn=${stream.conn ? stream.conn.q.toFixed(3) : 'new'}`
    )
  }
  return work
}
const complete = sim.complete.bind(sim)
sim.complete = (attempt) => {
  console.log(
    `${at()} s${attempt.stream.id}@${attempt.stream.net.id} done #${attempt.block.index} ` +
      `${mb(attempt.received)}MB in ${(sim.t - attempt.startedAt).toFixed(2)}s q=${attempt.stream.conn?.q.toFixed(3)}`
  )
  complete(attempt)
}
const abort = sim.abort.bind(sim)
sim.abort = (attempt, reason) => {
  console.log(`${at()} s${attempt.stream.id}@${attempt.stream.net.id} ${reason} #${attempt.block.index}`)
  abort(attempt, reason)
}

const r = sim.run()
console.log(r)
