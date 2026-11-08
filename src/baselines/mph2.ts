import type { Scenario } from '../network.ts'
import type { Block, Scheduler, Sim, Stream, Transport } from '../sim.ts'

// MP-H2 (Nikravesh, Guo, Zhu, Qian, Mao, MobiCom 2019), as described in the paper:
//
// - MP-H2+FS, the variant for a client that knows the file size (Plexo and CATS learn it with a
//   probe): the file is split evenly over the paths and every path asks for its share at once
//   (section 3.3; with FS "the scheduler can send the byte-range requests over all paths at the
//   same time", section 3.6).
// - Algorithm 1, run whenever a path receives data: with this path's and the other's expected
//   times to finish, bytesToDL / getBW, if the other's is later by more than delta = 50 ms, this
//   path will finish within one estimated response delay, and it has fewer than two streams,
//   then this path takes the end of the other's remaining bytes, sized by Equation 1 with
//   RTT_i + D_i / BW_i = D_j / BW_j, the other's byte range end is moved back to meet it, and
//   the new range is requested now on this path's connection as a second (pipelined) stream.
// - getBW: a throughput sample whenever at least 20 KB more has arrived, averaged over the most
//   recent 500 KB of samples (footnote 3). Response delay: HTTP/2 PING every 100 ms, mean of the
//   last 5 (section 3.4.1); in the simulator, which has no queues, it is the path's RTT.
// - Moving a range end back is done with HTTP/2 flow control one RTT ahead, so no tail bytes
//   are sent and the connection stays (section 3.4.2). Here that is the sub-range transport with
//   a bandwidth-delay product asked for ahead: the cut cannot go into what is already asked for,
//   which is what a window opened one RTT ahead allows.
//
// "mph2" is the paper's design, one connection per path. "mph2-eq" gives it as many connections
// as CATS and Plexo get, treating each connection as a path (the paper extends Equation 1 to
// more paths by T_i = T_j = T_k, section 3.3); the slowest connection is the one helped.
//
// Not in the paper, so chosen here: with more than two paths, "other" is the path expected to
// finish last; a new range smaller than MIN_PIECE is not worth a request; a range orphaned by a
// failed connection goes to the next idle connection.

export const MPH2_TRANSPORT: Transport = {
  subranges: true,
  sizing: 'fixed',
  lead: 'bdp',
  keep: 'delivering'
}

const DELTA_S = 0.05
const SAMPLE_BYTES = 20_000
const WINDOW_BYTES = 500_000
const MIN_PIECE = 64 * 1024

export class BandwidthEstimator {
  samples: { bytes: number; seconds: number }[] = []
  pendingBytes = 0
  pendingSeconds = 0

  add(bytes: number, seconds: number): void {
    this.pendingBytes += bytes
    this.pendingSeconds += seconds
    if (this.pendingBytes < SAMPLE_BYTES) return
    this.samples.push({ bytes: this.pendingBytes, seconds: this.pendingSeconds })
    this.pendingBytes = 0
    this.pendingSeconds = 0
    let kept = 0
    for (let i = this.samples.length - 1; i >= 0; i--) {
      kept += this.samples[i].bytes
      if (kept > WINDOW_BYTES) {
        this.samples.splice(0, i)
        break
      }
    }
  }

  /** Bytes per second over the window, weighting each sample by its bytes. 0 until a sample. */
  get(): number {
    let bytes = 0
    let seconds = 0
    for (const s of this.samples) {
      bytes += s.bytes
      seconds += s.seconds
    }
    return seconds > 0 ? bytes / seconds : 0
  }
}

/** Where a baseline keeps the next range it has already asked for on a stream. */
export interface Pipelined {
  block: Block
  requestedAt: number
}

export interface BaselineState {
  pipelined: Map<Stream, Pipelined>
  /** A pipelined range just handed to its stream, read when the attempt begins. */
  handover: Map<Stream, Pipelined>
  /** Blocks promised to a stream's pipelined request, not to be handed to anyone else. */
  reserved: Set<Block>
  bandwidth: Map<Stream, BandwidthEstimator>
  /** Measured application-layer RTT per stream (real testbed); Sim uses the path's RTT. */
  responseDelay: Map<Stream, number>
  /** No request stands between one piece and the next (MPTCP: the server sends as the
   * subflow has room), so a pipelined piece starts with no wait at all. */
  continuous: boolean
  /** Diagnostic: Algorithm 1 uses the path's base RTT, not the measured response delay. */
  baseDelay: boolean
  /** Runs after every engine step. */
  onStep(sim: Sim): void
}

export function responseDelay(state: BaselineState, stream: Stream): number {
  return state.responseDelay.get(stream) ?? stream.net.rtt
}

export function newState(onStep: (sim: Sim, state: BaselineState) => void): BaselineState {
  const state: BaselineState = {
    pipelined: new Map(),
    handover: new Map(),
    reserved: new Set(),
    bandwidth: new Map(),
    responseDelay: new Map(),
    continuous: false,
    baseDelay: false,
    onStep: (sim) => onStep(sim, state)
  }
  return state
}

/** Updates each transferring stream's throughput estimate with what it received this step. */
export function sampleBandwidth(sim: Sim, state: BaselineState): void {
  for (const stream of sim.streams) {
    const attempt = stream.attempt
    if (!attempt || attempt.startupLeft > 0) continue
    let estimator = state.bandwidth.get(stream)
    if (!estimator) {
      estimator = new BandwidthEstimator()
      state.bandwidth.set(stream, estimator)
    }
    estimator.add(stream.stepBytes, sim.dt)
  }
}

/** The first waiting block nobody has been promised. */
export function orphan(sim: Sim, state: BaselineState): Block | undefined {
  return sim.blocks.find((b) => b.status === 'pending' && !state.reserved.has(b))
}

export function pipelinedPick(state: BaselineState, stream: Stream): Block | undefined {
  const next = state.pipelined.get(stream)
  if (!next) return undefined
  state.pipelined.delete(stream)
  state.reserved.delete(next.block)
  if (next.block.status !== 'pending') return undefined
  state.handover.set(stream, next)
  return next.block
}

export function mph2(name: string): { scheduler: Scheduler; state: BaselineState } {
  const state = newState(algorithm1)
  const initial = new Map<Stream, Block>()

  const scheduler: Scheduler = {
    name,
    transport: MPH2_TRANSPORT,
    init(sim) {
      // MP-H2+FS: an even split, one range per path (per connection in mph2-eq).
      const share = Math.ceil(sim.fileBytes / sim.streams.length)
      for (const stream of sim.streams) {
        if (sim.frontier >= sim.fileBytes) break
        const block = sim.carve(share)
        initial.set(stream, block)
        state.reserved.add(block)
      }
    },
    pick(sim, stream) {
      const next = pipelinedPick(state, stream)
      if (next) return { kind: 'primary', block: next }
      const first = initial.get(stream)
      if (first) {
        initial.delete(stream)
        state.reserved.delete(first)
        if (first.status === 'pending') return { kind: 'primary', block: first }
      }
      const left = orphan(sim, state)
      return left && { kind: 'primary', block: left }
    }
  }
  return { scheduler, state }
}

function bytesToDownload(sim: Sim, stream: Stream): number {
  const attempt = stream.attempt
  return attempt ? Math.max(0, sim.blockLength(attempt.block) - attempt.block.bytesDownloaded) : 0
}

/** Algorithm 1, for every stream that received data this step. */
function algorithm1(sim: Sim, state: BaselineState): void {
  sampleBandwidth(sim, state)
  const time = (stream: Stream): number => {
    const bw = state.bandwidth.get(stream)?.get() ?? 0
    return bw > 0 ? bytesToDownload(sim, stream) / bw : Infinity
  }
  const active = sim.streams.filter((s) => s.attempt && s.attempt.startupLeft <= 0)
  // Soonest to finish first, as each takes from the one finishing last.
  const order = active.filter((s) => s.stepBytes > 0).sort((a, b) => time(a) - time(b))

  for (const self of order) {
    if (state.pipelined.has(self)) continue // numStreams(this) < 2
    const bwSelf = state.bandwidth.get(self)?.get() ?? 0
    if (bwSelf <= 0) continue
    const selfTime = time(self)
    let other: Stream | undefined
    let otherTime = -Infinity
    for (const s of active) {
      if (s === self) continue
      const t = time(s)
      if (Number.isFinite(t) && t > otherTime) {
        other = s
        otherTime = t
      }
    }
    if (!other || otherTime - selfTime <= DELTA_S) continue
    const delay = state.baseDelay ? self.net.rtt : responseDelay(state, self)
    if (selfTime > delay) continue

    const bwOther = state.bandwidth.get(other)?.get() ?? 0
    const attempt = other.attempt
    if (bwOther <= 0 || !attempt) continue
    const remaining = bytesToDownload(sim, other)
    // RTT_this + D / BW_this = (remaining - D) / BW_other
    let take = (remaining * bwSelf - delay * bwSelf * bwOther) / (bwSelf + bwOther)
    const block = attempt.block
    const asked = Math.max(...(sim.attempts.get(block.index) ?? []).map((a) => a.committed))
    let cut = Math.ceil(block.bytesDownloaded + remaining - take)
    if (cut < asked) cut = Math.ceil(asked)
    take = sim.blockLength(block) - cut
    if (take < MIN_PIECE) continue
    const piece = sim.split(block, cut)
    state.reserved.add(piece)
    state.pipelined.set(self, { block: piece, requestedAt: sim.t })
    prefetch(sim, self, piece)
  }
}

/** On the real testbed, a pipelined range is asked for now; Sim models the timing on begin. */
export function prefetch(sim: Sim, stream: Stream, block: Block): void {
  const engine = sim as Sim & { prefetch?: (stream: Stream, block: Block) => void }
  engine.prefetch?.(stream, block)
}

/** mph2 runs one connection per path; mph2-eq keeps the scenario's count. */
export function onePerPath(scenario: Scenario): Scenario {
  return { ...scenario, streamsPerNetwork: 1 }
}
