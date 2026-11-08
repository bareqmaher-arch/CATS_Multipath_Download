import type { ConnectionSpec, NetworkSpec, Scenario } from './network.ts'

// The network situations the schedulers are compared on. Rates in MB/s (1 MB = 10^6 bytes).
// Cellular is always marked metered; that only matters to a scheduler given a price for it.

function wifi(baseMBps: number, extra: Partial<NetworkSpec> = {}): NetworkSpec {
  return {
    id: 'wifi',
    baseMBps,
    rttMs: 20,
    metered: false,
    sigma: 0.15,
    corrSec: 5,
    fadeRate: 0.002,
    fadeLevel: 0.3,
    fadeMeanSec: 2,
    outageRate: 0,
    outageMeanSec: 1,
    ...extra
  }
}

function cellular(id: string, baseMBps: number, extra: Partial<NetworkSpec> = {}): NetworkSpec {
  return {
    id,
    baseMBps,
    rttMs: 50,
    metered: true,
    sigma: 0.35,
    corrSec: 3,
    fadeRate: 0.02,
    fadeLevel: 0.2,
    fadeMeanSec: 3,
    outageRate: 0.002,
    outageMeanSec: 3,
    ...extra
  }
}

const CONNECTIONS: ConnectionSpec = {
  serverCapMBps: null,
  badConnProb: 0.03,
  stallRate: 0.005,
  stallMeanSec: 3,
  stallPermanentProb: 0.1
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'S0-single',
    label: 'One stable network (sanity check)',
    networks: [wifi(10, { sigma: 0.05, fadeRate: 0 })],
    connection: { ...CONNECTIONS, badConnProb: 0.01, stallRate: 0.001 },
    streamsPerNetwork: 8
  },
  {
    id: 'S1-stable',
    label: 'Wi-Fi 8 + 4G 4, steady',
    networks: [wifi(8), cellular('lte', 4)],
    connection: CONNECTIONS,
    streamsPerNetwork: 8
  },
  {
    id: 'S2-hetero',
    label: 'Wi-Fi 12 + 4G 2, volatile 4G',
    networks: [wifi(12), cellular('lte', 2, { sigma: 0.6, fadeRate: 0.05 })],
    connection: CONNECTIONS,
    streamsPerNetwork: 8
  },
  {
    id: 'S3-flaky',
    label: 'Slow Wi-Fi 3 + flaky 4G 2.5 with outages',
    networks: [
      wifi(3, { rttMs: 40, sigma: 0.3, fadeRate: 0.01 }),
      cellular('lte', 2.5, { rttMs: 90, sigma: 0.6, fadeRate: 0.04, outageRate: 0.01, outageMeanSec: 4 })
    ],
    connection: CONNECTIONS,
    streamsPerNetwork: 8
  },
  {
    id: 'S4-stragglers',
    label: 'Wi-Fi 8 + 4G 4, many bad and stalling connections',
    networks: [wifi(8), cellular('lte', 4)],
    connection: { ...CONNECTIONS, badConnProb: 0.15, stallRate: 0.03, stallMeanSec: 4, stallPermanentProb: 0.2 },
    streamsPerNetwork: 8
  },
  {
    id: 'S5-capped',
    label: 'Wi-Fi 15 + 4G 8, server caps each connection at 0.8',
    networks: [wifi(15), cellular('lte', 8)],
    connection: { ...CONNECTIONS, serverCapMBps: 0.8 },
    streamsPerNetwork: 8
  },
  {
    id: 'S6-three',
    label: 'Wi-Fi 6 + two 4G carriers 3 and 2',
    networks: [wifi(6), cellular('lte', 3), cellular('lte2', 2, { rttMs: 70 })],
    connection: CONNECTIONS,
    streamsPerNetwork: 8
  },
  {
    id: 'S7-far',
    label: 'Far server: RTT 250/300 ms, 1 MB/s per connection',
    networks: [wifi(8, { rttMs: 250 }), cellular('lte', 4, { rttMs: 300 })],
    connection: { ...CONNECTIONS, serverCapMBps: 1 },
    streamsPerNetwork: 8
  }
]

export function scenario(id: string): Scenario {
  const found = SCENARIOS.find((s) => s.id === id)
  if (!found) throw new Error(`No scenario ${id}`)
  return found
}
