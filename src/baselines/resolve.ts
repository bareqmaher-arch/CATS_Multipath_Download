import { algorithm } from '../algorithms.ts'
import type { Scenario } from '../network.ts'
import type { Scheduler, Sim, Stream, Work } from '../sim.ts'
import { mph2, onePerPath, type BaselineState } from './mph2.ts'
import { mptcp } from './mptcp.ts'
import { followerLeader } from './fl.ts'
import { mdtp } from './mdtp.ts'
import { rodriguezBiersack } from './rb.ts'
import { twoWay } from './twoway.ts'
import { cats6 } from '../cats6.ts'
import { cats7 } from '../cats7.ts'
import { cats8, cats8Parts } from '../cats8.ts'

// Every algorithm by name, the published baselines included, for the runners. The frozen
// algorithms (src/algorithms.ts) are passed through untouched. A baseline may run on a different
// number of connections than the scenario's, and needs two things the frozen engine doesn't
// offer, added to an engine instance by attach():
//
// - a look at every step (MP-H2's Algorithm 1 runs on every receipt of data);
// - pipelining: a range asked for while the stream's current one is still arriving starts
//   arriving one response delay after it was asked for, not one round trip after the current
//   one ends. On the simulator that is the new attempt's startup; on the testbed the request is
//   really sent early (RealEngine.prefetch).
//
//   plexo, cats5, ...  see src/algorithms.ts
//   mph2               MP-H2+FS, one connection per path (the paper's design)
//   mph2-eq            MP-H2+FS on the scenario's connections, each treated as a path
//   mptcp              idealised MPTCP, one subflow per path (simulator only)
//   fl, fl-eq          Follower-Leader (Salkintzis 2025), one connection per path / all of them
//   mdtp, mdtp-eq      MDTP's chunk sizing (ICCCN 2025), paths as its sources
//   twoway, twoway-eq  two-way download: MPRD (ICDCS 2025) with descending range requests
//   rb, rb-eq          dynamic parallel access with end-game copies (Rodriguez, Biersack 2002)

export interface Resolved {
  scheduler: Scheduler
  networkIds?: string[]
  scenario: Scenario
  attach?: (engine: Sim) => void
}

export function resolve(name: string, scenario: Scenario): Resolved {
  if (name === 'mph2') return withState(mph2(name), onePerPath(scenario))
  if (name === 'mph2-eq') return withState(mph2(name), scenario)
  if (name === 'mptcp') return withState(mptcp(name), onePerPath(scenario))
  // Diagnostics for why MP-H2 does worse on the testbed than on the simulator: its Equation 1
  // and pipelining timed by the base RTT instead of the PING-measured delay (which queues
  // lengthen), or sub-ranges five times longer (fewer HTTP/2 requests standing in for its
  // flow-control window updates).
  if (name === 'mph2-eq-basedelay') {
    const built = mph2(name)
    built.state.baseDelay = true
    return withState(built, scenario)
  }
  if (name === 'mph2-eq-coarse') return withState(mph2(name), scenario, 0.5)
  if (name === 'fl') return { scheduler: followerLeader(name), scenario: onePerPath(scenario) }
  if (name === 'fl-eq') return { scheduler: followerLeader(name), scenario }
  if (name === 'mdtp') return { scheduler: mdtp(name), scenario: onePerPath(scenario) }
  if (name === 'mdtp-eq') return { scheduler: mdtp(name), scenario }
  if (name === 'twoway') return withState(twoWay(name), onePerPath(scenario))
  if (name === 'twoway-eq') return withState(twoWay(name), scenario)
  if (name === 'rb') return withState(rodriguezBiersack(name), onePerPath(scenario))
  if (name === 'rb-eq') return withState(rodriguezBiersack(name), scenario)
  // cats5 with its next block pipelined (src/cats6.ts); cats5's own transport is kept.
  if (name === 'cats6') return withState(cats6(name, scenario), scenario, BASELINE_SUBRANGE_S, true)
  // cats6 with the tail thresholds scaled to the download (src/cats7.ts). cats7-<parts> keeps
  // only the listed scalings, for development: s(teal), o(bserve), g(ain), f(ine), t(ail
  // sub-ranges), h(ealthy holders only),
  // c(old-taker guard), x = none.
  if (name === 'cats7') return withState(cats7(name), scenario, BASELINE_SUBRANGE_S, true)
  const partial = /^cats7-([sogfthcx]+)$/.exec(name)
  if (partial) {
    const has = (c: string) => partial[1].includes(c)
    const scaling = { steal: has('s'), observe: has('o'), gain: has('g'), fine: has('f'), tailSubranges: has('t'),
      healthyOnly: has('h'), coldGuard: has('c') }
    return withState(cats7(name, scaling), scenario, BASELINE_SUBRANGE_S, true)
  }
  // cats6 with its pre-pick timed by the base RTT (src/cats8.ts). cats8-<parts> keeps only the listed
  // parts, for development (letters in src/cats8.ts).
  if (name === 'cats8') return withState(cats8(name), scenario, BASELINE_SUBRANGE_S, true)
  const parts = /^cats8-([bnptwrx]+)$/.exec(name)
  if (parts) return withState(cats8(name, cats8Parts(parts[1])), scenario, BASELINE_SUBRANGE_S, true)
  if (name === 'cats6-fine') {
    return withState(cats6(name, scenario, true), scenario, BASELINE_SUBRANGE_S, true)
  }
  return { ...algorithm(name, scenario), scenario }
}

/** MP-H2 ends a range with HTTP/2 flow control, opening the server's window about a round trip
 * ahead (paper section 3.4.2), so what it has committed to is a bandwidth-delay product, not a
 * sub-range of Sim's 512 KiB. Its sub-ranges here are a tenth of a second of data, or two
 * measured response delays where those are longer (on the testbed, queues lengthen them), so a
 * sub-range is asked for before the one before it runs out, as an open window never stalls;
 * between 64 KiB and 2 MiB. The idealised MPTCP uses the same. */
const BASELINE_SUBRANGE_S = 0.1
const BASELINE_SUBRANGE_MIN = 64 * 1024
const BASELINE_SUBRANGE_MAX = 2 * 1024 * 1024

function withState(
  built: { scheduler: Scheduler; state: BaselineState },
  scenario: Scenario,
  subrangeSeconds = BASELINE_SUBRANGE_S,
  /** Keep the scheduler's own sub-range sizing and lead (cats6), not MP-H2's. */
  ownTransport = false
): Resolved {
  const { scheduler, state } = built
  return {
    scheduler,
    scenario,
    attach(engine) {
      if (!ownTransport) baselineTransport(engine, state, subrangeSeconds)
      pipelining(engine, state)
      measureResponseDelay(engine, state)
    }
  }
}

function baselineTransport(engine: Sim, state: BaselineState, subrangeSeconds: number): void {
  engine.subrangeSize = (stream: Stream) => {
    const horizon = Math.max(subrangeSeconds, 2 * (state.responseDelay.get(stream) ?? 0))
    return Math.min(
      Math.max(stream.speed * horizon, BASELINE_SUBRANGE_MIN),
      BASELINE_SUBRANGE_MAX
    )
  }

  // MP-H2 times its window updates by the PING-measured response delay, queues included
  // (section 3.4.1), not the path's base RTT that Sim's askAhead uses: keep that much asked
  // for ahead, so a new sub-range always arrives before the last one runs out. The original
  // askAhead then finds nothing to add, and on the testbed sends what was added.
  const askAhead = engine.askAhead.bind(engine)
  engine.askAhead = () => {
    for (const attempt of engine.live) {
      if (attempt.startupLeft > 0) continue
      const stream = attempt.stream
      const length = engine.blockLength(attempt.block)
      const delay = Math.max(stream.net.rtt, state.responseDelay.get(stream) ?? 0)
      const ahead = stream.speed * delay
      const size = engine.subrangeSize(stream)
      while (attempt.committed < length && attempt.committed - engine.position(attempt) <= ahead) {
        attempt.committed = Math.min(length, attempt.committed + size)
        engine.requests++
      }
    }
    askAhead()
  }
}

/** A look at every step, and a range asked for ahead starting when it would really arrive. */
function pipelining(engine: Sim, state: BaselineState): void {
  // A pipelined range starts the moment the one before it ends, not a step later, and the
  // connection's flow carries on: its speed meter isn't reset as a new request's would be.
  const complete = engine.complete.bind(engine)
  engine.complete = (attempt) => {
    const stream = attempt.stream
    const meter = {
      bins: Float64Array.from(stream.meter.bins),
      pos: stream.meter.pos,
      sum: stream.meter.sum,
      filled: stream.meter.filled,
      speed: stream.speed
    }
    complete(attempt)
    if (stream.status !== 'pending' || !state.pipelined.has(stream)) return
    stream.needsWork = false
    const work = engine.scheduler.pick(engine, stream)
    if (!work) return
    engine.begin(stream, work)
    if (stream.attempt?.startupLeft !== 0) return
    stream.meter.bins.set(meter.bins)
    stream.meter.pos = meter.pos
    stream.meter.sum = meter.sum
    stream.meter.filled = meter.filled
    stream.speed = meter.speed
  }

  const transfer = engine.transfer.bind(engine)
  engine.transfer = ((...args: Parameters<Sim['transfer']>) => {
    transfer(...args)
    state.onStep(engine)
  }) as Sim['transfer']

  const begin = engine.begin.bind(engine)
  engine.begin = (stream: Stream, work: Work) => {
    const handed = state.handover.get(stream)
    state.handover.delete(stream)
    const requestedAt = handed?.block === work.block ? handed.requestedAt : null
    const warm = stream.conn !== null
    begin(stream, work)
    const attempt = stream.attempt
    // The testbed really asked early (RealEngine.prefetch); its bytes set the timing.
    if ('prefetch' in engine) return
    if (requestedAt === null || !attempt || !warm) return
    // Asked for earlier on this connection: it arrives a response delay after that.
    const delay = state.responseDelay.get(stream) ?? stream.net.rtt
    const wait = state.continuous ? 0 : Math.max(0, requestedAt + delay - engine.t)
    if (attempt.startupLeft > wait) attempt.startupLeft = wait
    if (attempt.startupLeft <= 0) attempt.lastByteAt = engine.t
  }
}

type Pingable = Sim & {
  links?: Map<Stream, { session?: { destroyed: boolean; closed: boolean; ping(cb: (error: Error | null, ms: number) => void): boolean } }>
}

/** On the testbed, MP-H2's response delay: an HTTP/2 PING every 100 ms per connection, mean of
 * the last five. The simulator has no queues, so there it stays the path's RTT. */
function measureResponseDelay(engine: Sim, state: BaselineState): void {
  const links = (engine as Pingable).links
  if (!links) return
  const recent = new Map<Stream, number[]>()
  const timer = setInterval(() => {
    if (engine.done()) {
      clearInterval(timer)
      return
    }
    for (const stream of engine.streams) {
      const session = links.get(stream)?.session
      if (!session || session.destroyed || session.closed) continue
      try {
        session.ping((error, ms) => {
          if (error) return
          const samples = recent.get(stream) ?? []
          samples.push(ms / 1000)
          if (samples.length > 5) samples.shift()
          recent.set(stream, samples)
          state.responseDelay.set(stream, samples.reduce((a, b) => a + b, 0) / samples.length)
        })
      } catch {
        // Closing while the ping was sent: no sample.
      }
    }
  }, 100)
  timer.unref()
}
