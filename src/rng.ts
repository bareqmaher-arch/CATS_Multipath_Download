// Seeded randomness. Every random draw in a run comes from a generator seeded by (seed, purpose),
// so the network a run sees depends only on its seed, never on the scheduler under test.

/** Mixes integers into one 32-bit seed (murmur3 finalizer per part). */
export function mixSeed(...parts: number[]): number {
  let h = 0x9e3779b9
  for (const part of parts) {
    h = Math.imul(h ^ (part >>> 0), 0x85ebca6b)
    h ^= h >>> 13
    h = Math.imul(h, 0xc2b2ae35)
    h ^= h >>> 16
  }
  return h >>> 0
}

export class Rng {
  state: number
  spare: number | null = null

  constructor(seed: number) {
    this.state = seed >>> 0
  }

  /** Uniform in [0, 1) (mulberry32). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  uniform(min: number, max: number): number {
    return min + (max - min) * this.next()
  }

  /** Standard normal (Box-Muller, caching the second value). */
  normal(): number {
    if (this.spare !== null) {
      const value = this.spare
      this.spare = null
      return value
    }
    const u = 1 - this.next()
    const v = this.next()
    const radius = Math.sqrt(-2 * Math.log(u))
    this.spare = radius * Math.sin(2 * Math.PI * v)
    return radius * Math.cos(2 * Math.PI * v)
  }

  exponential(mean: number): number {
    return -mean * Math.log(1 - this.next())
  }
}
