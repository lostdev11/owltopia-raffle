import {
  editDiscordChannelMessage,
  pinDiscordChannelMessage,
  postDiscordChannelMessagePayload,
} from '@/lib/discord-channel-messages'
import {
  countDiscordWlSubmissions,
  getDiscordWlCampaignById,
  updateDiscordWlCampaign,
  type DiscordWlCampaignRow,
} from '@/lib/db/discord-wl-campaigns'
import { getOwlCenterLaunchByIdAdmin } from '@/lib/db/owl-center-launch'
import {
  buildDiscordWlPublicEmbed,
  buildDiscordWlSubmitButtonRow,
} from '@/lib/discord-wl/copy'
import { isDiscordWlFull } from '@/lib/discord-wl/campaign-rules'

export async function campaignEmbedContext(campaign: DiscordWlCampaignRow): Promise<{
  launchName: string | null
  launchSlug: string | null
  currentCount: number
}> {
  const currentCount = await countDiscordWlSubmissions(campaign.id)
  let launchName: string | null = null
  let launchSlug: string | null = null
  if (campaign.launch_id) {
    const launch = await getOwlCenterLaunchByIdAdmin(campaign.launch_id)
    if (launch) {
      launchName = launch.name
      launchSlug = launch.slug
    }
  }
  return { launchName, launchSlug, currentCount }
}

export function discordWlPublicMessagePayload(
  campaign: DiscordWlCampaignRow,
  ctx: { launchName: string | null; launchSlug: string | null; currentCount: number }
): Record<string, unknown> {
  const full = isDiscordWlFull(campaign.max_entries, ctx.currentCount)
  const disabled = campaign.status !== 'open' || full
  const embed = buildDiscordWlPublicEmbed({
    name: campaign.name,
    phaseKey: campaign.phase_key,
    status: campaign.status,
    currentCount: ctx.currentCount,
    maxEntries: campaign.max_entries,
    requiredRoleName: campaign.required_role_name,
    launchName: ctx.launchName,
    launchSlug: ctx.launchSlug,
  })
  return {
    embeds: [embed],
    components: [buildDiscordWlSubmitButtonRow(campaign.id, disabled)],
  }
}

export async function syncDiscordWlCampaignEmbed(
  campaign: DiscordWlCampaignRow,
  opts?: { pin?: boolean }
): Promise<{ ok: true; campaign: DiscordWlCampaignRow } | { ok: false; message: string }> {
  const ctx = await campaignEmbedContext(campaign)
  const payload = discordWlPublicMessagePayload(campaign, ctx)

  if (campaign.message_id) {
    const edited = await editDiscordChannelMessage(campaign.channel_id, campaign.message_id, payload)
    if (edited.ok) {
      if (opts?.pin) await pinDiscordChannelMessage(campaign.channel_id, campaign.message_id)
      return { ok: true, campaign }
    }
  }

  const posted = await postDiscordChannelMessagePayload(campaign.channel_id, payload)
  if (!posted.ok) {
    const hint =
      posted.code === 'forbidden'
        ? `I need **Send Messages** and **Embed Links** in <#${campaign.channel_id}> to post the button.`
        : posted.message
    return { ok: false, message: hint }
  }

  const updated = await updateDiscordWlCampaign(campaign.id, { message_id: posted.messageId || null })
  if (opts?.pin && posted.messageId) {
    const pinned = await pinDiscordChannelMessage(campaign.channel_id, posted.messageId)
    if (!pinned) {
      /* Partner can pin manually; not a hard failure. */
    }
  }
  return { ok: true, campaign: updated ?? { ...campaign, message_id: posted.messageId || campaign.message_id } }
}

export async function refreshDiscordWlCampaignEmbedById(campaignId: number): Promise<void> {
  const campaign = await getDiscordWlCampaignById(campaignId)
  if (!campaign) return
  await syncDiscordWlCampaignEmbed(campaign)
}
