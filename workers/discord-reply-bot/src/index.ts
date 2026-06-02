import { Client, GatewayIntentBits, Partials } from 'discord.js'

import { loadConfig } from './config.js'
import { registerMessageHandler } from './handlers/message-create.js'
import { startHealthServer } from './health-server.js'

async function main(): Promise<void> {
  const config = loadConfig()

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
  })

  registerMessageHandler(client, config)

  client.once('ready', () => {
    console.log(
      `[discord-reply-bot] logged in as ${client.user?.tag ?? 'unknown'} · guild ${config.guildId} · reply ${config.enabled ? 'on' : 'off'}`
    )
    if (config.channelIds?.length) {
      console.log(`[discord-reply-bot] channels: ${config.channelIds.join(', ')}`)
    }
  })

  startHealthServer(config.port, () => ({
    ok: true,
    ready: client.isReady(),
    user: client.user?.username ?? null,
    enabled: config.enabled,
  }))

  await client.login(config.token)
}

main().catch((err) => {
  console.error('[discord-reply-bot] fatal:', err)
  process.exit(1)
})
