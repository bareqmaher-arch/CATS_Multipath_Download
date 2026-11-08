import type { Block, Scheduler, Sim, Stream } from '../sim.ts'
import { SINGLE_REQUEST } from '../sim.ts'

// Follower-Leader chunk retrieval (Salkintzis, ICC Workshops 2025), as described in the paper:
//
// - The content is fetched as a sequence of byte-range chunks, one request at a time on each
//   interface; both interfaces start with a chunk of the normal size.
// - At every chunk retrieval instance t_x on an interface X, the leader is the interface that
//   has received the most chunks, the follower the one with the fewest. On the leader the next
//   chunk is norm_chunk_size; on the follower it is
//     max(min_chunk_size, min(2 * norm_chunk_size, floor(T_f (t_r - t_x) + norm_chunk_size * T_f / T_l)))
//   with T_f, T_l the measured throughputs of follower and leader (measured after each chunk)
//   and t_r, t_x the times the last chunk was retrieved on leader and follower. The follower's
//   chunk then ends about when the leader's next one does.
// - Values from the paper's evaluation: normal chunk 1 MB, minimum 1 KB, maximum 2 MB.
// - Nothing special at the end of the file: no copies, no re-splitting.
//
// Not in the paper, so chosen here: with more than two interfaces every one that is not the
// leader is a follower of the leader; a tie in chunks received makes an interface a leader (the
// paper's start, where both take the normal size); throughput is the last chunk's size over its
// retrieval time, request to last byte; a chunk orphaned by a failed connection goes to the next
// interface that asks. "fl" is the paper's design, one connection per interface; "fl-eq" treats
// each of the scenario's connections as an interface.

const NORM_CHUNK = 1024 * 1024
const MIN_CHUNK = 1024
const MAX_CHUNK = 2 * NORM_CHUNK

export function followerLeader(name: string): Scheduler {
  const chunks = new Map<Stream, number>()
  const lastAt = new Map<Stream, number>()
  const throughput = new Map<Stream, number>()
  const holding = new Map<Stream, Block>()

  return {
    name,
    transport: SINGLE_REQUEST,
    init() {},
    pick(sim, stream) {
      const held = holding.get(stream)
      holding.delete(stream)
      if (held?.status === 'completed') {
        chunks.set(stream, (chunks.get(stream) ?? 0) + 1)
        lastAt.set(stream, sim.t)
        throughput.set(stream, stream.lastBlockSpeed)
      }
      const take = (block: Block) => {
        holding.set(stream, block)
        return { kind: 'primary' as const, block }
      }
      const orphan = sim.blocks.find((b) => b.status === 'pending')
      if (orphan) return take(orphan)
      if (sim.frontier >= sim.fileBytes) return undefined
      return take(sim.carve(chunkSize(sim, stream, chunks, lastAt, throughput)))
    }
  }
}

function chunkSize(
  sim: Sim,
  stream: Stream,
  chunks: Map<Stream, number>,
  lastAt: Map<Stream, number>,
  throughput: Map<Stream, number>
): number {
  let leader: Stream | undefined
  for (const s of sim.streams) {
    const n = chunks.get(s) ?? 0
    const best = leader ? (chunks.get(leader) ?? 0) : -1
    if (n > best || (n === best && (throughput.get(s) ?? 0) > (throughput.get(leader!) ?? 0))) leader = s
  }
  if (!leader || (chunks.get(stream) ?? 0) >= (chunks.get(leader) ?? 0)) return NORM_CHUNK
  const tf = throughput.get(stream) ?? 0
  const tl = throughput.get(leader) ?? 0
  if (tf <= 0 || tl <= 0) return NORM_CHUNK
  const tr = lastAt.get(leader) ?? 0
  const tx = sim.t
  const size = Math.floor(tf * (tr - tx) + (NORM_CHUNK * tf) / tl)
  return Math.max(MIN_CHUNK, Math.min(MAX_CHUNK, size))
}
