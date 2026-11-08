import http from 'node:http'
import http2 from 'node:http2'
import net from 'node:net'
import { lowerBound, Sim, type Attempt, type Block, type RunOptions, type Stream } from '../sim.ts'

// The simulator's engine driven by real HTTP over real TCP. Everything that decides — the
// schedulers, block bookkeeping, sub-range lead and sizing, the healthy-connection rule, Plexo's
// refresh and retry rules — is Sim's own code, inherited unchanged. Only what Sim models is
// replaced: bytes come from sockets instead of a capacity model, the clock is the wall clock, and
// dropping or cancelling acts on real connections.
//
//   One request per block (Plexo): HTTP/1.1, one keep-alive connection per stream.
//   Sub-ranges (cats5, plexo-mux3): HTTP/2 streams on one connection per stream, so a cancel is
//   an RST_STREAM and the connection stays.
//
// Each stream's connection is bound to its network's local address; in the testbed every
// network is its own veth path to the server (testbed/setup.sh).

export interface Endpoint {
  /** Server address reached through this network. */
  host: string
  /** This network's address on the client. */
  localAddress: string
}

export interface RealOptions extends RunOptions {
  endpoints: Record<string, Endpoint>
  path: string
  h1Port: number
  h2Port: number
}

export interface RealResult {
  completionS: number
  lowerBoundS: number
  tailS: number
  /** Bytes the client application received, wasted ones included. */
  appBytes: number
  appBytesByNet: Record<string, number>
  requests: number
  connections: number
  splits: number
  hedges: number
  refreshes: number
  failures: number
  /** Mean gap between engine ticks, ms (10 is ideal). */
  meanTickMs: number
  errors: Record<string, number>
  timedOut: boolean
}

interface Part {
  /** From the block's rangeStart, end exclusive. */
  start: number
  end: number
  got: number
  h2: http2.ClientHttp2Stream
}

interface Io {
  req?: http.ClientRequest
  /** HTTP/1.1: bytes received since the request's first byte. */
  got: number
  parts: Part[]
  /** How far into the block has been requested, from rangeStart. */
  issuedEnd: number
  error: Error | null
  closed: boolean
}

interface Link {
  agent?: http.Agent
  socket?: net.Socket
  session?: http2.ClientHttp2Session
}

const MAX_WINDOW = 64 * 1024 * 1024

export class RealEngine extends Sim {
  endpoints: Record<string, Endpoint>
  path: string
  h1Port: number
  h2Port: number
  io = new Map<Attempt, Io>()
  /** Ranges asked for ahead of their attempt (see prefetch), by block. */
  prefetched = new Map<Block, { stream: Stream; io: Io }>()
  links = new Map<Stream, Link>()
  /** Raw bytes per stream and network since the last tick. */
  rawByStream = new Map<Stream, number>()
  rawByNet = new Map<string, number>()
  appBytes = 0
  appBytesByNet: Record<string, number> = {}
  realRequests = 0
  /** Request errors by code, for diagnosis. */
  errors: Record<string, number> = {}

  constructor(options: RealOptions) {
    super(options)
    this.endpoints = options.endpoints
    this.path = options.path
    this.h1Port = options.h1Port
    this.h2Port = options.h2Port
    for (const n of this.nets) this.appBytesByNet[n.id] = 0
  }

  runReal(): Promise<RealResult> {
    this.scheduler.init(this)
    const started = performance.now()
    const tickMs = this.dt * 1000
    let ticks = 0
    let lastPoll = -Infinity

    return new Promise((resolve) => {
      const tick = (): void => {
        this.t = (performance.now() - started) / 1000
        ticks++
        const poll = this.t - lastPoll >= 0.1
        if (poll) lastPoll = this.t

        this.failErrored()
        this.assignWork(poll)
        if (this.tailStart === null && this.allAssigned()) this.tailStart = this.t
        if (this.multiplexed) this.askAhead()
        this.transfer()
        this.finishCompleted()
        if (poll) this.refreshStuckConnections()

        if (this.done() || this.t >= this.maxTime) {
          const timedOut = !this.done()
          this.closeAll()
          resolve({
            completionS: this.t,
            lowerBoundS: lowerBound(this),
            tailS: this.t - (this.tailStart ?? this.t),
            appBytes: this.appBytes,
            appBytesByNet: this.appBytesByNet,
            requests: this.realRequests,
            connections: this.connections,
            splits: this.splits,
            hedges: this.hedges,
            refreshes: this.refreshes,
            failures: this.failures,
            meanTickMs: (this.t * 1000) / ticks,
            errors: this.errors,
            timedOut
          })
          return
        }
        // Aim at the next 10 ms boundary, so late ticks don't drift the clock the meters assume.
        const next = started + (ticks + 1) * tickMs
        setTimeout(tick, Math.max(0, next - performance.now()))
      }
      tick()
    })
  }

  // --- what Sim models, replaced ------------------------------------------------------------------

  advanceStartups(): void {}

  transfer(): void {
    for (const stream of this.streams) stream.stepBytes = 0
    const usefulByNet = new Map<string, number>()

    for (const attempt of this.live) {
      const io = this.io.get(attempt)
      if (!io) continue
      const block = attempt.block
      const reached = this.multiplexed ? this.contiguous(attempt, io) : attempt.startOffset + io.got
      const limit = Math.min(this.blockLength(block), attempt.committed)
      // Whole bytes: Sim's sizes are fractional, but a cut made at this position becomes a
      // Range header.
      const position = Math.floor(Math.min(reached, limit))
      const delta = position - this.position(attempt)
      const raw = this.rawByStream.get(attempt.stream) ?? 0
      if (raw > 0 && attempt.startupLeft > 0) attempt.startupLeft = 0
      if (raw > 0) attempt.lastByteAt = this.t
      if (delta <= 0) continue
      attempt.received += delta
      const id = attempt.stream.net.id
      usefulByNet.set(id, (usefulByNet.get(id) ?? 0) + delta)
      if (position > block.bytesDownloaded) {
        block.bytesByInterface[id] = (block.bytesByInterface[id] ?? 0) + position - block.bytesDownloaded
        this.progress += position - block.bytesDownloaded
        block.bytesDownloaded = position
      }
    }

    // Speeds come from what the sockets delivered, as Plexo's meters do.
    for (const net of this.nets) {
      net.meter.push(this.rawByNet.get(net.id) ?? 0)
    }
    for (const stream of this.streams) {
      const attempt = stream.attempt
      const raw = this.rawByStream.get(stream) ?? 0
      stream.stepBytes = raw
      if (!attempt || attempt.startupLeft > 0) continue
      stream.meter.push(raw)
      stream.speed = stream.meter.rate(this.dt)
    }
    this.rawByStream.clear()
    this.rawByNet.clear()
  }

  begin(stream: Stream, work: Parameters<Sim['begin']>[1]): void {
    const early = this.prefetched.get(work.block)
    this.prefetched.delete(work.block)
    const usable = early && early.stream === stream && stream.conn && !early.io.error && !early.io.closed
    if (early && !usable) this.cancel(early.io)

    const fresh = !stream.conn
    super.begin(stream, work)
    const attempt = stream.attempt as Attempt
    // Transferring once the first byte is in, not after a modelled handshake.
    attempt.startupLeft = 1
    if (fresh) this.closeLink(stream)
    if (usable) {
      // Asked for while the stream's last range was still arriving (prefetch): carry on with it.
      const io = early.io
      this.io.set(attempt, io)
      if (io.parts.some((p) => p.got > 0)) {
        attempt.startupLeft = 0
        attempt.lastByteAt = this.t
      }
      if (attempt.committed > io.issuedEnd) this.issue(attempt, io, attempt.committed)
      return
    }
    const io: Io = { got: 0, parts: [], issuedEnd: attempt.startOffset, error: null, closed: false }
    this.io.set(attempt, io)
    if (this.multiplexed) this.issue(attempt, io, attempt.committed)
    else this.requestWhole(attempt, io)
  }

  /** Asks for the start of `block` on the stream's connection now, while its current range is
   * still arriving: MP-H2's pipelined second stream. begin() picks it up. Sub-ranges only. */
  prefetch(stream: Stream, block: Block): void {
    if (!this.multiplexed || !stream.conn) return
    const io: Io = { got: 0, parts: [], issuedEnd: 0, error: null, closed: false }
    const upTo = Math.min(this.blockLength(block), this.subrangeSize(stream))
    this.issue({ stream, block } as Attempt, io, upTo)
    this.prefetched.set(block, { stream, io })
  }

  cancel(io: Io): void {
    io.closed = true
    for (const part of io.parts) {
      if (!part.h2.closed) part.h2.close(http2.constants.NGHTTP2_CANCEL)
    }
  }

  askAhead(): void {
    super.askAhead()
    for (const attempt of this.live) {
      const io = this.io.get(attempt)
      if (io && !io.closed && attempt.committed > io.issuedEnd) this.issue(attempt, io, attempt.committed)
    }
  }

  complete(attempt: Attempt): void {
    const io = this.io.get(attempt)
    if (io) io.closed = true
    super.complete(attempt)
    this.io.delete(attempt)
  }

  abort(attempt: Attempt, reason: 'lost' | 'refresh' | 'failed'): void {
    const io = this.io.get(attempt)
    if (io) io.closed = true
    const stream = attempt.stream
    super.abort(attempt, reason)
    // Kept (a sub-range race lost on a healthy connection): cancel its streams, keep the rest.
    if (stream.conn && io) {
      for (const part of io.parts) {
        if (!part.h2.closed) part.h2.close(http2.constants.NGHTTP2_CANCEL)
      }
    }
    this.io.delete(attempt)
  }

  dropConnection(stream: Stream): void {
    this.closeLink(stream)
    stream.conn = null
  }

  // --- requests -----------------------------------------------------------------------------------

  failErrored(): void {
    for (const attempt of [...this.live]) {
      const io = this.io.get(attempt)
      if (!io?.error || io.closed) continue
      const kind = (io.error as NodeJS.ErrnoException).code ?? io.error.message
      this.errors[kind] = (this.errors[kind] ?? 0) + 1
      this.abort(attempt, 'failed')
    }
  }

  received(stream: Stream, bytes: number): void {
    this.rawByStream.set(stream, (this.rawByStream.get(stream) ?? 0) + bytes)
    const id = stream.net.id
    this.rawByNet.set(id, (this.rawByNet.get(id) ?? 0) + bytes)
    this.appBytes += bytes
    this.appBytesByNet[id] += bytes
  }

  requestWhole(attempt: Attempt, io: Io): void {
    const stream = attempt.stream
    const endpoint = this.endpoints[stream.net.id]
    const link = this.linkOf(stream)
    link.agent ??= new http.Agent({ keepAlive: true, maxSockets: 1 })
    const start = attempt.block.rangeStart + attempt.startOffset
    const req = http.request({
      host: endpoint.host,
      port: this.h1Port,
      path: this.path,
      agent: link.agent,
      localAddress: endpoint.localAddress,
      headers: { Range: `bytes=${start}-${attempt.block.rangeEnd}` }
    })
    io.req = req
    io.issuedEnd = this.blockLength(attempt.block)
    req.on('response', (res) => {
      if (res.statusCode !== 206) {
        io.error = new Error(`HTTP ${res.statusCode}`)
        res.resume()
        return
      }
      res.on('data', (chunk: Buffer) => {
        if (io.closed) return
        io.got += chunk.length
        this.received(stream, chunk.length)
      })
      res.on('error', (error) => {
        if (!io.closed) io.error = error
      })
    })
    req.on('error', (error) => {
      if (!io.closed) io.error = error
    })
    req.on('socket', (socket) => {
      if (link.socket === socket) return
      link.socket = socket
      socket.once('close', () => {
        if (link.socket !== socket) return
        link.socket = undefined
        // The server closed a kept-alive connection: the next request opens a new one. One that
        // closes mid-request fails the request instead.
        if (!stream.attempt) stream.conn = null
      })
    })
    req.end()
    this.realRequests++
  }

  issue(attempt: Attempt, io: Io, upTo: number): void {
    const stream = attempt.stream
    // Sim sizes sub-ranges in fractional bytes; a Range header needs whole ones.
    const start = io.issuedEnd
    const end = Math.min(this.blockLength(attempt.block), Math.ceil(upTo))
    if (end <= start) return
    const session = this.sessionOf(stream)
    const h2 = session.request({
      ':method': 'GET',
      ':path': this.path,
      range: `bytes=${attempt.block.rangeStart + start}-${attempt.block.rangeStart + end - 1}`
    })
    const part: Part = { start, end, got: 0, h2 }
    io.parts.push(part)
    io.issuedEnd = end
    h2.on('response', (headers) => {
      if (headers[':status'] !== 206 && !io.closed) io.error = new Error(`HTTP ${headers[':status']}`)
    })
    h2.on('data', (chunk: Buffer) => {
      if (io.closed) return
      part.got += chunk.length
      this.received(stream, chunk.length)
    })
    h2.on('error', (error) => {
      if (!io.closed) io.error = error
    })
    this.realRequests++
  }

  /** How far the attempt's sub-ranges have arrived without a gap, from the block's rangeStart. */
  contiguous(attempt: Attempt, io: Io): number {
    let reached = attempt.startOffset
    for (const part of io.parts) {
      if (part.start !== reached) break
      reached += part.got
      if (part.got < part.end - part.start) break
    }
    return reached
  }

  // --- connections --------------------------------------------------------------------------------

  linkOf(stream: Stream): Link {
    let link = this.links.get(stream)
    if (!link) {
      link = {}
      this.links.set(stream, link)
    }
    return link
  }

  sessionOf(stream: Stream): http2.ClientHttp2Session {
    const link = this.linkOf(stream)
    if (link.session && !link.session.destroyed && !link.session.closed) return link.session
    const endpoint = this.endpoints[stream.net.id]
    const session = http2.connect(`http://${endpoint.host}:${this.h2Port}`, {
      createConnection: () =>
        net.connect({ host: endpoint.host, port: this.h2Port, localAddress: endpoint.localAddress }),
      settings: { initialWindowSize: MAX_WINDOW - 1 }
    })
    session.on('connect', () => {
      // It may already have been dropped while it was connecting.
      if (!session.destroyed && !session.closed) session.setLocalWindowSize(MAX_WINDOW)
    })
    session.on('error', () => {})
    session.on('close', () => {
      if (link.session === session) {
        link.session = undefined
        stream.conn = null
      }
    })
    link.session = session
    return session
  }

  closeLink(stream: Stream): void {
    for (const [block, early] of this.prefetched) {
      if (early.stream !== stream) continue
      early.io.closed = true
      this.prefetched.delete(block)
    }
    const link = this.links.get(stream)
    if (!link) return
    link.agent?.destroy()
    link.agent = undefined
    link.socket = undefined
    const session = link.session
    link.session = undefined
    session?.destroy()
  }

  closeAll(): void {
    for (const io of this.io.values()) io.closed = true
    for (const stream of this.streams) this.closeLink(stream)
  }
}
