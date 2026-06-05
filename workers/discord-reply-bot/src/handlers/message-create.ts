import type { Client, Message } from 'discord.js'

import type { ReplyBotConfig } from './config.js'
import { isOnCooldown, markReplied } from './rate-limit.js'
import { buildReplyText, stripBotMention } from './responses.js'

function channelAllowed(message: Message, channelIds: string[] | null): boolean {
  if (!channelIds?.length) return true
  return channelIds.includes(message.channelId)
}

async function isReplyToBot(message: Message, botId: string): Promise<boolean> {
  if (!message.reference?.messageId) return false
  try {
    const ref = await message.fetchReference()
    return ref.author.id === botId
  } catch {
    return false
  }
}

function shouldRespond(mentioned: boolean, replyToBot: boolean): boolean {
  return mentioned || replyToBot
}

export function registerMessageHandler(client: Client, config: ReplyBotConfig): void {
  client.on('messageCreate', (message) => {
    void handleMessage(message, client, config)
  })
}

async function handleMessage(message: Message, client: Client, config: ReplyBotConfig): Promise<void> {
  if (!config.enabled) return
  if (message.author.bot) return
  if (!message.guildId || message.guildId !== config.guildId) return
  if (!channelAllowed(message, config.channelIds)) return

  const botId = client.user?.id
  if (!botId) return

  const mentioned = message.mentions.has(botId)
  const replyToBot = await isReplyToBot(message, botId)
  if (!shouldRespond(mentioned, replyToBot)) return

  if (isOnCooldown(message.author.id, config.cooldownSec)) return

  const prompt = stripBotMention(message.content, botId)
  let replyText: string
  try {
    replyText = await buildReplyText(prompt, config.siteUrl)
  } catch (err) {
    console.error('[discord-reply-bot] buildReplyText:', err)
    return
  }

  if (replyText.length > 2000) {
    replyText = `${replyText.slice(0, 1997)}...`
  }

  try {
    await message.reply({
      content: replyText,
      allowedMentions: { parse: [] },
    })
    markReplied(message.author.id)
    console.log(
      `[discord-reply-bot] replied in #${message.channelId} to ${message.author.tag} (${mentioned ? 'mention' : 'reply'})`
    )
  } catch (err) {
    console.error('[discord-reply-bot] message.reply failed:', err)
  }
}
