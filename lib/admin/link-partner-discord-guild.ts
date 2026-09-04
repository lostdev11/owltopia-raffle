import {
  createDiscordGiveawayPartner,
  getDiscordGiveawayPartnerByGuildId,
  getDiscordGiveawayPartnerById,
  updateDiscordGiveawayPartner,
  type CreateDiscordGiveawayPartnerInput,
} from '@/lib/db/discord-giveaway-partners'
import {
  getPartnerCommunityCreatorByWallet,
  updatePartnerCommunityCreator,
  type PartnerCommunityCreatorRow,
} from '@/lib/db/partner-community-creators-admin'
import { clearPartnerCommunityWalletCache } from '@/lib/raffles/partner-communities'
import { isAllowedDiscordIncomingWebhookUrl } from '@/lib/discord-webhook-url'
import type { DiscordGiveawayPartnerTenant } from '@/lib/types'

/** Discord snowflake: 17–20 digits. */
export function normalizeDiscordGuildId(raw: string): string | null {
  const t = raw.trim()
  if (!/^\d{17,20}$/.test(t)) return null
  return t
}

export type LinkPartnerDiscordGuildResult =
  | {
      ok: true
      creator: PartnerCommunityCreatorRow
      tenant: DiscordGiveawayPartnerTenant
      createdTenant: boolean
      apiSecret: string | null
    }
  | { ok: false; error: string; status: number }

/**
 * One-shot: ensure a Discord partner tenant exists for this guild and link it to the
 * Partner Pro (or other) allowlist wallet. Skips USDC verify — for Owl Vision onboarding.
 */
export async function linkPartnerCreatorToDiscordGuild(input: {
  creatorWallet: string
  guildId: string
  name?: string | null
  webhookUrl?: string | null
  status?: CreateDiscordGiveawayPartnerInput['status']
  contactNote?: string | null
  createdByWallet: string
}): Promise<LinkPartnerDiscordGuildResult> {
  const guildId = normalizeDiscordGuildId(input.guildId)
  if (!guildId) {
    return { ok: false, error: 'discord_guild_id must be a Discord server ID (17–20 digits).', status: 400 }
  }

  const webhookRaw = typeof input.webhookUrl === 'string' ? input.webhookUrl.trim() : ''
  if (webhookRaw && !isAllowedDiscordIncomingWebhookUrl(webhookRaw)) {
    return {
      ok: false,
      error: 'webhook_url must be a Discord incoming webhook (https://discord.com/api/webhooks/…)',
      status: 400,
    }
  }

  const creator = await getPartnerCommunityCreatorByWallet(input.creatorWallet)
  if (!creator) {
    return { ok: false, error: 'Partner creator wallet not on the allowlist.', status: 404 }
  }

  const existingByGuild = await getDiscordGiveawayPartnerByGuildId(guildId)
  let tenant = existingByGuild
  let createdTenant = false
  let apiSecret: string | null = null

  if (!tenant && creator.discord_partner_tenant_id) {
    const linked = await getDiscordGiveawayPartnerById(creator.discord_partner_tenant_id)
    if (linked) {
      const linkedGuild = linked.discord_guild_id?.trim() || ''
      if (!linkedGuild) {
        tenant = await updateDiscordGiveawayPartner(linked.id, {
          discord_guild_id: guildId,
          status: input.status ?? 'active',
          ...(webhookRaw ? { webhook_url: webhookRaw } : {}),
        })
      } else if (linkedGuild === guildId) {
        tenant = linked
      } else {
        return {
          ok: false,
          error: `This partner is already linked to a different Discord server (${linkedGuild}). Clear the tenant link first, or update that tenant’s guild id.`,
          status: 409,
        }
      }
    }
  }

  if (!tenant) {
    const name =
      input.name?.trim() ||
      creator.display_label?.trim() ||
      `Partner ${input.creatorWallet.slice(0, 6)}…`
    const created = await createDiscordGiveawayPartner({
      name,
      webhook_url: webhookRaw || null,
      discord_guild_id: guildId,
      status: input.status ?? 'active',
      active_until: null,
      contact_note:
        input.contactNote?.trim() ||
        'Linked from Owl Vision Partners hub (Partner Pro / off-platform payment).',
      created_by_wallet: input.createdByWallet,
    })
    tenant = created.tenant
    apiSecret = created.apiSecret
    createdTenant = true
  } else if (webhookRaw && !tenant.webhook_url) {
    tenant = (await updateDiscordGiveawayPartner(tenant.id, { webhook_url: webhookRaw })) ?? tenant
  }

  if (!tenant) {
    return { ok: false, error: 'Could not create or load Discord partner tenant.', status: 500 }
  }

  if (tenant.status === 'suspended') {
    tenant =
      (await updateDiscordGiveawayPartner(tenant.id, { status: input.status ?? 'active' })) ?? tenant
  }

  if (creator.discord_partner_tenant_id !== tenant.id) {
    const updated = await updatePartnerCommunityCreator(input.creatorWallet, {
      discord_partner_tenant_id: tenant.id,
    })
    if (!updated) {
      return { ok: false, error: 'Tenant ready but linking to creator wallet failed.', status: 500 }
    }
    clearPartnerCommunityWalletCache()
    return { ok: true, creator: updated, tenant, createdTenant, apiSecret }
  }

  return { ok: true, creator, tenant, createdTenant, apiSecret }
}
