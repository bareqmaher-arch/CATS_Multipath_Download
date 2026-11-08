import { algorithm } from './algorithms.ts'
import type { Scenario } from './network.ts'
import type { Block, Scheduler, Sim, Stream, Work } from './sim.ts'
import { newState, pipelinedPick, prefetch, responseDelay, type BaselineState } from './baselines/mph2.ts'

// cats6 = cats5 with its next block pipelined.
//
// cats5 asks for a stream's next work only once its current block is in, so every block a
// stream fetches costs a round trip of idle connection. That is what the steady-link, small-file
// cells lose to the designs that never idle (MP-H2's pipelined second stream, two-way download,
// Rodriguez and Biersack's pipelined blocks): on the testbed cats5 was 4-9% behind twoway-eq and
// rb-eq there (REPORT.md, section 6b).
//
// The change: one measured response delay before a stream's current block ends, cats5's own
// pick runs for it as if it were free, and the work it chooses (a waiting block, a newly cut one,
// or the back of a split) is asked for at once on the same connection, so its first bytes come
// as the current block's last ones do. Every decision is still cats5's; only when it is taken
// moves, by about a round trip. A pipelined block is held for its stream and hidden from the
// others' picks; a copy (hedge) is never pipelined, as it races a holder that may finish first.
// The reservation is released if the stream's connection fails before it is used.
//
// The response delay is the stream's round trip on the simulator, and the PING-measured one
// (queues included) on the testbed, as for MP-H2. cats5's transport, sizing and tail rules are
// unchanged; the frozen files are untouched.

/** Diagnostic (cats6-fine): no block larger than an even share of the file per connection, so a
 * small file still gives every connection a block; cats5's 1 MiB minimum left some idle. */
const FINE_FLOOR = 128 * 1024

export function cats6(
  name: string,
  scenario: Scenario,
  fine = false
): { scheduler: Scheduler; state: BaselineState } {
  return pipelined(name, algorithm('cats5', scenario).scheduler, fine)
}

/** `inner` with its next block pipelined, as above (cats6 on cats5, cats7 and cats8 on their own
 * CATS). With `endgame` false (cats8), nothing is pipelined once no new block can be cut: the
 * last blocks stay in reach of every idle connection. On the testbed a block reserved for a
 * pipelined request waited 1.4 s behind its owner's stalled block while 15 connections idled. */
export function pipelined(
  name: string,
  inner: Scheduler,
  fine = false,
  endgame = true,
  /** cats8: time the pre-pick by the path's base round trip, not the measured response delay. */
  baseLead = false
): { scheduler: Scheduler; state: BaselineState } {
  const state = newState(pipeline)

  /** Runs one of the inner scheduler's picks with the blocks promised to pipelined requests out of reach. */
  const hidden = (sim: Sim, stream: Stream): Work | undefined => {
    const held: Block[] = []
    for (const block of state.reserved) {
      if (block.status !== 'pending') continue
      block.status = 'downloading'
      held.push(block)
    }
    try {
      return inner.pick(sim, stream)
    } finally {
      for (const block of held) block.status = 'pending'
    }
  }

  function pipeline(sim: Sim, st: BaselineState): void {
    for (const [stream, next] of st.pipelined) {
      if (stream.status !== 'retrying') continue
      st.pipelined.delete(stream)
      st.reserved.delete(next.block)
    }
    for (const stream of sim.streams) {
      const attempt = stream.attempt
      if (!attempt || attempt.startupLeft > 0 || st.pipelined.has(stream) || stream.speed <= 0) continue
      const left = sim.blockLength(attempt.block) - sim.position(attempt)
      const lead = baseLead ? stream.net.rtt : responseDelay(st, stream)
      if (left / stream.speed > lead + sim.dt) continue
      if (!endgame && sim.frontier >= sim.fileBytes) continue
      const work = hidden(sim, stream)
      if (!work || work.kind !== 'primary') continue
      // The pick cut the last block: leave it to whoever is free first.
      if (!endgame && sim.frontier >= sim.fileBytes) continue
      st.reserved.add(work.block)
      st.pipelined.set(stream, { block: work.block, requestedAt: sim.t })
      prefetch(sim, stream, work.block)
    }
  }

  const scheduler: Scheduler = {
    name,
    transport: inner.transport,
    init(sim) {
      inner.init(sim)
      if (!fine) return
      const cap = Math.max(FINE_FLOOR, Math.ceil(sim.fileBytes / sim.streams.length))
      const carve = sim.carve.bind(sim)
      sim.carve = (bytes: number) => carve(Math.min(bytes, cap))
    },
    pick(sim, stream) {
      const next = pipelinedPick(state, stream)
      if (next) return { kind: 'primary', block: next }
      return hidden(sim, stream)
    }
  }
  return { scheduler, state }
}
