import type { Scheduler, Sim } from '../sim.ts'
import {
  newState,
  orphan,
  pipelinedPick,
  prefetch,
  sampleBandwidth,
  type BaselineState
} from './mph2.ts'

// MPTCP in the simulator, idealised: one subflow per network carrying one transfer of the whole
// file, its bytes handed out to whichever subflow has room next, in CHUNK-sized pieces with the
// next always queued and no request between them, so no subflow ever waits and none is left
// holding much at the end. That is MPTCP with near-perfect scheduling and a receive buffer
// large enough that a slow subflow never blocks a fast one, which minRTT scheduling and
// head-of-line blocking keep a real kernel from. It is not an exact bound: it schedules pieces,
// not packets, and each subflow is one of Sim's connections (with its quality draw). In MP-H2's
// own setting it lands within about 11% of MP-H2 either way (src/baselines/check.ts), as the
// paper found the real MPTCP does.

// A piece lasts PIECE_S at its subflow's speed: long against Sim's 10 ms step, which would
// otherwise lose part of a step at every hand-over. Near the end pieces shrink to half a
// subflow's share of what is left, down to MIN_PIECE, so the subflows finish together as
// packet-level scheduling would have them.
const PIECE_S = 0.2
const FIRST_PIECE = 128 * 1024
const MIN_PIECE = 16 * 1024

function pieceSize(sim: Sim, rate: number): number {
  const share = (sim.fileBytes - sim.frontier) / (2 * sim.streams.length)
  const want = rate > 0 ? rate * PIECE_S : FIRST_PIECE
  return Math.max(MIN_PIECE, Math.ceil(Math.min(want, share)))
}

export function mptcp(name: string): { scheduler: Scheduler; state: BaselineState } {
  const state = newState(keepFed)
  state.continuous = true
  const scheduler: Scheduler = {
    name,
    transport: { subranges: true, sizing: 'fixed', lead: 'bdp', keep: 'delivering' },
    init() {},
    pick(sim, stream) {
      const next = pipelinedPick(state, stream)
      if (next) return { kind: 'primary', block: next }
      const left = orphan(sim, state)
      if (left) return { kind: 'primary', block: left }
      if (sim.frontier < sim.fileBytes) {
        return { kind: 'primary', block: sim.carve(pieceSize(sim, stream.speed)) }
      }
      return undefined
    }
  }
  return { scheduler, state }
}

/** Keeps one piece queued behind each subflow's current one, so it never runs dry. */
function keepFed(sim: Sim, state: BaselineState): void {
  sampleBandwidth(sim, state)
  for (const stream of sim.streams) {
    const attempt = stream.attempt
    if (!attempt || attempt.startupLeft > 0 || state.pipelined.has(stream)) continue
    if (sim.frontier >= sim.fileBytes) continue
    const rate = Math.max(stream.speed, state.bandwidth.get(stream)?.get() ?? 0)
    const piece = sim.carve(pieceSize(sim, rate))
    state.reserved.add(piece)
    state.pipelined.set(stream, { block: piece, requestedAt: sim.t })
    prefetch(sim, stream, piece)
  }
}
