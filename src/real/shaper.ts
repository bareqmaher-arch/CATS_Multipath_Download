import { execFile } from 'node:child_process'
import { CapacityTrace, GRID_S, type Scenario } from '../network.ts'

// Plays a scenario's capacity onto the testbed's links with netem: for network i, the server's
// end of its veth (s<i>) carries the downlink at the capacity Sim would give it for this seed,
// updated every 100 ms, plus half the round trip; the client's end (c<i>) adds the other half.
// The traces are Sim's own CapacityTrace, so a seed means the same network here as there.

/** Below this a link counts as out: netem drops everything rather than run at a trickle. */
const OUT_BPS = 16_000

function tc(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('tc', args, (error, _stdout, stderr) => (error ? reject(new Error(`tc ${args.join(' ')}: ${stderr}`)) : resolve()))
  })
}

export class Shaper {
  scenario: Scenario
  traces: CapacityTrace[]
  timer: NodeJS.Timeout | null = null
  started = 0
  applied: string[] = []
  errors = 0

  constructor(scenario: Scenario, seed: number) {
    this.scenario = scenario
    this.traces = scenario.networks.map((spec, i) => new CapacityTrace(spec, seed, i))
  }

  /** Queue room for twice the link's bandwidth-delay product at its base speed, in packets. */
  limit(i: number): number {
    const spec = this.scenario.networks[i]
    const bdpBytes = spec.baseMBps * 1e6 * (spec.rttMs / 1000)
    return Math.max(100, Math.ceil((2 * bdpBytes) / 1500))
  }

  downlink(i: number, bps: number): string[] {
    const half = `${this.scenario.networks[i].rttMs / 2}ms`
    const common = ['-n', 'srv', 'qdisc', 'replace', 'dev', `s${i}`, 'root', 'netem', 'delay', half]
    if (bps < OUT_BPS) return [...common, 'loss', '100%', 'limit', String(this.limit(i))]
    return [...common, 'rate', `${Math.round(bps / 1000)}kbit`, 'limit', String(this.limit(i))]
  }

  /** Sets every link to its state at t = 0, and the uplinks' delay. */
  async reset(): Promise<void> {
    for (let i = 0; i < this.scenario.networks.length; i++) {
      const half = `${this.scenario.networks[i].rttMs / 2}ms`
      await tc(['-n', 'cli', 'qdisc', 'replace', 'dev', `c${i}`, 'root', 'netem', 'delay', half, 'limit', '10000'])
      await tc(this.downlink(i, this.traces[i].at(0) * 8))
      this.applied[i] = ''
    }
  }

  start(): void {
    this.started = performance.now()
    const step = (): void => {
      const t = (performance.now() - this.started) / 1000
      for (let i = 0; i < this.traces.length; i++) {
        const args = this.downlink(i, this.traces[i].at(t) * 8)
        const key = args.join(' ')
        if (key === this.applied[i]) continue
        this.applied[i] = key
        tc(args).catch(() => this.errors++)
      }
    }
    step()
    this.timer = setInterval(step, GRID_S * 1000)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
