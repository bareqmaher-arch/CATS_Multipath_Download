import type { Scheduler } from './sim.ts'
import { pipelined } from './cats6.ts'
import { CATS7, NO_SCALING, scaledCats, type TailScaling } from './cats7.ts'
import type { BaselineState } from './baselines/mph2.ts'

// cats8 = cats6 with its pipelined pick timed by the path's base round trip.
//
// On the testbed cats6 (and cats7) were 1-3% slower than cats5 for 200 MB (REPORT.md, section
// 6d), all of it in the last 2% of the download: up to 98% the two delivered byte for byte the
// same (traced tick by tick, src/real/trace-real.ts, development seeds 690x). At the end a slow
// LTE connection had pipelined one of the last 1 MiB blocks and finished it alone while the
// others idled. The cause is when the pre-pick runs: one measured response delay before a
// block ends, and on the testbed that delay is a PING that waits behind the link's queue, far
// longer on a slow, queued LTE link than on Wi-Fi. So the slow connections picked earliest and
// took the last blocks. cats8 pre-picks one base round trip ahead instead, the time the request
// needs to reach the server and the first bytes to come back on an otherwise idle path; the
// queue ahead of them keeps the link busy meanwhile. On the simulator, which has no queues, the
// two are the same and cats8 is cats6.
//
// Tried on the testbed's development seeds and left out:
// - cats7's tail (short tail sub-ranges and smaller splits): nothing gained over cats6 there,
//   10-30% lost on three networks at RTT x4;
// - keeping new connections out of the tail while their network is busy (warmTakers) and pricing
//   a taker at its share of its network (sharedRate): fewer connections than cats7, same loss;
// - offering a late reservation to the others, cancelling its pipelined request: 4-10% more
//   bytes and slower everywhere;
// - no pipelining once the file is all cut (endgame off): halved the 200 MB loss, halved the
//   small-file gain too;
// - judging a holder silent from when its block last moved forward (progressSilence,
//   src/progress.ts), after one HTTP/2 stream was seen held up for 2 s while the pipelined
//   request's bytes kept its connection busy: no measurable change on top of the base lead.

export interface Cats8Options {
  scaling: TailScaling
  /** Pipeline even once no new block can be cut (cats6, cats7). */
  endgame: boolean
  /** Time the pre-pick by the base round trip, not the measured response delay. */
  baseLead: boolean
}

export const CATS8: Cats8Options = {
  scaling: NO_SCALING,
  endgame: true,
  baseLead: true
}

export function cats8(name: string, options: Cats8Options = CATS8): { scheduler: Scheduler; state: BaselineState } {
  return pipelined(name, scaledCats(name, options.scaling), false, options.endgame, options.baseLead)
}

/** cats8-<letters>, for development: b (base-RTT lead), n (no endgame pipelining), p (progress silence), t (cats7's
 * tail), w (warm takers), r (rate shared); x = none, which is cats6. */
export function cats8Parts(letters: string): Cats8Options {
  const has = (c: string) => letters.includes(c)
  const base = has('t') ? CATS7 : NO_SCALING
  return {
    scaling: { ...base, progressSilence: has('p'), warmTakers: has('w'), sharedRate: has('r') },
    endgame: !has('n'),
    baseLead: has('b')
  }
}
