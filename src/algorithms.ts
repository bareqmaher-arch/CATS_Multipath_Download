import type { Scenario } from './network.ts'
import { cats, plexo } from './schedulers.ts'
import { SUBRANGES_V1, SUBRANGES_V2, SUBRANGES_V3, type Scheduler } from './sim.ts'

// Algorithm names as they appear in the results, and what each runs.
//
//   plexo          Plexo as shipped: planDownload blocks, pickWork hedging
//   plexo-free     the same, on the free (unmetered) networks only
//   cats           factoring + split/hedge tail, cost ignored
//   cats2          cats, with slow start priced into the taker's request
//   cats3          cats2, fetching blocks as sub-ranges on one connection (SUBRANGES_V1)
//   cats4          cats2 on SUBRANGES_V2: adaptive sub-ranges, BDP lead, crawlers dropped
//   cats5          cats2 on SUBRANGES_V3: sub-ranges sized by time at the stream's speed
//   cats4-fixedSize  diagnostic: cats4 with 512 KiB sub-ranges
//   plexo-mux      Plexo's decisions on cats3's sub-range transport
//   plexo-mux2     Plexo's decisions on cats4's sub-range transport
//   plexo-mux3     Plexo's decisions on cats5's sub-range transport
//   cats-noSplit   factoring, but Plexo's hedging in the tail
//   cats-noFactor  Plexo's fixed blocks, but the CATS tail
//   cats-l<x>      full CATS with lambda = x seconds per metered MB ("inf" = never metered)

export interface Algorithm {
  scheduler: Scheduler
  networkIds?: string[]
}

export function algorithm(name: string, scenario: Scenario): Algorithm {
  if (name === 'plexo') return { scheduler: plexo() }
  if (name === 'plexo-free') {
    return {
      scheduler: plexo(name),
      networkIds: scenario.networks.filter((n) => !n.metered).map((n) => n.id)
    }
  }
  if (name === 'cats') return { scheduler: cats({ name, factoring: true, tail: 'cats', lambdaSecPerMB: 0 }) }
  if (name === 'cats2') {
    return {
      scheduler: cats({ name, factoring: true, tail: 'cats', lambdaSecPerMB: 0, rampAware: true })
    }
  }
  if (name === 'cats3') {
    return {
      scheduler: cats({
        name,
        factoring: true,
        tail: 'cats',
        lambdaSecPerMB: 0,
        rampAware: true,
        transport: SUBRANGES_V1
      })
    }
  }
  if (name === 'cats4') {
    return {
      scheduler: cats({
        name,
        factoring: true,
        tail: 'cats',
        lambdaSecPerMB: 0,
        rampAware: true,
        transport: SUBRANGES_V2
      })
    }
  }
  if (name === 'cats4-fixedSize') {
    // Diagnostic: cats4 with 512 KiB sub-ranges, to tell its sizing apart from its other fixes.
    return {
      scheduler: cats({
        name,
        factoring: true,
        tail: 'cats',
        lambdaSecPerMB: 0,
        rampAware: true,
        transport: { ...SUBRANGES_V2, sizing: 'fixed' }
      })
    }
  }
  if (name === 'cats5') {
    return {
      scheduler: cats({
        name,
        factoring: true,
        tail: 'cats',
        lambdaSecPerMB: 0,
        rampAware: true,
        transport: SUBRANGES_V3
      })
    }
  }
  if (name === 'plexo-mux3') return { scheduler: plexo(name, SUBRANGES_V3) }
  if (name === 'plexo-mux') return { scheduler: plexo(name, SUBRANGES_V1) }
  if (name === 'plexo-mux2') return { scheduler: plexo(name, SUBRANGES_V2) }
  if (name === 'cats-noSplit') {
    return { scheduler: cats({ name, factoring: true, tail: 'plexo', lambdaSecPerMB: 0 }) }
  }
  if (name === 'cats-noFactor') {
    return { scheduler: cats({ name, factoring: false, tail: 'cats', lambdaSecPerMB: 0 }) }
  }
  const priced = /^cats-l(.+)$/.exec(name)
  if (priced) {
    const lambda = priced[1] === 'inf' ? Infinity : Number(priced[1])
    return { scheduler: cats({ name, factoring: true, tail: 'cats', lambdaSecPerMB: lambda }) }
  }
  throw new Error(`Unknown algorithm ${name}`)
}
