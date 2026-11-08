import type { Block, Scheduler, Stream } from '../sim.ts'
import { SINGLE_REQUEST } from '../sim.ts'

// MDTP (Abdollah, Partridge, Shannigrahi, ICCCN 2025), its chunk sizing with paths in place of
// the paper's servers:
//
// - Every source first fetches a uniform initial chunk C. Throughput is a chunk's size over its
//   download time.
// - Then each source loops on its own, fetching as soon as it is free: a source is fast if its
//   throughput is at or above the geometric mean of all sources' throughputs, GM = (prod th_i)^(1/N);
//   a fast source fetches a large chunk L, and then every source fetches a small chunk
//   C_i = T * th_i with T = C / th_fastest (the text's equation; Algorithm 1 writes L there,
//   which would make every small chunk of the fastest source a large one), th_fastest the
//   highest throughput among the fast sources. One request per chunk, one connection per
//   source, no copies, and nothing special at the end of the file.
//
// Not in the paper, so chosen here: its sizes (C = 4 MB, L = 40 MB) are for files of 1-8 GB,
// where C is 1/256 of a 1 GB file and L is 10 C; here C keeps that ratio to the file, but no less
// than 1 MiB (Follower-Leader's normal chunk and CATS's smallest block), and L = 10 C as in both
// of the paper's settings; the small chunk is at least 1 KiB (the paper sets no minimum, and
// T * th_i of a near-dead source would be nothing); a chunk orphaned by a failed connection goes
// to the next source that asks. "mdtp" is one connection per path; "mdtp-eq" treats each of the
// scenario's connections as a source.

const MIN_INITIAL = 1024 * 1024
const MIN_SMALL = 1024

export function mdtp(name: string): Scheduler {
  const throughput = new Map<Stream, number>()
  const holding = new Map<Stream, Block>()
  const largeNext = new Map<Stream, boolean>()
  let initial = MIN_INITIAL

  return {
    name,
    transport: SINGLE_REQUEST,
    init(sim) {
      initial = Math.max(MIN_INITIAL, Math.round(sim.fileBytes / 256))
    },
    pick(sim, stream) {
      const held = holding.get(stream)
      holding.delete(stream)
      if (held?.status === 'completed') throughput.set(stream, stream.lastBlockSpeed)
      const take = (block: Block) => {
        holding.set(stream, block)
        return { kind: 'primary' as const, block }
      }
      const orphan = sim.blocks.find((b) => b.status === 'pending')
      if (orphan) return take(orphan)
      if (sim.frontier >= sim.fileBytes) return undefined

      const own = throughput.get(stream) ?? 0
      if (own <= 0) return take(sim.carve(initial))
      const measured = [...throughput.values()].filter((v) => v > 0)
      // The highest throughput is always at or above the geometric mean, so it is the fastest
      // fast source; exp(log(x)) can come out a hair above x, hence the tolerance.
      const gm = Math.exp(measured.reduce((sum, v) => sum + Math.log(v), 0) / measured.length)
      const fastest = Math.max(...measured)
      const fast = own >= gm * (1 - 1e-9)
      if (fast && (largeNext.get(stream) ?? true)) {
        largeNext.set(stream, false)
        return take(sim.carve(10 * initial))
      }
      largeNext.set(stream, true)
      return take(sim.carve(Math.max(MIN_SMALL, Math.round((initial / fastest) * own))))
    }
  }
}
