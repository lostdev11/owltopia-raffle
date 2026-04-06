import { getSiteBaseUrl, PLATFORM_NAME } from '@/lib/site-config'
import {
  createPendingPaymentIntent,
  findIntentByMemo,
  getPendingIntentForGuild,
  isSignatureAlreadyUsed,
  markIntentConfirmed,
} from '@/lib/db/discord-partner-payment-intents'
import {
  createSlashDiscordPartnerTenant,
  extendDiscordPartnerActiveDeadline,
  getDiscordGiveawayPartnerByGuildId,
  isPartnerTenantEntitled,
  updateDiscordGiveawayPartner,
} from '@/lib/db/discord-giveaway-partners'
import {
  extractOwlgwMemosFromParsedTx,
  verifyDiscordPartnerUsdcPayment,
} from '@/lib/solana/verify-discord-partner-usdc'
import { isAllowedDiscordIncomingWebhookUrl } from '@/lib/discord-webhook-url'
import { getSolanaConnection } from '@/lib/solana/connection'

const MANAGE_WEBHOOKS_BIT = 1n << 29n

function ephemeral(content: string) {
  return {
    type: 4,
    data: {
      content: content.slice(0, 2000),
      flags: 64,
    },
  }
}

function discordPartnerPriceUsdc(): number {
  const raw = process.env.DISCORD_PARTNER_USDC_PRICE?.trim()
  const n = raw ? parseFloat(raw) : 50
  return Number.isFinite(n) && n > 0 ? n : 50
}

function discordPartnerSubscriptionDays(): number {
  const raw = process.env.DISCORD_PARTNER_SUBSCRIPTION_DAYS?.trim()
  const n = raw ? parseInt(raw, 10) : 30
  return Number.isFinite(n) && n > 0 ? n : 30
}

function discordPaymentIntentTtlHours(): number {
  const raw = process.env.DISCORD_PARTNER_PAYMENT_INTENT_TTL_HOURS?.trim()
  const n = raw ? parseInt(raw, 10) : 48
  return Number.isFinite(n) && n > 0 ? n : 48
}

function treasuryWalletLine(): string {
  const w =
    process.env.DISCORD_BOT_USDC_TREASURY_WALLET?.trim() ||
    process.env.RAFFLE_RECIPIENT_WALLET?.trim() ||
    ''
  return w || '(set DISCORD_BOT_USDC_TREASURY_WALLET on the server)'
}

function botInviteUrl(): string | null {
  const custom = process.env.DISCORD_BOT_INVITE_URL?.trim()
  if (custom) return custom
  const appId = process.env.DISCORD_APPLICATION_ID?.trim()
  if (!appId) return null
  const perms = '2147485696'
  return `https://discord.com/api/oauth2/authorize?client_id=${encodeURIComponent(appId)}&permissions=${perms}&scope=bot%20applications.commands`
}

type DiscordInteraction = {
  type: number
  guild_id?: string
  member?: { permissions?: string; user?: { id: string } }
  data?: {
    name?: string
    options?: Array<{ name: string; type: number; value?: string; options?: unknown[] }>
  }
}

function getSubcommandAndOptions(data: DiscordInteraction['data']): {
  sub: string | null
  strOptions: Record<string, string>
} {
  const opts = data?.options ?? []
  const sub = opts.find((o) => o.type === 1)
  if (!sub) return { sub: null, strOptions: {} }
  const strOptions: Record<string, string> = {}
  const nested = (sub.options ?? []) as Array<{ name: string; type: number; value?: string }>
  for (const o of nested) {
    if (o.type === 3 && typeof o.value === 'string') strOptions[o.name] = o.value
  }
  return { sub: sub.name ?? null, strOptions }
}

function memberCanManageWebhooks(member: DiscordInteraction['member']): boolean {
  if (!member?.permissions) return false
  try {
    return (BigInt(member.permissions) & MANAGE_WEBHOOKS_BIT) !== 0n
  } catch {
    return false
  }
}

export async function handleDiscordApplicationCommand(
  interaction: DiscordInteraction
): Promise<Record<string, unknown>> {
  const guildId = interaction.guild_id
  if (!guildId) {
    return ephemeral('Use this command in a server, not in DMs.')
  }

  const root = interaction.data?.name
  if (root !== 'owltopia-partner') {
    return ephemeral('Unknown command.')
  }

  const guildName = 'Discord guild' // name not always in interaction; optional upgrade with REST cache
  const { sub, strOptions } = getSubcommandAndOptions(interaction.data)

  if (sub === 'subscribe') {
    const price = discordPartnerPriceUsdc()
    const days = discordPartnerSubscriptionDays()
    const ttl = discordPaymentIntentTtlHours()
    let intent
    try {
      intent = await createPendingPaymentIntent({
        discord_guild_id: guildId,
        discord_guild_name: guildName,
        amount_usdc: price,
        ttlHours: ttl,
      })
    } catch (e) {
      console.error('subscribe intent:', e)
      return ephemeral('Could not create a payment session. Try again later.')
    }

    const invite = botInviteUrl()
    const base = getSiteBaseUrl()
    const lines = [
      `**${PLATFORM_NAME} — partner subscription**`,
      '',
      `**Price:** ${price} USDC (Solana) for **${days} days**`,
      '',
      `**Treasury wallet:** \`${treasuryWalletLine()}\``,
      `**Memo (exact):** \`${intent.memo}\``,
      '',
      'Send **exactly** that USDC amount in **one** transaction that includes a **Memo** instruction with the memo above (same transaction as the SPL transfer). Phantom/Solflare: add Memo in advanced, or use a wallet that supports memo + USDC in one tx.',
      '',
      `This quote expires: ${intent.expires_at}`,
      '',
      `Then run \`/owltopia-partner verify signature:<your_tx_signature>\` in this server.`,
      '',
      `Docs base URL: ${base}`,
    ]
    if (invite) lines.push('', `**Add the bot:** ${invite}`)
    return ephemeral(lines.join('\n'))
  }

  if (sub === 'verify') {
    const sig = (strOptions.signature ?? '').trim()
    if (!sig) return ephemeral('Missing signature.')

    const used = await isSignatureAlreadyUsed(sig)
    if (used) return ephemeral('That transaction was already used.')

    const connection = getSolanaConnection()
    const tx = await connection.getParsedTransaction(sig, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    })
    if (!tx || tx.meta?.err) {
      return ephemeral('Transaction not found or failed. Check the signature and cluster (mainnet USDC).')
    }

    const memos = extractOwlgwMemosFromParsedTx(tx)
    let intent = null
    for (const m of memos) {
      const cand = await findIntentByMemo(m)
      if (cand && cand.discord_guild_id === guildId) {
        intent = cand
        break
      }
    }
    if (!intent) {
      return ephemeral(
        'No matching pending payment for this server. Run `/owltopia-partner subscribe` first and include memo `OWLGW:…` in your USDC transaction.'
      )
    }
    if (new Date(intent.expires_at).getTime() <= Date.now()) {
      return ephemeral('That payment quote expired. Run `/owltopia-partner subscribe` again.')
    }

    const check = await verifyDiscordPartnerUsdcPayment({
      signature: sig,
      expectedUsdc: intent.amount_usdc,
      expectedMemo: intent.memo,
      parsedTransaction: tx,
    })
    if (!check.ok) {
      return ephemeral(check.error)
    }

    const days = discordPartnerSubscriptionDays()
    try {
      const existing = await getDiscordGiveawayPartnerByGuildId(guildId)
      let tenantId: string
      let apiLine = ''
      if (existing) {
        const updated = await extendDiscordPartnerActiveDeadline(existing.id, days)
        if (!updated) return ephemeral('Could not extend subscription (database error).')
        tenantId = updated.id
        apiLine = 'Your existing API secret is unchanged. Use `/owltopia-partner status` if needed.'
      } else {
        const { tenant, apiSecret } = await createSlashDiscordPartnerTenant({
          guildId,
          guildName,
          subscriptionDays: days,
        })
        tenantId = tenant.id
        apiLine = `**API secret (copy once):** \`${apiSecret}\`\nUse header \`Authorization: Bearer <secret>\` on \`POST ${getSiteBaseUrl()}/api/integrations/discord-giveaway/notify\``
      }
      await markIntentConfirmed(intent.id, sig, tenantId)
      return ephemeral(
        `**Payment verified.** Subscription extended **${days} days**.\n\n${apiLine}\n\nNext: \`/owltopia-partner webhook url:…\` (Manage Webhooks) so we can post giveaway updates.`
      )
    } catch (e) {
      console.error('verify provision:', e)
      return ephemeral('Verified on-chain but saving failed. Contact support with your signature.')
    }
  }

  if (sub === 'webhook') {
    if (!memberCanManageWebhooks(interaction.member)) {
      return ephemeral('You need **Manage Webhooks** permission to set the webhook URL.')
    }
    const url = (strOptions.url ?? '').trim()
    if (!url || !isAllowedDiscordIncomingWebhookUrl(url)) {
      return ephemeral('Invalid webhook URL. Use a Discord **incoming** webhook (`https://discord.com/api/webhooks/…`).')
    }
    const partner = await getDiscordGiveawayPartnerByGuildId(guildId)
    if (!partner) {
      return ephemeral('No partner record for this server. Complete `/owltopia-partner subscribe` and `/verify` first.')
    }
    if (!isPartnerTenantEntitled(partner)) {
      return ephemeral('Subscription is not active. Renew with subscribe + verify.')
    }
    const updated = await updateDiscordGiveawayPartner(partner.id, { webhook_url: url })
    if (!updated) return ephemeral('Could not save webhook.')
    return ephemeral('Webhook saved. Linked NFT giveaways will post here when deposit is verified or claimed.')
  }

  if (sub === 'status') {
    const partner = await getDiscordGiveawayPartnerByGuildId(guildId)
    const pending = await getPendingIntentForGuild(guildId)
    if (!partner && !pending) {
      return ephemeral('No partner subscription yet. Use `/owltopia-partner subscribe`.')
    }
    const lines: string[] = []
    if (pending) {
      lines.push(`**Pending quote:** ${pending.amount_usdc} USDC — memo \`${pending.memo}\` — expires ${pending.expires_at}`)
    }
    if (partner) {
      lines.push(
        `**Partner id:** \`${partner.id}\``,
        `**Status:** ${partner.status}`,
        `**Active until:** ${partner.active_until ?? '—'}`,
        `**Webhook:** ${partner.webhook_url ? 'configured' : '**not set** — run /webhook'}`,
        `**Entitled:** ${isPartnerTenantEntitled(partner) ? 'yes' : 'no'}`
      )
    }
    return ephemeral(lines.join('\n'))
  }

  return ephemeral('Unknown subcommand.')
}
