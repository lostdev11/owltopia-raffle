import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Client } from 'discord.js'

import { postBroadcastViaGateway } from './broadcast.js'

type BroadcastRequest = {
  channelId?: string
  content?: string
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim()
      if (!raw) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error('Invalid JSON body.'))
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, body: object): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

export function startHealthServer(
  port: number,
  getStatus: () => object,
  client: Client
): void {
  const broadcastSecret = process.env.DISCORD_BROADCAST_WORKER_SECRET?.trim() ?? ''

  const server = createServer(async (req, res) => {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
      sendJson(res, 200, getStatus())
      return
    }

    if (req.method === 'POST' && req.url === '/broadcast') {
      if (!broadcastSecret) {
        sendJson(res, 503, { ok: false, error: 'Broadcast worker secret not configured.' })
        return
      }

      const auth = req.headers.authorization ?? ''
      if (auth !== `Bearer ${broadcastSecret}`) {
        sendJson(res, 401, { ok: false, error: 'Unauthorized.' })
        return
      }

      if (!client.isReady()) {
        sendJson(res, 503, { ok: false, error: 'Discord client not ready.' })
        return
      }

      try {
        const body = (await readJsonBody(req)) as BroadcastRequest
        const channelId = typeof body.channelId === 'string' ? body.channelId.trim() : ''
        const content = typeof body.content === 'string' ? body.content : ''
        if (!channelId || !content.trim()) {
          sendJson(res, 400, { ok: false, error: 'channelId and content are required.' })
          return
        }

        const result = await postBroadcastViaGateway(client, channelId, content)
        if (!result.ok) {
          sendJson(res, 502, { ok: false, error: result.message })
          return
        }
        sendJson(res, 200, { ok: true, messageId: result.messageId })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Broadcast handler error.'
        sendJson(res, 500, { ok: false, error: message })
      }
      return
    }

    sendJson(res, 404, { ok: false, error: 'Not found.' })
  })

  server.listen(port, () => {
    console.log(`[discord-reply-bot] health + broadcast on :${port}`)
  })
}
