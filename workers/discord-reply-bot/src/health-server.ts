import { createServer } from 'node:http'

export function startHealthServer(port: number, getStatus: () => object): void {
  const server = createServer((_req, res) => {
    const body = JSON.stringify(getStatus())
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(body)
  })
  server.listen(port, () => {
    console.log(`[discord-reply-bot] health on :${port}`)
  })
}
