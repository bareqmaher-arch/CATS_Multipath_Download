import {
  CapacityTrace,
  drawConnectionQuality,
  MB,
  waterfill,
  type NetworkSpec,
  type Scenario
} from './network.ts'
import { mixSeed, Rng } from './rng.ts'

// A time-stepped model of one HTTP range download over several networks, with a pluggable
// scheduler deciding who fetches what. Everything that is not the scheduler's decision is shared
// by every scheduler and mirrors Plexo's httpTransfer.ts: streams per network, connection reuse,
// how attempts start, race and end, and how stuck connections are refreshed or retried. The
// constants below are Plexo's own (commit in vendor/plexo/COMMIT).

const SILENT_AFTER_S = 5
const SLOW_RATIO = 0.1
const SLOW_WARMUP_S = 5
const SLOW_FOR_S = 10
const MAX_REFRESHES_PER_BLOCK = 2
const STALL_TIMEOUT_S = 20
const RETRY_BASE_S = 1
const RETRY_MAX_S = 15
/** How often idle streams ask for work and stuck connections are looked for. */
const POLL_S = 0.1
/** Round trips a new connection costs before its first byte (TCP, TLS, request). */
const NEW_CONNECTION_RTTS = 3

// TCP, when RunOptions.tcp is 'slowstart' (the default 'fluid' gives every connection its share
// at once). A connection sends at most cwnd per RTT. It starts at Linux's initial window and,
// in slow start, grows by every byte acknowledged (doubling each RTT) while the window is what
// holds it back. Once the window is twice what the connection actually gets, the queue it
// builds would overflow: that counts as a loss, which halves the window (at most once per RTT)
// and ends slow start; after that it grows by one MSS per RTT (Reno). As Linux does by default
// (tcp_slow_start_after_idle), a connection idle for longer than its RTO restarts from the
// initial window, and a stall ends in a timeout that drops it to one MSS.
const MSS = 1460
const INITIAL_WINDOW = 10 * MSS
const MIN_RTO_S = 0.2

// Transport, chosen by the scheduler (Scheduler.transport). Plexo asks for a whole block in one
// HTTP/1.1 request, so a request can only be cut short by dropping its connection. With
// sub-ranges a block is asked for as a run of ranges on one connection, as HTTP/2 streams (or
// HTTP/1.1 pipelining) allow, kept far enough ahead of what has arrived that the connection
// never waits. Moving a block's end down then only stops later sub-ranges from being asked for,
// and a race lost is a cancelled stream rather than a dropped connection.
const SUBRANGE_BYTES = 512 * 1024
const MAX_SUBRANGE_BYTES = 8 * 1024 * 1024
/** With 'time' sizing, a sub-range is what its connection fetches in this long at its measured
 * speed: the same horizon the speed is measured over, so a stream never commits further ahead
 * than its own measurement reaches. */
const SUBRANGE_SECONDS = 1
/** A connection under this share of its network's usual speed is dropped, not kept, when its
 * stream is cancelled. */
const HEALTHY_RATIO = 0.5

export interface Transport {
  /** Ask for a block as sub-ranges on one connection; false: one request per block. */
  subranges: boolean
  /** 'fixed': every sub-range is SUBRANGE_BYTES. 'adaptive': half a stream's share of what is
   * left of the file, so they are large early and SUBRANGE_BYTES in the tail. 'time': what the
   * stream fetches in SUBRANGE_SECONDS at its measured speed, so a fast connection asks for
   * large ones and a crawling one stays at SUBRANGE_BYTES. Both between SUBRANGE_BYTES and
   * MAX_SUBRANGE_BYTES. */
  sizing: 'fixed' | 'adaptive' | 'time'
  /** How much is kept asked for beyond what has arrived: a bandwidth-delay product plus a
   * sub-range, or the bandwidth-delay product alone (which leaves more of a block to split). */
  lead: 'bdp+subrange' | 'bdp'
  /** After a lost race, keep the connection if it is still delivering, or only if it is also
   * about as fast as its network's others (a crawling one is dropped for a fresh one). */
  keep: 'delivering' | 'healthy'
}

export const SINGLE_REQUEST: Transport = {
  subranges: false,
  sizing: 'fixed',
  lead: 'bdp+subrange',
  keep: 'delivering'
}
/** cats3's transport. */
export const SUBRANGES_V1: Transport = {
  subranges: true,
  sizing: 'fixed',
  lead: 'bdp+subrange',
  keep: 'delivering'
}
/** cats4's transport. */
export const SUBRANGES_V2: Transport = {
  subranges: true,
  sizing: 'adaptive',
  lead: 'bdp',
  keep: 'healthy'
}
/** cats5's transport. */
export const SUBRANGES_V3: Transport = {
  subranges: true,
  sizing: 'time',
  lead: 'bdp',
  keep: 'healthy'
}

export interface Block {
  kind: 'http'
  index: number
  rangeStart: number
  /** Inclusive. A split moves it down. */
  rangeEnd: number
  status: 'pending' | 'downloading' | 'completed'
  /** Furthest any attempt has got, from rangeStart. */
  bytesDownloaded: number
  bytesByInterface: Record<string, number>
  interfaceId?: string
}

export interface Connection {
  /** Share of the per-connection ceiling this connection gets, in (0, 1]. */
  q: number
  stalledUntil: number
  /** Congestion window, bytes. Only used with tcp: 'slowstart'. */
  cwnd: number
  slowStart: boolean
  lastCutAt: number
  /** When it last finished a request with nothing to send next; null while in use. */
  idleSince: number | null
}

export interface Attempt {
  kind: 'primary' | 'hedge'
  block: Block
  stream: Stream
  /** Where the request began, from rangeStart. */
  startOffset: number
  received: number
  startedAt: number
  /** Seconds until the first byte can arrive. */
  startupLeft: number
  lastByteAt: number
  /** How far into the block it has asked for, from rangeStart: the block's end for a single
   * request (Infinity, so any cut is below it), the last sub-range's end when multiplexed. */
  committed: number
  /** A split moved the block's end below what this attempt had already asked for: the
   * connection is dropped once it gets there. */
  truncated: boolean
}

/** Bytes per step over a sliding window: a stream's or a network's recent speed. */
export class Meter {
  bins: Float64Array
  pos = 0
  sum = 0
  filled = 0

  constructor(steps: number) {
    this.bins = new Float64Array(steps)
  }

  push(bytes: number): void {
    this.sum += bytes - this.bins[this.pos]
    this.bins[this.pos] = bytes
    this.pos = (this.pos + 1) % this.bins.length
    if (this.filled < this.bins.length) this.filled++
  }

  reset(): void {
    this.bins.fill(0)
    this.pos = 0
    this.sum = 0
    this.filled = 0
  }

  rate(dt: number): number {
    return this.filled ? Math.max(0, this.sum) / (this.filled * dt) : 0
  }
}

export interface Network {
  spec: NetworkSpec
  id: string
  rtt: number
  trace: CapacityTrace
  streams: Stream[]
  /** Everything the network delivered, over 2 s. */
  meter: Meter
}

export interface Stream {
  id: number
  net: Network
  rng: Rng
  status: 'pending' | 'downloading' | 'retrying'
  needsWork: boolean
  conn: Connection | null
  attempt: Attempt | null
  /** This attempt's delivery over the last second. */
  meter: Meter
  speed: number
  stepBytes: number
  lastBlockSpeed: number
  warmSince: number
  slowSince: number | null
  failures: number
  retryAt: number
}

export interface Work {
  kind: 'primary' | 'hedge'
  block: Block
}

export interface Scheduler {
  name: string
  /** How blocks are asked for; SINGLE_REQUEST by default. */
  transport?: Transport
  init(sim: Sim): void
  pick(sim: Sim, stream: Stream): Work | undefined
}

export interface RunOptions {
  scenario: Scenario
  fileBytes: number
  seed: number
  scheduler: Scheduler
  /** Only these networks are used; all by default. */
  networkIds?: string[]
  /** 'fluid': a connection gets its share at once. 'slowstart': through a congestion window. */
  tcp?: 'fluid' | 'slowstart'
  dt?: number
  maxTime?: number
}

export interface RunResult {
  completionS: number
  lowerBoundS: number
  tailS: number
  totalBytes: number
  meteredBytes: number
  wastedBytes: number
  requests: number
  /** Requests that had to open a new connection (handshake and slow start from scratch). */
  connections: number
  splits: number
  hedges: number
  refreshes: number
  failures: number
  timedOut: boolean
}

export class Sim {
  scenario: Scenario
  fileBytes: number
  scheduler: Scheduler
  tcp: 'fluid' | 'slowstart'
  transport: Transport
  multiplexed: boolean
  dt: number
  maxTime: number
  t = 0

  nets: Network[] = []
  streams: Stream[] = []
  blocks: Block[] = []
  /** First byte no block covers yet. A scheduler that plans every block up front sets it to
   * fileBytes; one that cuts blocks as it goes moves it with carve(). */
  frontier = 0
  completedBlocks = 0
  /** Bytes of the file received, each counted once. */
  progress = 0
  live: Attempt[] = []
  attempts = new Map<number, Attempt[]>()
  avoid = new Map<number, string>()
  hedgesUsed = new Map<number, number>()
  refreshesByBlock = new Map<number, number>()

  totalBytes = 0
  meteredBytes = 0
  requests = 0
  connections = 0
  splits = 0
  hedges = 0
  refreshes = 0
  failures = 0
  tailStart: number | null = null

  constructor(options: RunOptions) {
    this.scenario = options.scenario
    this.fileBytes = options.fileBytes
    this.scheduler = options.scheduler
    this.tcp = options.tcp ?? 'fluid'
    this.transport = options.scheduler.transport ?? SINGLE_REQUEST
    this.multiplexed = this.transport.subranges
    this.dt = options.dt ?? 0.01
    this.maxTime = options.maxTime ?? 4000

    const use = options.networkIds
    let streamId = 0
    options.scenario.networks.forEach((spec, index) => {
      if (use && !use.includes(spec.id)) return
      const net: Network = {
        spec,
        id: spec.id,
        rtt: spec.rttMs / 1000,
        trace: new CapacityTrace(spec, options.seed, index),
        streams: [],
        meter: new Meter(Math.round(2 / this.dt))
      }
      for (let slot = 0; slot < options.scenario.streamsPerNetwork; slot++) {
        const stream: Stream = {
          id: streamId++,
          net,
          rng: new Rng(mixSeed(options.seed, index, slot, 0xbeef)),
          status: 'pending',
          needsWork: true,
          conn: null,
          attempt: null,
          meter: new Meter(Math.round(1 / this.dt)),
          speed: 0,
          stepBytes: 0,
          lastBlockSpeed: 0,
          warmSince: 0,
          slowSince: null,
          failures: 0,
          retryAt: 0
        }
        net.streams.push(stream)
        this.streams.push(stream)
      }
      this.nets.push(net)
    })
  }

  // --- what schedulers may call ------------------------------------------------------------------

  blockLength(block: Block): number {
    return block.rangeEnd - block.rangeStart + 1
  }

  position(attempt: Attempt): number {
    return attempt.startOffset + attempt.received
  }

  /** Adds a block of `bytes` at the frontier, waiting to be fetched. */
  carve(bytes: number): Block {
    const length = Math.min(bytes, this.fileBytes - this.frontier)
    const block = this.newBlock(this.frontier, this.frontier + length - 1)
    this.frontier += length
    return block
  }

  /** Ends `block` at `cut` (from its rangeStart) and returns the rest as a new waiting block.
   * An attempt that has already asked for bytes past the cut is truncated: it stops there and
   * drops its connection, as a single HTTP/1.1 request has to. One that hasn't just asks for
   * no more. */
  split(block: Block, cut: number): Block {
    const rest = this.newBlock(block.rangeStart + cut, block.rangeEnd)
    block.rangeEnd = block.rangeStart + cut - 1
    for (const attempt of this.attempts.get(block.index) ?? []) {
      if (attempt.committed > cut) attempt.truncated = true
    }
    this.splits++
    return rest
  }

  /** What a network has delivered per second lately. */
  netRate(net: Network): number {
    return net.meter.rate(this.dt)
  }

  // --- the run ------------------------------------------------------------------------------------

  run(): RunResult {
    this.scheduler.init(this)
    const pollSteps = Math.max(1, Math.round(POLL_S / this.dt))
    const rates: number[] = []
    let step = 0

    while (!this.done() && this.t < this.maxTime) {
      const poll = step % pollSteps === 0
      this.assignWork(poll)
      if (this.tailStart === null && this.allAssigned()) this.tailStart = this.t
      if (this.multiplexed) this.askAhead()
      this.transfer(rates)
      this.advanceStartups()
      this.finishCompleted()
      if (poll) this.refreshStuckConnections()
      this.t += this.dt
      step++
    }

    const timedOut = !this.done()
    return {
      completionS: this.t,
      lowerBoundS: lowerBound(this),
      tailS: this.t - (this.tailStart ?? this.t),
      totalBytes: this.totalBytes,
      meteredBytes: this.meteredBytes,
      wastedBytes: this.totalBytes - this.fileBytes,
      requests: this.requests,
      connections: this.connections,
      splits: this.splits,
      hedges: this.hedges,
      refreshes: this.refreshes,
      failures: this.failures,
      timedOut
    }
  }

  done(): boolean {
    return this.frontier >= this.fileBytes && this.completedBlocks === this.blocks.length
  }

  allAssigned(): boolean {
    return this.frontier >= this.fileBytes && !this.blocks.some((b) => b.status === 'pending')
  }

  assignWork(poll: boolean): void {
    for (const stream of this.streams) {
      if (stream.status === 'retrying' && this.t >= stream.retryAt) {
        stream.status = 'pending'
        stream.needsWork = true
      }
      if (stream.status !== 'pending' || !(stream.needsWork || poll)) continue
      stream.needsWork = false
      const work = this.scheduler.pick(this, stream)
      if (work) this.begin(stream, work)
    }
  }

  /** Keeps each sub-range attempt its transport's lead ahead of what it has received, so the
   * connection never waits on a request. */
  askAhead(): void {
    const withSubrange = this.transport.lead === 'bdp+subrange'
    for (const attempt of this.live) {
      if (attempt.startupLeft > 0) continue
      const size = this.subrangeSize(attempt.stream)
      const length = this.blockLength(attempt.block)
      const bdp = attempt.stream.speed * attempt.stream.net.rtt
      const ahead = withSubrange ? SUBRANGE_BYTES + bdp : bdp
      // A BDP-only lead is topped up once it is used up, so even a stream with no speed yet
      // asks again when it has received all it asked for.
      const short = (asked: number): boolean => (withSubrange ? asked < ahead : asked <= ahead)
      while (attempt.committed < length && short(attempt.committed - this.position(attempt))) {
        attempt.committed = Math.min(length, attempt.committed + size)
        this.requests++
      }
    }
  }

  subrangeSize(stream: Stream): number {
    const { sizing } = this.transport
    if (sizing === 'fixed') return SUBRANGE_BYTES
    const want =
      sizing === 'time'
        ? stream.speed * SUBRANGE_SECONDS
        : (this.fileBytes - this.progress) / (2 * this.streams.length)
    return Math.min(Math.max(want, SUBRANGE_BYTES), MAX_SUBRANGE_BYTES)
  }

  /** Whether a stream is about as fast as its network's others, judged as Plexo's crawl check
   * judges (their current speeds and last blocks). */
  isHealthy(stream: Stream): boolean {
    const reference: number[] = []
    for (const other of stream.net.streams) {
      if (other.lastBlockSpeed > 0) reference.push(other.lastBlockSpeed)
      if (other !== stream && other.attempt && other.speed > 0) reference.push(other.speed)
    }
    return reference.length === 0 || stream.speed >= HEALTHY_RATIO * median(reference)
  }

  transfer(rates: number[]): void {
    const { dt, t } = this
    const serverCap = this.scenario.connection.serverCapMBps
    const windowed = this.tcp === 'slowstart'
    for (const stream of this.streams) stream.stepBytes = 0

    for (const net of this.nets) {
      const capacity = net.trace.at(t)
      const active: Attempt[] = []
      const caps: number[] = []
      const untilEnd: number[] = []
      for (const attempt of this.live) {
        if (attempt.stream.net !== net || attempt.startupLeft > 0) continue
        const conn = attempt.stream.conn as Connection
        if (conn.stalledUntil > t) continue
        const end = Math.min(this.blockLength(attempt.block), attempt.committed)
        const left = end - this.position(attempt)
        if (left <= 0) continue
        let ceiling = conn.q * (serverCap === null ? capacity : serverCap * MB)
        if (windowed) ceiling = Math.min(ceiling, conn.cwnd / net.rtt)
        active.push(attempt)
        caps.push(Math.min(ceiling, left / dt))
        untilEnd.push(left / dt)
      }
      rates.length = active.length
      waterfill(capacity, caps, rates)
      if (windowed) this.updateWindows(net, active, rates, untilEnd)

      let delivered = 0
      for (let i = 0; i < active.length; i++) {
        const bytes = rates[i] * dt
        if (bytes <= 0) continue
        const attempt = active[i]
        attempt.received += bytes
        attempt.lastByteAt = t + dt
        attempt.stream.stepBytes += bytes
        delivered += bytes
        const block = attempt.block
        const position = this.position(attempt)
        if (position > block.bytesDownloaded) {
          block.bytesByInterface[net.id] =
            (block.bytesByInterface[net.id] ?? 0) + position - block.bytesDownloaded
          this.progress += position - block.bytesDownloaded
          block.bytesDownloaded = position
        }
      }
      net.meter.push(delivered)
      this.totalBytes += delivered
      if (net.spec.metered) this.meteredBytes += delivered

      // Connections that carried data this step may stall from the next.
      const spec = this.scenario.connection
      for (const attempt of active) {
        const stream = attempt.stream
        if (stream.rng.next() >= spec.stallRate * dt) continue
        const forever = stream.rng.next() < spec.stallPermanentProb
        const conn = stream.conn as Connection
        conn.stalledUntil = forever ? Infinity : t + stream.rng.exponential(spec.stallMeanSec)
        // A stall ends in a retransmission timeout: back to one segment, in slow start.
        conn.cwnd = MSS
        conn.slowStart = true
      }
    }

    for (const stream of this.streams) {
      const attempt = stream.attempt
      if (!attempt || attempt.startupLeft > 0) continue
      stream.meter.push(stream.stepBytes)
      stream.speed = stream.meter.rate(dt)
    }
  }

  /** Grows or cuts each connection's window from what it was given this step. */
  updateWindows(net: Network, active: Attempt[], rates: number[], untilEnd: number[]): void {
    for (let i = 0; i < active.length; i++) {
      const conn = active[i].stream.conn as Connection
      const given = rates[i]
      // Near a block's end the request, not the window or the network, sets the pace.
      if (given >= untilEnd[i] * 0.999) continue
      const allowed = conn.cwnd / net.rtt
      const acked = given * this.dt
      if (given >= allowed * 0.95) {
        conn.cwnd += conn.slowStart ? acked : (MSS * acked) / conn.cwnd
      } else if (allowed > 2 * given && this.t - conn.lastCutAt >= net.rtt) {
        conn.cwnd = Math.max(2 * MSS, conn.cwnd / 2)
        conn.slowStart = false
        conn.lastCutAt = this.t
      }
    }
  }

  advanceStartups(): void {
    for (const attempt of this.live) {
      if (attempt.startupLeft <= 0) continue
      attempt.startupLeft -= this.dt
      // Silence is counted from when bytes could first have arrived.
      if (attempt.startupLeft <= 0) attempt.lastByteAt = this.t + this.dt
    }
  }

  finishCompleted(): void {
    for (const attempt of [...this.live]) {
      if (attempt.block.status === 'completed') continue
      if (this.position(attempt) >= this.blockLength(attempt.block) - 1e-6) this.complete(attempt)
    }
  }

  // --- attempts -----------------------------------------------------------------------------------

  begin(stream: Stream, work: Work): void {
    const { block } = work
    const net = stream.net
    let startup = net.rtt
    if (!stream.conn) {
      stream.conn = {
        q: drawConnectionQuality(stream.rng, this.scenario.connection),
        stalledUntil: 0,
        cwnd: INITIAL_WINDOW,
        slowStart: true,
        lastCutAt: -Infinity,
        idleSince: null
      }
      startup = NEW_CONNECTION_RTTS * net.rtt
      this.connections++
      stream.warmSince = this.t
      stream.slowSince = null
    }
    const conn = stream.conn
    if (conn.idleSince !== null && this.t - conn.idleSince > Math.max(MIN_RTO_S, 2 * net.rtt)) {
      conn.cwnd = Math.min(conn.cwnd, INITIAL_WINDOW)
      conn.slowStart = true
    }
    conn.idleSince = null
    const startOffset = block.bytesDownloaded
    const attempt: Attempt = {
      kind: work.kind,
      block,
      stream,
      startOffset,
      received: 0,
      startedAt: this.t,
      startupLeft: startup,
      lastByteAt: this.t,
      committed: this.multiplexed
        ? Math.min(this.blockLength(block), startOffset + this.subrangeSize(stream))
        : Infinity,
      truncated: false
    }
    if (work.kind === 'primary') {
      block.status = 'downloading'
      block.interfaceId = net.id
      this.avoid.delete(block.index)
    } else {
      this.hedgesUsed.set(block.index, (this.hedgesUsed.get(block.index) ?? 0) + 1)
      this.hedges++
    }
    const inFlight = this.attempts.get(block.index)
    if (inFlight) inFlight.push(attempt)
    else this.attempts.set(block.index, [attempt])
    this.live.push(attempt)
    stream.attempt = attempt
    stream.status = 'downloading'
    stream.meter.reset()
    stream.speed = 0
    this.requests++
  }

  endAttempt(attempt: Attempt): void {
    const inFlight = this.attempts.get(attempt.block.index)
    if (inFlight) {
      inFlight.splice(inFlight.indexOf(attempt), 1)
      if (inFlight.length === 0) this.attempts.delete(attempt.block.index)
    }
    this.live.splice(this.live.indexOf(attempt), 1)
    if (attempt.stream.attempt === attempt) attempt.stream.attempt = null
  }

  complete(attempt: Attempt): void {
    const { block, stream } = attempt
    block.status = 'completed'
    this.completedBlocks++
    this.endAttempt(attempt)
    stream.lastBlockSpeed = attempt.received / Math.max(this.dt, attempt.lastByteAt - attempt.startedAt)
    stream.failures = 0
    // The server is still sending past the cut: what was in flight is wasted, and the connection
    // goes.
    if (attempt.truncated) this.dropConnection(stream, attempt, Infinity)
    this.goIdle(stream)
    for (const rival of [...(this.attempts.get(block.index) ?? [])]) this.abort(rival, 'lost')
  }

  /** Bytes already on the wire when a connection is dropped arrive anyway, and are wasted. */
  dropConnection(stream: Stream, attempt: Attempt, left: number): void {
    const inFlight = Math.min(left, stream.speed * stream.net.rtt)
    this.totalBytes += inFlight
    if (stream.net.spec.metered) this.meteredBytes += inFlight
    stream.conn = null
  }

  abort(attempt: Attempt, reason: 'lost' | 'refresh' | 'failed'): void {
    const { block, stream } = attempt
    const asked = Math.min(this.blockLength(block), attempt.committed)
    const left = Math.max(0, asked - this.position(attempt))
    const delivering = this.t - attempt.lastByteAt <= Math.max(1, 4 * stream.net.rtt)
    const keep =
      this.multiplexed &&
      reason === 'lost' &&
      delivering &&
      (this.transport.keep === 'delivering' || this.isHealthy(stream))
    if (keep) {
      // A cancelled stream: what was on the wire still arrives, and the connection stays.
      const inFlight = Math.min(left, stream.speed * stream.net.rtt)
      this.totalBytes += inFlight
      if (stream.net.spec.metered) this.meteredBytes += inFlight
    } else {
      this.dropConnection(stream, attempt, left)
    }
    this.endAttempt(attempt)

    if (block.status !== 'completed') {
      if (attempt.received === 0) this.avoid.set(block.index, stream.net.id)
      if (attempt.kind === 'primary') {
        const others = this.attempts.get(block.index)
        // A hedge still running carries on as the block's primary.
        if (others?.length) others[0].kind = 'primary'
        else block.status = 'pending'
      }
    }

    if (reason === 'failed' && attempt.kind === 'primary') {
      this.failures++
      stream.failures = attempt.received > 0 ? 1 : stream.failures + 1
      const delay = Math.min(RETRY_BASE_S * 2 ** (stream.failures - 1), RETRY_MAX_S)
      stream.status = 'retrying'
      stream.retryAt = this.t + delay * stream.rng.uniform(0.8, 1.2)
      stream.attempt = null
      stream.speed = 0
      stream.meter.reset()
      return
    }
    this.goIdle(stream)
  }

  goIdle(stream: Stream): void {
    if (stream.conn) stream.conn.idleSince = this.t
    stream.status = 'pending'
    stream.attempt = null
    stream.needsWork = true
    stream.speed = 0
    stream.meter.reset()
  }

  /** Plexo's refreshStuckConnections, plus its stall watchdog. */
  refreshStuckConnections(): void {
    const { t } = this
    for (const attempt of [...this.live]) {
      if (t - attempt.lastByteAt >= STALL_TIMEOUT_S) {
        this.abort(attempt, 'failed')
        continue
      }
      const silent =
        attempt.received === 0 &&
        t - attempt.startedAt >= SILENT_AFTER_S &&
        this.blocks.some((b) => b !== attempt.block && b.bytesDownloaded > 0)
      const isPrimary = attempt.kind === 'primary'
      const refreshes = this.refreshesByBlock.get(attempt.block.index) ?? 0
      if (isPrimary && refreshes >= MAX_REFRESHES_PER_BLOCK) continue
      if (silent || (isPrimary && this.isCrawling(attempt.stream))) {
        if (isPrimary) this.refreshesByBlock.set(attempt.block.index, refreshes + 1)
        this.refreshes++
        this.abort(attempt, 'refresh')
      }
    }
  }

  isCrawling(stream: Stream): boolean {
    const warm = (s: Stream): boolean => this.t - s.warmSince >= SLOW_WARMUP_S
    if (!warm(stream)) return false
    const reference: number[] = []
    for (const other of stream.net.streams) {
      if (other.lastBlockSpeed > 0) reference.push(other.lastBlockSpeed)
      if (other !== stream && other.attempt && warm(other)) reference.push(other.speed)
    }
    if (reference.length === 0 || stream.speed >= median(reference) * SLOW_RATIO) {
      stream.slowSince = null
      return false
    }
    stream.slowSince ??= this.t
    return this.t - stream.slowSince >= SLOW_FOR_S
  }

  newBlock(start: number, end: number): Block {
    const block: Block = {
      kind: 'http',
      index: this.blocks.length,
      rangeStart: start,
      rangeEnd: end,
      status: 'pending',
      bytesDownloaded: 0,
      bytesByInterface: {}
    }
    this.blocks.push(block)
    return block
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** The fastest any scheduler could finish: one connection setup, then every network carrying
 * all it can (its capacity, or its streams' combined server cap) with no stragglers. It ignores
 * slow start, so under tcp: 'slowstart' it is looser. */
export function lowerBound(sim: Sim): number {
  const serverCap = sim.scenario.connection.serverCapMBps
  const perNetCap =
    serverCap === null ? Infinity : serverCap * MB * sim.scenario.streamsPerNetwork
  const setup = NEW_CONNECTION_RTTS * Math.min(...sim.nets.map((n) => n.rtt))
  let t = setup
  let left = sim.fileBytes
  const grid = 0.01
  while (left > 0 && t < sim.maxTime * 2) {
    let rate = 0
    for (const net of sim.nets) rate += Math.min(net.trace.at(t), perNetCap)
    left -= rate * grid
    t += grid
  }
  return t
}
