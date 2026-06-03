import { isAdmin } from '@/lib/db/admins'
import { getDiscordGiveawayPartnerByGuildId, getDiscordGiveawayPartnerById } from '@/lib/db/discord-giveaway-partners'
import { getPartnerRaffleVisibilityEntitlementForCreatorWallet } from '@/lib/db/partner-community-creators-admin'
import { getWalletAddressByDiscordUserId } from '@/lib/db/wallet-profiles'
import { getSiteBaseUrl } from '@/lib/site-config'

export type DiscordPartnerCommandAccess =
  | { ok: true; wallet: string; isFounder: boolean }
  | { ok: false; message: string }

function isPaidPartnerTier(tier: string | null): boolean {
  return tier === 'partner_pro' || tier === 'white_label'
}

/**
 * Who may run `/owltopia-partner` in a guild:
 * - Founders: wallet in `admins` (linked Discord on dashboard).
 * - Partners: active Partner Pro / white_label on `partner_community_creators` + linked Discord.
 * - Guild must match linked Discord tenant when one is configured (founders skip).
 */
export async function assertDiscordPartnerCommandAccess(
  discordUserId: string | undefined,
  guildId: string
): Promise<DiscordPartnerCommandAccess> {
  const did = typeof discordUserId === 'string' ? discordUserId.trim() : ''
  if (!did) {
    return {
      ok: false,
      message:
        'Could not read your Discord user id. Try again in a server channel (not DMs).',
    }
  }

  const wallet = await getWalletAddressByDiscordUserId(did)
  if (!wallet) {
    const base = getSiteBaseUrl()
    return {
      ok: false,
      message: [
        'Link this Discord account on your **Owltopia dashboard** first (same wallet as your Partner Pro allowlist).',
        '',
        `${base}/dashboard`,
      ].join('\n'),
    }
  }

  if (await isAdmin(wallet)) {
    return { ok: true, wallet, isFounder: true }
  }

  const entitlement = await getPartnerRaffleVisibilityEntitlementForCreatorWallet(wallet)
  if (!isPaidPartnerTier(entitlement.partnerTier)) {
    return {
      ok: false,
      message:
        '**Partner Pro** is required to use Owltopia partner bot commands. Your linked wallet is not on the Partner Pro allowlist — contact Owltopia to onboard.',
    }
  }

  const g = guildId.trim()
  const tenantId = entitlement.discordPartnerTenantId
  if (tenantId) {
    const tenant = await getDiscordGiveawayPartnerById(tenantId)
    const linkedGuild = tenant?.discord_guild_id?.trim()
    if (linkedGuild && linkedGuild !== g) {
      return {
        ok: false,
        message:
          'Your Partner Pro Discord setup is linked to a **different server**. Run these commands in the server tied to your partner tenant, or ask Owltopia to update your guild link.',
      }
    }
  } else {
    const existingGuildTenant = await getDiscordGiveawayPartnerByGuildId(g)
    if (existingGuildTenant) {
      return {
        ok: false,
        message:
          'This server already has an Owltopia partner subscription tied to another account. Ask Owltopia support if you need access.',
      }
    }
  }

  return { ok: true, wallet, isFounder: false }
}
