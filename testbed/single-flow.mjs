// How fast does one connection fetch 200 MB over a fixed 80 Mbit/s, 20 ms path, over HTTP/1.1
// and over HTTP/2 with the client's window settings? Tells a single-connection design's
// handicap from TCP apart from one our HTTP/2 client or nginx's HTTP/2 would add.
// Run in the client namespace after testbed/setup.sh, with the path shaped by hand.
import http from 'node:http'
import http2 from 'node:http2'
import net from 'node:net'

const host = '10.1.0.1'
const localAddress = '10.1.0.2'
const path = '/f200.bin'

function h1() {
  return new Promise((resolve) => {
    const started = performance.now()
    let bytes = 0
    http.get({ host, port: 8080, path, localAddress }, (res) => {
      res.on('data', (c) => (bytes += c.length))
      res.on('end', () => resolve({ bytes, s: (performance.now() - started) / 1000 }))
    })
  })
}

function h2() {
  return new Promise((resolve) => {
    const started = performance.now()
    let bytes = 0
    const session = http2.connect(`http://${host}:8081`, {
      createConnection: () => net.connect({ host, port: 8081, localAddress }),
      settings: { initialWindowSize: 64 * 1024 * 1024 - 1 }
    })
    session.on('connect', () => session.setLocalWindowSize(64 * 1024 * 1024))
    const stream = session.request({ ':path': path })
    stream.on('data', (c) => (bytes += c.length))
    stream.on('end', () => {
      session.close()
      resolve({ bytes, s: (performance.now() - started) / 1000 })
    })
  })
}

for (const [name, run] of [['http1', h1], ['http2', h2], ['http1', h1], ['http2', h2]]) {
  const r = await run()
  console.log(`${name}: ${r.s.toFixed(2)} s, ${((r.bytes / r.s) / 1e6).toFixed(2)} MB/s of 10`)
}
