import type { Block, Scheduler, Sim, Stream } from '../sim.ts'
import {
  MPH2_TRANSPORT,
  newState,
  pipelinedPick,
  prefetch,
  responseDelay,
  sampleBandwidth,
  type BaselineState
} from './mph2.ts'

// Two-way download: MPRD (Srinivasan, Aryafar, ICDCS 2025), the multi-source form of DEMS's
// opposite-ends idea (Guo et al., MobiCom 2017), as a client can do it with range requests.
//
// MPRD, as described in the paper (section IV):
// - The fastest source sends forward from the start; the others, sorted by estimated throughput
//   (W / RTT at first), send in reverse from offsets set by Equations 1 and 2: each source's share
//   of the N bytes is SegSent_j = N R_j / sum R, and reverse source k starts at
//   TWoffset_k = sum_{j<=k} SegSent_j. So the forward source and reverse source 1 meet in
//   [0, TWoffset_1), and reverse source k alone covers (TWoffset_(k-1), TWoffset_k].
// - Crossovers: when the forward pointer meets reverse pointer 1, both move to the unreceived
//   part of the next region, the forward one from its start and reverse 1 from a new offset set
//   by Equation 2; a reverse pointer that finishes its region early is placed between the forward
//   pointer and reverse pointer 1, again by Equation 2. Lower bytes first. No copies.
//
// MPRD's sources send in reverse on the client's instruction, which an HTTP server does not do;
// here a reverse pointer is a run of descending range requests, each the next piece below the
// last, the next one asked for a response delay before the current one ends (so it streams as a
// reverse sender would). The forward pointer is one range fetched as sub-ranges (MP-H2's
// transport), whose end the reverse pieces move down. In general form: every region has at most
// one forward and one reverse consumer; a forward pointer that is free takes the lowest region
// nobody is fetching forward, and a reverse pointer that is free joins the lowest region with
// bytes nobody has asked for, splitting it by Equation 2 with the region's reverse consumer.
//
// Not in the paper, so chosen here: a reverse piece lasts PIECE_S at its pointer's rate (between
// 64 KiB and 2 MiB; MPRD's segments are packets); rates are the measured throughput (MP-H2's
// estimator) or W / RTT before any; a piece orphaned by a failed connection goes to the next
// pointer that asks. "twoway" is one connection per path (MPRD's one per source); "twoway-eq"
// treats each of the scenario's connections as a source.

const PIECE_S = 0.2
const MIN_PIECE = 64 * 1024
const MAX_PIECE = 2 * 1024 * 1024
const INITIAL_WINDOW = 10 * 1460

interface Region {
  block: Block
  fwd: Stream | null
  rev: Stream | null
}

export function twoWay(name: string): { scheduler: Scheduler; state: BaselineState } {
  let regions: Region[] = []
  const forward = new Set<Stream>()
  const pieces = new Set<Block>()
  const state = newState((sim, st) => pipelineReverse(sim, st))

  const rate = (stream: Stream): number => {
    const measured = state.bandwidth.get(stream)?.get() ?? 0
    if (measured > 0) return measured
    if (stream.speed > 0) return stream.speed
    return INITIAL_WINDOW / stream.net.rtt
  }

  /** Bytes of a region nobody has asked for yet, from its block's start: [lo, length). */
  const unrequested = (sim: Sim, region: Region): { lo: number; length: number } => {
    const block = region.block
    const length = sim.blockLength(block)
    if (block.status === 'completed') return { lo: length, length }
    let lo = block.bytesDownloaded
    for (const attempt of sim.attempts.get(block.index) ?? []) {
      lo = Math.max(lo, Math.min(length, attempt.committed), sim.position(attempt))
    }
    return { lo: Math.ceil(lo), length }
  }

  const tidy = (): void => {
    regions = regions.filter((r) => r.block.status !== 'completed' && !pieces.has(r.block))
    regions.sort((a, b) => a.block.rangeStart - b.block.rangeStart)
  }

  /** The next piece below what a reverse pointer has fetched in its region, or nothing when it
   * has met the forward pointer (or the region's bottom). */
  const takePiece = (sim: Sim, stream: Stream, region: Region): Block | undefined => {
    const { lo, length } = unrequested(sim, region)
    const span = length - lo
    if (span <= 0) return undefined
    const size = Math.min(MAX_PIECE, Math.max(MIN_PIECE, rate(stream) * PIECE_S))
    if (span >= size + MIN_PIECE) {
      const piece = sim.split(region.block, Math.floor(length - size))
      pieces.add(piece)
      return piece
    }
    if (region.block.status === 'pending' && lo === 0) {
      // Nobody fetches this region forward: the rest of it is the last piece.
      pieces.add(region.block)
      region.rev = null
      tidy()
      return region.block
    }
    if (lo > 0 && span >= MIN_PIECE) {
      const piece = sim.split(region.block, lo)
      pieces.add(piece)
      return piece
    }
    return undefined
  }

  /** A free reverse pointer joins the lowest region with bytes nobody has asked for. */
  const join = (sim: Sim, stream: Stream): Region | undefined => {
    tidy()
    for (const region of regions) {
      const { lo, length } = unrequested(sim, region)
      const span = length - lo
      if (span < 2 * MIN_PIECE) continue
      if (region.rev === null) {
        region.rev = stream
        return region
      }
      // Equation 2 over the region's consumers: the lower part is shared by its forward pointer
      // and this one, the upper part stays with its reverse consumer.
      const lower = rate(stream) + (region.fwd ? rate(region.fwd) : 0)
      const upper = rate(region.rev)
      const cut = Math.round(lo + (span * lower) / (lower + upper))
      if (cut - lo < MIN_PIECE || length - cut < MIN_PIECE) continue
      const rest = sim.split(region.block, cut)
      regions.push({ block: rest, fwd: null, rev: region.rev })
      region.rev = stream
      tidy()
      return region
    }
    return undefined
  }

  const regionOf = (stream: Stream): Region | undefined => regions.find((r) => r.rev === stream)

  const scheduler: Scheduler = {
    name,
    transport: MPH2_TRANSPORT,
    init(sim) {
      const order = [...sim.streams].sort((a, b) => rate(b) - rate(a))
      const total = order.reduce((sum, s) => sum + rate(s), 0)
      const share = (s: Stream) => (sim.fileBytes * rate(s)) / total
      const [first, ...reverse] = order
      forward.add(first)
      let length = share(first) + (reverse.length ? share(reverse[0]) : 0)
      regions.push({ block: sim.carve(Math.round(length)), fwd: first, rev: reverse[0] ?? null })
      for (let k = 1; k < reverse.length; k++) {
        length = k === reverse.length - 1 ? sim.fileBytes - sim.frontier : Math.round(share(reverse[k]))
        regions.push({ block: sim.carve(length), fwd: null, rev: reverse[k] })
      }
      if (sim.frontier < sim.fileBytes) regions[regions.length - 1].block.rangeEnd = sim.fileBytes - 1
      sim.frontier = sim.fileBytes
    },
    pick(sim, stream) {
      const next = pipelinedPick(state, stream)
      if (next) return { kind: 'primary', block: next }
      const orphan = sim.blocks.find((b) => b.status === 'pending' && pieces.has(b) && !state.reserved.has(b))
      if (orphan) return { kind: 'primary', block: orphan }
      tidy()

      if (forward.has(stream)) {
        let region = regions.find((r) => r.fwd === stream)
        if (!region || region.block.status !== 'pending') {
          if (region) region.fwd = null
          region = regions.find((r) => r.fwd === null && r.block.status === 'pending')
          if (!region) return undefined
          region.fwd = stream
        }
        return { kind: 'primary', block: region.block }
      }

      let region = regionOf(stream)
      let piece = region && takePiece(sim, stream, region)
      if (!piece) {
        if (region) region.rev = null
        region = join(sim, stream)
        piece = region && takePiece(sim, stream, region)
      }
      return piece && { kind: 'primary', block: piece }
    }
  }

  /** Asks for a reverse pointer's next piece a response delay before its current one ends. */
  function pipelineReverse(sim: Sim, st: BaselineState): void {
    sampleBandwidth(sim, st)
    for (const stream of sim.streams) {
      if (forward.has(stream) || st.pipelined.has(stream)) continue
      const attempt = stream.attempt
      if (!attempt || attempt.startupLeft > 0 || !pieces.has(attempt.block)) continue
      const left = sim.blockLength(attempt.block) - sim.position(attempt)
      if (left / rate(stream) > responseDelay(st, stream) + sim.dt) continue
      const region = regionOf(stream)
      const piece = region && takePiece(sim, stream, region)
      if (!piece) continue
      st.reserved.add(piece)
      st.pipelined.set(stream, { block: piece, requestedAt: sim.t })
      prefetch(sim, stream, piece)
    }
  }

  return { scheduler, state }
}
