import type { Attempt, Sim } from './sim.ts'

// When each attempt last moved its block forward, for cats8. The engine's lastByteAt marks the
// last byte on the attempt's connection; on the testbed, with a pipelined request on the same
// connection, those bytes can all be the next block's while this block's last sub-range is held
// up (traced for 2 s on an LTE link), so a stalled holder looked alive. On the simulator the two
// are the same.

const watched = new WeakMap<Sim, WeakMap<Attempt, { position: number; at: number }>>()

/** Records progress after every engine step. Idempotent. */
export function watchProgress(sim: Sim): void {
  if (watched.has(sim)) return
  const seen = new WeakMap<Attempt, { position: number; at: number }>()
  watched.set(sim, seen)
  const transfer = sim.transfer.bind(sim)
  sim.transfer = ((...args: Parameters<Sim['transfer']>) => {
    transfer(...args)
    for (const attempt of sim.live) {
      const position = sim.position(attempt)
      const last = seen.get(attempt)
      if (!last || position > last.position) seen.set(attempt, { position, at: sim.t })
    }
  }) as Sim['transfer']
}

/** When the attempt last moved its block forward (its start if never), or lastByteAt if unwatched. */
export function lastProgressAt(sim: Sim, attempt: Attempt): number {
  const last = watched.get(sim)?.get(attempt)
  return last ? Math.min(last.at, attempt.lastByteAt) : attempt.lastByteAt
}
