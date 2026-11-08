import { planDownload } from '../vendor/plexo/plan.ts'
import { pickWork, type SchedulerPolicy } from '../vendor/plexo/scheduler.ts'
import { MB, MIB } from './network.ts'
import { SINGLE_REQUEST } from './sim.ts'
import type { Attempt, Block, Scheduler, Sim, Stream, Transport, Work } from './sim.ts'

// --- Plexo, as shipped -----------------------------------------------------------------------------
//
// Blocks from Plexo's own planDownload, work from Plexo's own pickWork, with the policy
// httpTransfer.ts passes it. Only the state is translated: the simulator's clock is in seconds.

export const PLEXO_POLICY: SchedulerPolicy = {
  hedgeAfterMs: 2000,
  maxHedgesPerBlock: 2,
  startupMs: 1000
}

function planFixedBlocks(sim: Sim): void {
  const plan = planDownload({
    totalBytes: sim.fileBytes,
    splittable: true,
    networkCount: sim.nets.length
  })
  while (sim.frontier < sim.fileBytes) sim.carve(plan.blockSizeBytes)
}

function plexoPick(sim: Sim, stream: Stream): Work | undefined {
  const attempts = new Map()
  for (const [index, list] of sim.attempts) {
    attempts.set(
      index,
      list.map((attempt) => ({
        kind: attempt.kind,
        streamId: attempt.stream.id,
        networkId: attempt.stream.net.id,
        startedAt: attempt.startedAt * 1000,
        writeWaiting: false
      }))
    )
  }
  const work = pickWork(
    {
      blocks: sim.blocks,
      streams: sim.streams.map((s) => ({
        id: s.id,
        interfaceId: s.net.id,
        status: s.status,
        speedBytesPerSec: s.speed
      })),
      attempts,
      avoid: sim.avoid,
      hedgesUsed: sim.hedgesUsed,
      diskBehind: false
    } as never,
    {
      id: stream.id,
      networkId: stream.net.id,
      speedBytesPerSec: stream.lastBlockSpeed || undefined
    },
    sim.t * 1000,
    PLEXO_POLICY
  )
  return work && { kind: work.kind, block: work.block as unknown as Block }
}

/** `transport` lets Plexo's own decisions run on the sub-range transport CATS uses (see sim.ts),
 * so the two can be compared on the same transport. */
export function plexo(name = 'plexo', transport: Transport = SINGLE_REQUEST): Scheduler {
  return { name, transport, init: planFixedBlocks, pick: plexoPick }
}

// --- CATS: cost-aware tail scheduling -----------------------------------------------------------------
//
// Three changes to who fetches what; nothing else differs from Plexo.
//
// 1. Factoring. Blocks are cut as streams ask for them, each phi of the bytes not yet handed out
//    times the asking stream's share of the measured throughput: large while much is left, so
//    fewer requests, shrinking to MIN_CHUNK at the end, so the last blocks are short.
// 2. Tail work by split, not copy. Once nothing is left to hand out, a free stream takes the back
//    part of the block that will finish last, cut so that holder and taker should finish
//    together. No byte is fetched twice. A copy (a hedge) races the holder only where a split
//    can't help: the holder has gone silent, so its speed says nothing, or too little is left to
//    split, so the copy costs at most a split's worth of bytes.
// 3. Price of metered bytes. lambda is what the user would wait to save 1 MB on a metered
//    network. Moving bytes to it saves 1/R_free seconds each while the free networks are the
//    bottleneck, so it takes its full share when lambda < 1/R_free and none otherwise; in the
//    tail it acts only when the time it saves on the whole download's finish is worth lambda
//    per byte it fetches.
//
// cats2 (rampAware) prices the taker's request with TCP slow start in it. A connection that is
// new, or has idled past its RTO, makes the server's TCP restart from the initial window
// (RFC 6928's 10 segments) and double it each round trip, so its first bytes come slower than
// its last block's speed. cats prices a new request at its handshake round trips alone, and so
// overrates splits on small blocks and far servers.
//
// cats3 (multiplexed) is cats2 fetching each block as sub-ranges on one connection (sim.ts). A
// split then cuts no further back than what the holder has already asked for, so the holder
// stops cleanly and keeps its warm connection, and a lost race cancels a stream instead of
// dropping a connection. Under cats and cats2 every split and every lost race cost a connection,
// and at far servers the reconnects (a handshake, then slow start) ate the gain.
//
// cats4 is cats3 on SUBRANGES_V2 (sim.ts), which answers what cats3 cost: sub-ranges are large
// while much of the file is left, so far fewer requests; only a BDP is asked for ahead, so a
// 1 MiB block can still be split rather than copied; and a crawling connection that loses a
// race is dropped for a fresh one instead of being kept.

const PHI = 0.5
const MIN_CHUNK = MIB
const MAX_CHUNK = 32 * MIB
/** A split leaving the taker less than this costs more in requests than it saves. */
const MIN_STEAL = 512 * 1024
const MIN_GAIN_S = 0.25
/** A speed measured over less than this is noise. */
const MIN_OBSERVED_S = 0.5
/** Before this the free networks' speed isn't known, so a priced network waits. */
const WARMUP_S = 1.5
const MAX_HEDGES_PER_BLOCK = 2
/** What a server's TCP starts a new or long-idle connection at (RFC 6928). */
const INITIAL_WINDOW = 10 * 1460
/** Linux's floor on the retransmission timeout, past which an idle connection restarts. */
const MIN_RTO_S = 0.2

export interface CatsOptions {
  name: string
  factoring: boolean
  tail: 'cats' | 'plexo'
  /** Seconds of waiting the user would trade for 1 MB on a metered network. 0 ignores cost;
   * Infinity never uses a metered network. */
  lambdaSecPerMB: number
  /** Price slow start into the taker's request (cats2). */
  rampAware?: boolean
  /** How blocks are asked for: sub-ranges make splits leave the holder's connection alone
   * (cats3, cats4). SINGLE_REQUEST by default. */
  transport?: Transport
}

export function cats(options: CatsOptions): Scheduler {
  return {
    name: options.name,
    transport: options.transport ?? SINGLE_REQUEST,
    init(sim) {
      if (!options.factoring) planFixedBlocks(sim)
    },
    pick(sim, stream) {
      const lambda = options.lambdaSecPerMB / MB
      const priced = stream.net.spec.metered && lambda > 0

      const workLeft = sim.frontier < sim.fileBytes || sim.blocks.some((b) => b.status === 'pending')
      if (workLeft) {
        if (priced && !meteredWorthIt(sim, lambda)) return undefined
        const waiting = nextWaitingBlock(sim, stream)
        if (waiting) return { kind: 'primary', block: waiting }
        if (sim.frontier < sim.fileBytes) {
          return { kind: 'primary', block: sim.carve(chunkSize(sim, stream)) }
        }
        return undefined
      }
      if (options.tail === 'plexo') return plexoPick(sim, stream)
      return tailWork(sim, stream, priced ? lambda : 0, options)
    }
  }
}

/** Plexo's nextWaitingBlock: a block whose last attempt on this network got nothing goes to
 * another network while one has a stream free. */
function nextWaitingBlock(sim: Sim, stream: Stream): Block | undefined {
  const otherNetworkFree = sim.streams.some((s) => s.net !== stream.net && s.status === 'pending')
  return sim.blocks.find(
    (block) =>
      block.status === 'pending' &&
      !(otherNetworkFree && sim.avoid.get(block.index) === stream.net.id)
  )
}

function meteredWorthIt(sim: Sim, lambda: number): boolean {
  if (!Number.isFinite(lambda)) return false
  const free = sim.nets.filter((net) => !net.spec.metered)
  if (free.length === 0) return true
  if (sim.t < WARMUP_S) return false
  const freeRate = free.reduce((sum, net) => sum + sim.netRate(net), 0)
  // With the free networks down, every byte the metered one carries is time saved.
  return freeRate <= 0 || lambda < 1 / freeRate
}

/** How fast this stream is likely to fetch: its last block, else what its network's other
 * streams did on theirs, else its network's current per-stream rate. */
function streamRate(sim: Sim, stream: Stream): number {
  if (stream.lastBlockSpeed > 0) return stream.lastBlockSpeed
  const siblings = stream.net.streams.map((s) => s.lastBlockSpeed).filter((v) => v > 0)
  if (siblings.length) return siblings.sort((a, b) => a - b)[siblings.length >> 1]
  if (stream.net.meter.filled * sim.dt < MIN_OBSERVED_S) return 0
  const active = stream.net.streams.filter((s) => s.attempt && s.attempt.startupLeft <= 0).length
  const rate = sim.netRate(stream.net)
  return active > 0 && rate > 0 ? rate / active : 0
}

function chunkSize(sim: Sim, stream: Stream): number {
  const left = sim.fileBytes - sim.frontier
  const total = sim.nets.reduce((sum, net) => sum + sim.netRate(net), 0)
  const own = streamRate(sim, stream)
  const share = total > 0 && own > 0 ? Math.min(1, own / total) : 1 / sim.streams.length
  let size = Math.min(Math.max(PHI * left * share, MIN_CHUNK), MAX_CHUNK)
  if (left - size < MIN_CHUNK) size = left
  return Math.ceil(size)
}

/** The window the server will send this stream's next request with, if slow start will hold it
 * back: the initial window for a new connection or one idle past its RTO by the time the
 * request arrives; null for a connection still warm. */
function startingWindow(sim: Sim, stream: Stream, startup: number): number | null {
  const conn = stream.conn
  if (!conn) return INITIAL_WINDOW
  const rto = Math.max(MIN_RTO_S, 2 * stream.net.rtt)
  const idle = conn.idleSince === null ? 0 : sim.t + startup - conn.idleSince
  return idle > rto ? INITIAL_WINDOW : null
}

/** Seconds to receive `bytes` once the request is out, at a steady `rate`, starting from
 * `window` (null: already at full speed) and doubling it each round trip until a round trip
 * carries rate x rtt. */
export function transferTime(bytes: number, rate: number, rtt: number, window: number | null): number {
  if (window === null) return bytes / rate
  const full = rate * rtt
  let sent = 0
  let elapsed = 0
  for (let w = window; w < full; w *= 2) {
    if (sent + w >= bytes) return elapsed + ((bytes - sent) / w) * rtt
    sent += w
    elapsed += rtt
  }
  return elapsed + (bytes - sent) / rate
}

/** Bytes the holder should keep so that it and the taker finish together, and when that is:
 * keep / holderRate = takerTime(remaining - keep). Null when the taker can't finish any part
 * before the holder would finish all of it. */
function splitPoint(
  remaining: number,
  holderRate: number,
  takerTime: (bytes: number) => number
): { keep: number; finish: number } | null {
  if (remaining / holderRate <= takerTime(0)) return null
  // keep / r_h rises with keep and takerTime(remaining - keep) falls, so they cross once.
  let low = 0
  let high = remaining
  for (let i = 0; i < 50; i++) {
    const mid = (low + high) / 2
    if (mid / holderRate < takerTime(remaining - mid)) low = mid
    else high = mid
  }
  return { keep: high, finish: high / holderRate }
}

/** Silence longer than this, for a connection with this round trip, is a stall. */
function silenceLimit(rtt: number): number {
  return Math.max(1, 4 * rtt)
}

interface Candidate {
  block: Block
  attempts: Attempt[]
  remaining: number
  holderRate: number
  /** Expected seconds to finish as things stand. A silent holder is expected to stay silent
   * about as long again as it has been, then carry on at its usual speed. */
  eta: number
  stalled: boolean
  holderRtt: number
}

function tailWork(sim: Sim, stream: Stream, lambda: number, options: CatsOptions): Work | undefined {
  const rampAware = options.rampAware ?? false
  const multiplexed = options.transport?.subranges ?? false
  const net = stream.net
  // A free network's idle stream gets the first go at any tail work.
  if (lambda > 0 && sim.streams.some((s) => !s.net.spec.metered && s.status === 'pending')) {
    return undefined
  }
  const rate = streamRate(sim, stream)
  if (rate <= 0) return undefined
  const startup = (stream.conn ? 1 : 3) * net.rtt
  const window = rampAware ? startingWindow(sim, stream, startup) : null
  /** When the taker would have `bytes`, counting from now. */
  const takerTime = (bytes: number): number => startup + transferTime(bytes, rate, net.rtt, window)

  const candidates: Candidate[] = []
  for (const [index, attempts] of sim.attempts) {
    const block = sim.blocks[index]
    if (block.status !== 'downloading') continue
    if (attempts.some((a) => a.stream === stream)) continue
    // Holders whose speed isn't known yet are left alone.
    if (attempts.every((a) => a.stream.meter.filled * sim.dt < MIN_OBSERVED_S)) continue
    const remaining = sim.blockLength(block) - block.bytesDownloaded
    if (remaining <= 0) continue
    let holderRate = 0
    let lastByteAt = 0
    let holderRtt = 0
    let usual = 0
    for (const attempt of attempts) {
      holderRate = Math.max(holderRate, attempt.stream.speed)
      lastByteAt = Math.max(lastByteAt, attempt.lastByteAt)
      holderRtt = Math.max(holderRtt, attempt.stream.net.rtt)
      usual = Math.max(usual, attempt.stream.lastBlockSpeed)
    }
    const silentFor = sim.t - lastByteAt
    const stalled = holderRate <= 0 || silentFor > silenceLimit(holderRtt)
    const eta = stalled
      ? 2 * silentFor + remaining / Math.max(usual, rate)
      : remaining / holderRate
    candidates.push({ block, attempts, remaining, holderRate, eta, stalled, holderRtt })
  }
  candidates.sort((a, b) => b.eta - a.eta)

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]
    if (sim.avoid.get(c.block.index) === net.id) continue

    let finish: number
    let bytes: number
    let work: () => Work
    // Holder keeps x bytes, taker gets the rest: x / r_h = startup + (rem - x) / r_s, with the
    // taker's ramp in it when slow start is priced.
    let keep = 0
    let splitFinish = Infinity
    if (!c.stalled && window === null) {
      keep = (c.holderRate * (startup * rate + c.remaining)) / (c.holderRate + rate)
      splitFinish = keep / c.holderRate
    } else if (!c.stalled) {
      const point = splitPoint(c.remaining, c.holderRate, takerTime)
      if (point) ({ keep, finish: splitFinish } = point)
    }
    // Sub-ranges already asked for are the holder's: cutting into them would drop its
    // connection, so the cut moves back to where they end.
    if (multiplexed && !c.stalled && Number.isFinite(splitFinish)) {
      const asked = Math.max(...c.attempts.map((a) => a.committed)) - c.block.bytesDownloaded
      if (keep < asked) {
        keep = asked
        splitFinish = Math.max(keep / c.holderRate, takerTime(c.remaining - keep))
      }
    }
    const stolen = c.remaining - keep
    // A single request needs room for what is already on its wire.
    const room = multiplexed ? 0 : c.holderRate * c.holderRtt
    if (
      !c.stalled &&
      Number.isFinite(splitFinish) &&
      stolen >= MIN_STEAL &&
      keep >= room
    ) {
      finish = splitFinish
      bytes = stolen
      const cut = c.block.bytesDownloaded + Math.ceil(keep)
      work = () => ({ kind: 'primary', block: sim.split(c.block, cut) })
    } else if (c.stalled || c.remaining <= 2 * MIN_STEAL) {
      const hedges = c.attempts.filter((a) => a.kind === 'hedge')
      // One copy per network: a second on the same network fails or succeeds with the first.
      if (hedges.some((a) => a.stream.net === net)) continue
      // A copy that has itself gone silent no longer counts against the block.
      const working = hedges.filter((a) => sim.t - a.lastByteAt <= silenceLimit(a.stream.net.rtt))
      if (working.length >= MAX_HEDGES_PER_BLOCK) continue
      // The holder's network may be what stalled it: another network's idle stream goes first,
      // if it would take the block.
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
      bytes = c.remaining
      work = () => ({ kind: 'hedge', block: c.block })
    } else {
      continue
    }

    const gain = c.eta - finish
    if (gain < Math.max(MIN_GAIN_S, 2 * startup)) continue
    if (lambda > 0) {
      // Only an earlier finish for the whole download is worth paying for.
      const nextLatest = i === 0 ? (candidates[1]?.eta ?? 0) : candidates[0].eta
      const saved = candidates[0].eta - Math.max(finish, nextLatest)
      if (saved <= lambda * bytes) continue
    }
    return work()
  }
  return undefined
}
