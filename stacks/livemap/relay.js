// The game server sends to 8080, which stays inside stack_network; pages read from 8081, the published port,
// so nothing outside the swarm can send positions.
let last = null

const upgrade = (req, server) => (server.upgrade(req) ? undefined : new Response('websocket only', { status: 426 }))

const pages = Bun.serve({
  port: 8081,
  fetch: upgrade,
  websocket: {
    backpressureLimit: 1024 * 1024,
    closeOnBackpressureLimit: true,
    open(ws) {
      ws.subscribe('live')
      if (last) ws.send(last)
    },
    message() {},
  },
})

Bun.serve({
  port: 8080,
  fetch: upgrade,
  websocket: {
    message(ws, message) {
      last = message
      pages.publish('live', message)
    },
    close() {
      last = null
    },
  },
})
