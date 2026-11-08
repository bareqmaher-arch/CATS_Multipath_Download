import { mixSeed, Rng } from './rng.ts'

// What the networks and the server do, independent of any scheduler.
//
// A network's capacity is a log-normal AR(1) process (slow drift and jitter) times a Markov
// state: good, fading (deep but partial loss) or out. It is sampled on a 100 ms grid from its own
// generator, so for a given seed every scheduler sees exactly the same capacity over time.
//
// Streams on a network share its capacity max-min fairly, each up to its connection's own ceiling.
// A connection's ceiling is q x (the server's per-connection cap, or the whole link without one):
// most connections get q near 1; a few land on a bad route or CDN node and crawl at q of 0.3-3%.
// While transferring, a connection may stall (deliver nothing) for an exponential time, or for
// good until the client gives up on it.

export const MB = 1e6
export const MIB = 1024 * 1024
export const GRID_S = 0.1

export interface NetworkSpec {
  id: string
  baseMBps: number
  rttMs: number
  metered: boolean
  /** Log-normal volatility of capacity. */
  sigma: number
  /** Correlation time of that volatility, seconds. */
  corrSec: number
  /** good -> fading, per second. */
  fadeRate: number
  /** Capacity while fading, as a fraction of normal. */
  fadeLevel: number
  fadeMeanSec: number
  /** good -> out, per second. */
  outageRate: number
  outageMeanSec: number
}

export interface ConnectionSpec {
  /** Per-connection server cap, MB/s; null when one connection can fill the link. */
  serverCapMBps: number | null
  /** Chance a new connection lands somewhere bad and crawls. */
  badConnProb: number
  /** Stalls per second of transfer. */
  stallRate: number
  stallMeanSec: number
  /** Chance a stall never ends. */
  stallPermanentProb: number
}

export interface Scenario {
  id: string
  label: string
  networks: NetworkSpec[]
  connection: ConnectionSpec
  streamsPerNetwork: number
}

export class CapacityTrace {
  spec: NetworkSpec
  rng: Rng
  values: number[] = []
  drift = 0
  state: 'good' | 'fade' | 'out' = 'good'

  constructor(spec: NetworkSpec, seed: number, networkIndex: number) {
    this.spec = spec
    this.rng = new Rng(mixSeed(seed, networkIndex, 0xcafe))
  }

  /** Capacity in bytes/s at time t. */
  at(t: number): number {
    const index = Math.floor(t / GRID_S)
    while (this.values.length <= index) this.extend()
    return this.values[index]
  }

  extend(): void {
    const { spec, rng } = this
    const rho = Math.exp(-GRID_S / spec.corrSec)
    this.drift = rho * this.drift + spec.sigma * Math.sqrt(1 - rho * rho) * rng.normal()

    const u = rng.next()
    if (this.state === 'good') {
      if (u < spec.outageRate * GRID_S) this.state = 'out'
      else if (u < (spec.outageRate + spec.fadeRate) * GRID_S) this.state = 'fade'
    } else if (this.state === 'fade') {
      if (u < GRID_S / spec.fadeMeanSec) this.state = 'good'
    } else if (u < GRID_S / spec.outageMeanSec) {
      this.state = 'good'
    }

    const level = this.state === 'good' ? 1 : this.state === 'fade' ? spec.fadeLevel : 0
    // exp(x - sigma^2/2) keeps the long-run mean at baseMBps.
    const factor = Math.exp(this.drift - (spec.sigma * spec.sigma) / 2)
    this.values.push(spec.baseMBps * MB * factor * level)
  }
}

/** A new connection's quality: its share of the per-connection ceiling, in (0, 1]. */
export function drawConnectionQuality(rng: Rng, spec: ConnectionSpec): number {
  // 0.3-3% of the link: some slow enough for Plexo's crawl check (10% of its siblings), some not.
  if (rng.next() < spec.badConnProb) return rng.uniform(0.003, 0.03)
  return Math.min(1, Math.exp(0.25 * rng.normal()))
}

/** Max-min fair split of `capacity` between demands capped at `caps`. Writes into `out`. */
export function waterfill(capacity: number, caps: number[], out: number[]): void {
  const order = caps.map((_, index) => index).sort((a, b) => caps[a] - caps[b])
  let left = capacity
  for (let rank = 0; rank < order.length; rank++) {
    const index = order[rank]
    const share = left / (order.length - rank)
    const given = Math.max(0, Math.min(caps[index], share))
    out[index] = given
    left -= given
  }
}
