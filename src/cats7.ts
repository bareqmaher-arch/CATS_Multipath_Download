import { MIB } from './network.ts'
import { transferTime } from './schedulers.ts'
import { SUBRANGES_V3 } from './sim.ts'
import type { Attempt, Block, Scheduler, Sim, Stream, Work } from './sim.ts'
import { pipelined } from './cats6.ts'
import { lastProgressAt, watchProgress } from './progress.ts'
import type { BaselineState } from './baselines/mph2.ts'

// cats7 = cats6 with a tail that works for small files.
//
// In a 20 MB download (about 2 s) cats5 and cats6 leave connections idle at the end while others
// finish, and small-block designs (rb-eq) beat them by 5-12% (REPORT.md, sections 6b and 6c). The
// cause, traced on development seeds 9001-9030: cats5 asks a second of data ahead on every
// connection (512 KiB at least), so a 1 MiB block near the end is fully asked for before anyone
// could split it; the only tail work left is copies, which on a shared link take bandwidth from
// the holder rather than add to it. cats7 changes three things, each tied to that mechanism:
//
// - tailSubranges: once every block is handed out, sub-ranges are 0.2 s of data (at least
//   64 KiB), so what is left of a block stays splittable.
// - steal (with healthyOnly): a split costs the taker about a round trip, so it is worth it once
//   the stolen bytes take a few round trips at the taker's speed: STEAL_RTTS x rate x rtt,
//   between 64 KiB and cats5's 512 KiB. Only for a holder at least half as fast as its network's
//   usual connection; a crawling holder keeps cats5's 512 KiB, so it is still copied, not split
//   (smaller splits from crawlers cost up to 69% on S4, the straggler scenario).
// - coldGuard: a stream with no connection yet takes no tail work from a holder on its own
//   network. The network is already busy, so a new connection there adds a handshake and slow
//   start but no capacity; at long RTTs it became the straggler (+40% on S6 at RTT x10).
//
// Tried and left out (development seeds, TailScaling flags kept for the record): observe (judge a
// holder after 4 RTTs instead of 0.5 s) and gain (drop the 0.25 s floor) changed nothing; fine
// (at most an even share of the file per connection) helped S6 at RTT x1 but cost 22% at RTT x10,
// where it opens the same cold connections. Either tail fix alone did nothing: short sub-ranges
// without smaller steals, or smaller steals without short sub-ranges.
//
// Everything else is cats5's, line for line (src/schedulers.ts, CATS with slow start priced and
// lambda = 0; this file copies its logic because the frozen file keeps the constants inside it;
// with no scaling switched on it reproduces cats6 exactly), and the next block is pipelined as in
// cats6.

const PHI = 0.5
const MIN_CHUNK = MIB
const MAX_CHUNK = 32 * MIB
const MIN_STEAL = 512 * 1024
const MIN_GAIN_S = 0.25
const MIN_OBSERVED_S = 0.5
const MAX_HEDGES_PER_BLOCK = 2
const INITIAL_WINDOW = 10 * 1460
const MIN_RTO_S = 0.2

const STEAL_RTTS = 4
const STEAL_FLOOR = 64 * 1024
const OBSERVE_RTTS = 4
const OBSERVE_FLOOR_S = 0.1
const FINE_FLOOR = 128 * 1024

export interface TailScaling {
  steal: boolean
  observe: boolean
  gain: boolean
  fine: boolean
  /** Short sub-ranges once every block is handed out, so what is left of a block stays
   * splittable (cats5 asks a second of data ahead, which commits a whole small block). */
  tailSubranges: boolean
  /** The scaled steal applies only to a holder at least half as fast as its network's usual
   * connection (Sim.isHealthy); a crawling holder keeps cats5's 512 KiB, so it is still copied. */
  healthyOnly: boolean
  /** A stream with no connection yet takes no tail work from a holder on its own network: the
   * network is already busy, so a new connection there adds a handshake and slow start but no
   * capacity, and becomes the straggler at long RTTs. */
  coldGuard: boolean
  /** cats8 development, left out: a stream with no connection yet takes no tail work while another connection on its
   * own network is transferring, whoever holds the block: the new connection would share that
   * network's bottleneck and pay a handshake and slow start for it. */
  warmTakers?: boolean
  /** cats8 development, left out: a taker is judged at no more than its share of what its network delivers now,
   * shared with the connections transferring on it, not at its last block's speed alone. */
  sharedRate?: boolean
  /** cats8 development, left out: a holder is silent from when its block last moved forward (src/progress.ts), not from
   * the last byte on its connection, which a pipelined request can keep busy. */
  progressSilence?: boolean
}

/** No scaling: cats5's tail exactly. */
export const NO_SCALING: TailScaling = {
  steal: false, observe: false, gain: false, fine: false, tailSubranges: false, healthyOnly: false, coldGuard: false
}

/** cats7 as chosen on the development seeds. */
export const CATS7: TailScaling = {
  steal: true, observe: false, gain: false, fine: false, tailSubranges: true, healthyOnly: true, coldGuard: true
}

const TAIL_SUBRANGE_S = 0.2
const TAIL_SUBRANGE_MIN = 64 * 1024

export function cats7(name: string, scaling: TailScaling = CATS7): { scheduler: Scheduler; state: BaselineState } {
  return pipelined(name, scaledCats(name, scaling))
}

export function scaledCats(name: string, scaling: TailScaling): Scheduler {
  return {
    name,
    transport: SUBRANGES_V3,
    init(sim) {
      if (scaling.progressSilence) watchProgress(sim)
      if (!scaling.tailSubranges) return
      const usual = sim.subrangeSize.bind(sim)
      sim.subrangeSize = (stream: Stream) => {
        const tail = sim.frontier >= sim.fileBytes && !sim.blocks.some((b) => b.status === 'pending')
        if (!tail) return usual(stream)
        return Math.min(usual(stream), Math.max(TAIL_SUBRANGE_MIN, stream.speed * TAIL_SUBRANGE_S))
      }
    },
    pick(sim, stream) {
      const workLeft = sim.frontier < sim.fileBytes || sim.blocks.some((b) => b.status === 'pending')
      if (workLeft) {
        const waiting = nextWaitingBlock(sim, stream)
        if (waiting) return { kind: 'primary', block: waiting }
        if (sim.frontier < sim.fileBytes) {
          return { kind: 'primary', block: sim.carve(chunkSize(sim, stream, scaling)) }
        }
        return undefined
      }
      return tailWork(sim, stream, scaling)
    }
  }
}

function nextWaitingBlock(sim: Sim, stream: Stream): Block | undefined {
  const otherNetworkFree = sim.streams.some((s) => s.net !== stream.net && s.status === 'pending')
  return sim.blocks.find(
    (block) =>
      block.status === 'pending' &&
      !(otherNetworkFree && sim.avoid.get(block.index) === stream.net.id)
  )
}

function streamRate(sim: Sim, stream: Stream): number {
  if (stream.lastBlockSpeed > 0) return stream.lastBlockSpeed
  const siblings = stream.net.streams.map((s) => s.lastBlockSpeed).filter((v) => v > 0)
  if (siblings.length) return siblings.sort((a, b) => a - b)[siblings.length >> 1]
  if (stream.net.meter.filled * sim.dt < MIN_OBSERVED_S) return 0
  const active = stream.net.streams.filter((s) => s.attempt && s.attempt.startupLeft <= 0).length
  const rate = sim.netRate(stream.net)
  return active > 0 && rate > 0 ? rate / active : 0
}

function minChunk(sim: Sim, scaling: TailScaling): number {
  if (!scaling.fine) return MIN_CHUNK
  return Math.min(MIN_CHUNK, Math.max(FINE_FLOOR, Math.ceil(sim.fileBytes / sim.streams.length)))
}

function chunkSize(sim: Sim, stream: Stream, scaling: TailScaling): number {
  const smallest = minChunk(sim, scaling)
  const left = sim.fileBytes - sim.frontier
  const total = sim.nets.reduce((sum, net) => sum + sim.netRate(net), 0)
  const own = streamRate(sim, stream)
  const share = total > 0 && own > 0 ? Math.min(1, own / total) : 1 / sim.streams.length
  let size = Math.min(Math.max(PHI * left * share, smallest), MAX_CHUNK)
  if (left - size < smallest) size = left
  return Math.ceil(size)
}

function startingWindow(sim: Sim, stream: Stream, startup: number): number | null {
  const conn = stream.conn
  if (!conn) return INITIAL_WINDOW
  const rto = Math.max(MIN_RTO_S, 2 * stream.net.rtt)
  const idle = conn.idleSince === null ? 0 : sim.t + startup - conn.idleSince
  return idle > rto ? INITIAL_WINDOW : null
}

function splitPoint(
  remaining: number,
  holderRate: number,
  takerTime: (bytes: number) => number
): { keep: number; finish: number } | null {
  if (remaining / holderRate <= takerTime(0)) return null
  let low = 0
  let high = remaining
  for (let i = 0; i < 50; i++) {
    const mid = (low + high) / 2
    if (mid / holderRate < takerTime(remaining - mid)) low = mid
    else high = mid
  }
  return { keep: high, finish: high / holderRate }
}

function silentSince(sim: Sim, attempt: Attempt, scaling: TailScaling): number {
  return scaling.progressSilence ? lastProgressAt(sim, attempt) : attempt.lastByteAt
}

function silenceLimit(rtt: number): number {
  return Math.max(1, 4 * rtt)
}

function observeFor(rtt: number, scaling: TailScaling): number {
  if (!scaling.observe) return MIN_OBSERVED_S
  return Math.min(MIN_OBSERVED_S, Math.max(OBSERVE_FLOOR_S, OBSERVE_RTTS * rtt))
}

interface Candidate {
  block: Block
  attempts: Attempt[]
  remaining: number
  holderRate: number
  eta: number
  stalled: boolean
  holderRtt: number
}

function tailWork(sim: Sim, stream: Stream, scaling: TailScaling): Work | undefined {
  const net = stream.net
  const busy = net.streams.filter((s) => s !== stream && s.attempt && s.attempt.startupLeft <= 0).length
  if (scaling.warmTakers && !stream.conn && busy > 0) return undefined
  let rate = streamRate(sim, stream)
  if (scaling.sharedRate && busy > 0 && sim.netRate(net) > 0) rate = Math.min(rate, sim.netRate(net) / (busy + 1))
  if (rate <= 0) return undefined
  const startup = (stream.conn ? 1 : 3) * net.rtt
  const window = startingWindow(sim, stream, startup)
  const takerTime = (bytes: number): number => startup + transferTime(bytes, rate, net.rtt, window)
  const minSteal = scaling.steal
    ? Math.min(MIN_STEAL, Math.max(STEAL_FLOOR, STEAL_RTTS * rate * net.rtt))
    : MIN_STEAL
  const minGain = scaling.gain ? 2 * startup : Math.max(MIN_GAIN_S, 2 * startup)

  const candidates: Candidate[] = []
  for (const [index, attempts] of sim.attempts) {
    const block = sim.blocks[index]
    if (block.status !== 'downloading') continue
    if (attempts.some((a) => a.stream === stream)) continue
    if (attempts.every((a) => a.stream.meter.filled * sim.dt < observeFor(a.stream.net.rtt, scaling))) continue
    const remaining = sim.blockLength(block) - block.bytesDownloaded
    if (remaining <= 0) continue
    let holderRate = 0
    let lastByteAt = 0
    let holderRtt = 0
    let usual = 0
    for (const attempt of attempts) {
      holderRate = Math.max(holderRate, attempt.stream.speed)
      lastByteAt = Math.max(lastByteAt, silentSince(sim, attempt, scaling))
      holderRtt = Math.max(holderRtt, attempt.stream.net.rtt)
      usual = Math.max(usual, attempt.stream.lastBlockSpeed)
    }
    const silentFor = sim.t - lastByteAt
    const stalled = holderRate <= 0 || silentFor > silenceLimit(holderRtt)
    const eta = stalled ? 2 * silentFor + remaining / Math.max(usual, rate) : remaining / holderRate
    candidates.push({ block, attempts, remaining, holderRate, eta, stalled, holderRtt })
  }
  candidates.sort((a, b) => b.eta - a.eta)

  for (const c of candidates) {
    if (sim.avoid.get(c.block.index) === net.id) continue
    if (scaling.coldGuard && !stream.conn && c.attempts.some((a) => a.stream.net === net)) continue
    let finish: number
    let work: () => Work
    let keep = 0
    let splitFinish = Infinity
    if (!c.stalled && window === null) {
      keep = (c.holderRate * (startup * rate + c.remaining)) / (c.holderRate + rate)
      splitFinish = keep / c.holderRate
    } else if (!c.stalled) {
      const point = splitPoint(c.remaining, c.holderRate, takerTime)
      if (point) ({ keep, finish: splitFinish } = point)
    }
    if (!c.stalled && Number.isFinite(splitFinish)) {
      const asked = Math.max(...c.attempts.map((a) => a.committed)) - c.block.bytesDownloaded
      if (keep < asked) {
        keep = asked
        splitFinish = Math.max(keep / c.holderRate, takerTime(c.remaining - keep))
      }
    }
    const stolen = c.remaining - keep
    const healthy = c.attempts.every((a) => sim.isHealthy(a.stream))
    const steal = scaling.healthyOnly && !healthy ? MIN_STEAL : minSteal
    if (!c.stalled && Number.isFinite(splitFinish) && stolen >= steal) {
      finish = splitFinish
      const cut = c.block.bytesDownloaded + Math.ceil(keep)
      work = () => ({ kind: 'primary', block: sim.split(c.block, cut) })
    } else if (c.stalled || c.remaining <= 2 * steal) {
      const hedges = c.attempts.filter((a) => a.kind === 'hedge')
      if (hedges.some((a) => a.stream.net === net)) continue
      const working = hedges.filter((a) => sim.t - silentSince(sim, a, scaling) <= silenceLimit(a.stream.net.rtt))
      if (working.length >= MAX_HEDGES_PER_BLOCK) continue
      const holderNets = new Set(c.attempts.map((a) => a.stream.net))
      if (
        holderNets.has(net) &&
        sim.streams.some(
          (s) =>
            !holderNets.has(s.net) &&
            s.status === 'pending' &&
            sim.avoid.get(c.block.index) !== s.net.id &&
            streamRate(sim, s) > 0
        )
      ) {
        continue
      }
      finish = takerTime(c.remaining)
      work = () => ({ kind: 'hedge', block: c.block })
    } else {
      continue
    }
    if (c.eta - finish < minGain) continue
    return work()
  }
  return undefined
}
