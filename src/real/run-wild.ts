import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import { resolve } from '../baselines/resolve.ts'
import { MB, type Scenario } from '../network.ts'
import { mixSeed, Rng } from '../rng.ts'
import { scenario } from '../scenarios.ts'
import { RealEngine } from './engine.ts'

// Paired runs over real networks: this machine's Wi-Fi and a phone's cellular link, each bound
// to its own local address, downloading from one server on the internet (wild/server-setup.sh).
// Nothing is shaped or replayed: in each round every algorithm downloads the same file once, in an
// order shuffled per round, back to back, so the algorithms of a round meet about the same
// networks. Before each round the base RTT of each network is measured (fastest of five TCP
// handshakes) and given to the schedulers as the path's RTT, as the testbed gives the scenario's.
// Rows are appended as they finish; rows already in the file are skipped on a rerun. The run
// stops before a round would take the cellular bytes received past the cap.
//
// Usage: node --experimental-strip-types src/real/run-wild.ts <out.csv> <server> <prefix>
//        <sizesMB> <rounds> <algorithms> wifi=<local IP> lte=<local IP> [h1=18080 h2=18081] [capGB] [firstRound]
// Without the two addresses it lists this machine's IPv4 addresses and checks nothing else.

const [outPath, server, prefix, sizeList, roundsArg, algorithmList, ...rest] = process.argv.slice(2)
const named = Object.fromEntries(rest.filter((a) => a.includes('=')).map((a) => a.split('=') as [string, string]))
const plain = rest.filter((a) => !a.includes('='))
const capBytes = Number(plain[0] ?? 9) * 1e9
const firstRound = Number(plain[1] ?? 1)

const COLUMNS = [
  'round', 'sizeMB', 'algorithm', 'order', 'startedAt', 'completionS', 'rttWifiMs', 'rttLteMs',
  'appMB', 'wifiMB', 'lteMB', 'requests', 'connections', 'splits', 'hedges', 'refreshes',
  'failures', 'meanTickMs', 'errors', 'timedOut'
]
const H1_PORT = Number(named.h1 ?? 18080)
const H2_PORT = Number(named.h2 ?? 18081)
const PAUSE_MS = 2000

async function main(): Promise<void> {
  if (!named.wifi || !named.lte) {
    const { networkInterfaces } = await import('node:os')
    for (const [name, addresses] of Object.entries(networkInterfaces())) {
      for (const a of addresses ?? []) if (a.family === 'IPv4' && !a.internal) console.log(`${name}: ${a.address}`)
    }
    console.log('pass wifi=<address> lte=<address> from the list above')
    return
  }
  const local = { wifi: named.wifi, lte: named.lte }

  // Each network must leave by its own interface: the server sees two different public addresses.
  const seen = { wifi: await publicAddress(local.wifi), lte: await publicAddress(local.lte) }
  console.log(`public addresses: wifi ${seen.wifi}, lte ${seen.lte}`)
  if (seen.wifi === seen.lte) throw new Error('both networks reach the server from one address: binding is not working')

  const done = new Set<string>()
  let cellularBytes = 0
  if (existsSync(outPath)) {
    const [header, ...lines] = readFileSync(outPath, 'utf8').trim().split('\n')
    const columns = header.split(',')
    for (const line of lines) {
      const cells = line.split(',')
      done.add(cells.slice(0, 3).join(','))
      cellularBytes += Number(cells[columns.indexOf('lteMB')]) * MB
    }
  } else {
    writeFileSync(outPath, COLUMNS.join(',') + '\n')
  }

  const names = algorithmList.split(',')
  const sizes = sizeList.split(',').map(Number)
  const template = scenario('S1-stable')
  for (let round = firstRound; round < firstRound + Number(roundsArg); round++) {
    for (const sizeMB of sizes) {
      const todo = names.filter((name) => !done.has([round, sizeMB, name].join(',')))
      if (!todo.length) continue
      // Assume the worst for the cap: every byte of the round over the cellular link.
      if (cellularBytes + todo.length * sizeMB * MB * 1.15 > capBytes) {
        console.log(`stopping: cellular ${(cellularBytes / 1e9).toFixed(2)} GB of ${capBytes / 1e9} GB`)
        return
      }
      const rtt = { wifi: await baseRtt(local.wifi), lte: await baseRtt(local.lte) }
      const s: Scenario = {
        ...template,
        id: 'wild',
        networks: [
          { ...template.networks[0], id: 'wifi', rttMs: rtt.wifi },
          { ...template.networks[1], id: 'lte', rttMs: rtt.lte }
        ]
      }
      const endpoints = {
        wifi: { host: server, localAddress: local.wifi },
        lte: { host: server, localAddress: local.lte }
      }
      const order = [...todo]
      const rng = new Rng(mixSeed(round * 1000 + sizeMB, 0x5eed))
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rng.next() * (i + 1))
        ;[order[i], order[j]] = [order[j], order[i]]
      }
      for (const [position, name] of order.entries()) {
        await sleep(PAUSE_MS)
        const resolved = resolve(name, s)
        const engine = new RealEngine({
          scenario: resolved.scenario,
          fileBytes: sizeMB * MB,
          seed: round,
          scheduler: resolved.scheduler,
          networkIds: resolved.networkIds,
          tcp: 'slowstart',
          maxTime: 300,
          endpoints,
          path: `/${prefix}/f${sizeMB}.bin`,
          h1Port: H1_PORT,
          h2Port: H2_PORT
        })
        resolved.attach?.(engine)
        const startedAt = new Date().toISOString()
        const r = await engine.runReal()
        cellularBytes += r.appBytesByNet.lte ?? 0
        const errors = Object.entries(r.errors).map(([k, v]) => `${k}x${v}`).join(' ')
        appendFileSync(
          outPath,
          [
            round, sizeMB, name, position, startedAt, r.completionS.toFixed(3), rtt.wifi.toFixed(1),
            rtt.lte.toFixed(1), (r.appBytes / MB).toFixed(3), ((r.appBytesByNet.wifi ?? 0) / MB).toFixed(3),
            ((r.appBytesByNet.lte ?? 0) / MB).toFixed(3), r.requests, r.connections, r.splits, r.hedges,
            r.refreshes, r.failures, r.meanTickMs.toFixed(2), errors, r.timedOut ? 1 : 0
          ].join(',') + '\n'
        )
        console.log(
          `round ${round} ${sizeMB} MB ${name}: ${r.completionS.toFixed(2)} s, rtt ${rtt.wifi.toFixed(0)}/${rtt.lte.toFixed(0)} ms, ` +
            `lte ${((r.appBytesByNet.lte ?? 0) / MB).toFixed(1)} MB, tick ${r.meanTickMs.toFixed(1)} ms` +
            `${errors ? `, errors ${errors}` : ''}${r.timedOut ? ' TIMED OUT' : ''}; cellular so far ${(cellularBytes / 1e9).toFixed(2)} GB`
        )
      }
    }
  }
}

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

/** Fastest of five TCP handshakes to the server from this local address, ms. */
async function baseRtt(localAddress: string): Promise<number> {
  let best = Infinity
  for (let i = 0; i < 5; i++) {
    best = Math.min(best, await new Promise<number>((done, fail) => {
      const started = performance.now()
      const socket = net.connect({ host: server, port: H1_PORT, localAddress }, () => {
        done(performance.now() - started)
        socket.destroy()
      })
      socket.setTimeout(5000, () => {
        socket.destroy()
        fail(new Error(`no handshake from ${localAddress} in 5 s`))
      })
      socket.on('error', fail)
    }))
    await sleep(100)
  }
  return best
}

/** The address the server sees for requests from this local address. */
function publicAddress(localAddress: string): Promise<string> {
  return new Promise((done, fail) => {
    const req = http.get({ host: server, port: H1_PORT, path: `/${prefix}/ip`, localAddress, agent: false }, (res) => {
      let body = ''
      res.on('data', (chunk) => (body += chunk))
      res.on('end', () => (res.statusCode === 200 ? done(body.trim()) : fail(new Error(`HTTP ${res.statusCode}`))))
    })
    req.setTimeout(10000, () => req.destroy(new Error(`no answer from ${localAddress} in 10 s`)))
    req.on('error', fail)
  })
}

await main()
