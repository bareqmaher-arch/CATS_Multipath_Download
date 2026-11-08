import type { Block, Scheduler, Sim } from '../sim.ts'
import {
  MPH2_TRANSPORT,
  newState,
  pipelinedPick,
  prefetch,
  responseDelay,
  sampleBandwidth,
  type BaselineState
} from './mph2.ts'

// Dynamic parallel access (Rodriguez, Biersack, IEEE/ACM ToN 2002), as described in the paper:
//
// - The document is divided into B blocks of equal size, B much larger than the number M of
//   sources (the paper's main runs: B = 30 for M = 4). The client first requests one block from
//   every source; each time a block is completely received from a source, it requests from that
//   source a block not yet requested from any other.
// - With request pipelining (section IV-A, which removes the round trip between blocks): the next
//   block is requested at least one round trip before the current one is completely received.
// - At the end: when there are fewer than M blocks missing, an idle source is asked for a block
//   already requested from another source but not yet fully received; the first copy to arrive
//   wins and the slower ones are stopped.
//
// Not in the paper, so chosen here: B = max(30, 7.5 M), the paper's ratio when there are many
// sources; the block copied is the one with the fewest copies and then the most bytes still
// missing; a copy asks only for the missing bytes (the paper's own suggested refinement, and
// how Sim starts any copy), which favours this baseline. Blocks are asked for over HTTP/2, so a
// pipelined request can be sent while one is arriving (as MP-H2's are). "rb" is one connection
// per path; "rb-eq" treats each of the scenario's connections as a source.

const BLOCKS_PER_SOURCE = 7.5
const MIN_BLOCKS = 30

export function rodriguezBiersack(name: string): { scheduler: Scheduler; state: BaselineState } {
  const state = newState(pipeline)
  const scheduler: Scheduler = {
    name,
    transport: MPH2_TRANSPORT,
    init(sim) {
      const count = Math.max(MIN_BLOCKS, Math.ceil(BLOCKS_PER_SOURCE * sim.streams.length))
      const size = Math.ceil(sim.fileBytes / count)
      while (sim.frontier < sim.fileBytes) sim.carve(size)
    },
    pick(sim, stream) {
      const next = pipelinedPick(state, stream)
      if (next) return { kind: 'primary', block: next }
      const fresh = unrequested(sim, state)
      if (fresh) return { kind: 'primary', block: fresh }
      // End game: copy a block someone else is still receiving.
      let best: Block | undefined
      let bestCopies = Infinity
      let bestLeft = -1
      for (const block of sim.blocks) {
        if (block.status !== 'downloading') continue
        const attempts = sim.attempts.get(block.index) ?? []
        if (attempts.some((a) => a.stream === stream)) continue
        const left = sim.blockLength(block) - block.bytesDownloaded
        if (attempts.length < bestCopies || (attempts.length === bestCopies && left > bestLeft)) {
          best = block
          bestCopies = attempts.length
          bestLeft = left
        }
      }
      return best && { kind: 'hedge', block: best }
    }
  }
  return { scheduler, state }
}

function unrequested(sim: Sim, state: BaselineState): Block | undefined {
  return sim.blocks.find((b) => b.status === 'pending' && !state.reserved.has(b))
}

/** Requests a stream's next block one response delay before its current one ends. */
function pipeline(sim: Sim, state: BaselineState): void {
  sampleBandwidth(sim, state)
  for (const stream of sim.streams) {
    const attempt = stream.attempt
    if (!attempt || attempt.startupLeft > 0 || attempt.kind !== 'primary') continue
    if (state.pipelined.has(stream)) continue
    const rate = Math.max(stream.speed, state.bandwidth.get(stream)?.get() ?? 0)
    if (rate <= 0) continue
    const left = sim.blockLength(attempt.block) - sim.position(attempt)
    if (left / rate > responseDelay(state, stream) + sim.dt) continue
    const block = unrequested(sim, state)
    if (!block) return
    state.reserved.add(block)
    state.pipelined.set(stream, { block, requestedAt: sim.t })
    prefetch(sim, stream, block)
  }
}
