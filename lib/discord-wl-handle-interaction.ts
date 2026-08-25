import { getSiteBaseUrl, PLATFORM_NAME } from '@/lib/site-config'
import { assertDiscordPartnerCommandAccess } from '@/lib/discord-partner-command-access'
import { generateDiscordMarketplaceLinkState } from '@/lib/discord-marketplace-link-state'
import { getWalletAddressByDiscordUserId } from '@/lib/db/wallet-profiles'
import {
  getDiscordGiveawayPartnerByGuildId,
  getDiscordGiveawayPartnerById,
} from '@/lib/db/discord-giveaway-partners'
import { getPendingIntentForGuild } from '@/lib/db/discord-partner-payment-intents'
import { getPartnerRaffleVisibilityEntitlementForCreatorWallet } from '@/lib/db/partner-community-creators-admin'
import {
  getOwlCenterLaunchByIdAdmin,
  getOwlCenterLaunchBySlugAdmin,
} from '@/lib/db/owl-center-launch'
import { bulkUpsertLaunchWlWallets } from '@/lib/db/owl-center-launch-wl-wallets'
import { canEditLaunchMintDetails } from '@/lib/owl-center/creator-access'
import { launchHasWhitelistProgram } from '@/lib/owl-center/launch-wl-window'
import { normalizePhaseKey, resolvePartnerAllowlistPhases } from '@/lib/owl-center/partner-allowlist-phases'
import { rateLimit } from '@/lib/rate-limit'
import {
  countDiscordWlSubmissions,
  createDiscordWlCampaign,
  getDiscordWlCampaignById,
  getDiscordWlSubmissionForUser,
  getDiscordWlSubmissionForWallet,
  insertDiscordWlSubmission,
  listDiscordWlCampaignsByGuild,
  listDiscordWlSubmissions,
  removeDiscordWlSubmission,
  resolveDiscordWlCampaignInGuild,
  updateDiscordWlCampaign,
  type DiscordWlCampaignRow,
} from '@/lib/db/discord-wl-campaigns'
import {
  discordWlPhaseLabel,
  evaluateDiscordWlSubmit,
  formatCampaignListLine,
  isDiscordWlFull,
  shouldRefreshCampaignEmbed,
} from '@/lib/discord-wl/campaign-rules'
import {
  buildLinkedWalletConfirmPayload,
  buildUnlinkedWalletChoicePayload,
  buildWalletModal,
  discordWlDashboardUrl,
  formatMissingPartnerTenantMessage,
  formatPartnerLiveMessage,
  formatSetupChecklist,
  formatSubmitSuccessMessage,
} from '@/lib/discord-wl/copy'
import { mapPushWallets } from '@/lib/discord-wl/csv'
import { refreshDiscordWlCampaignEmbedById, syncDiscordWlCampaignEmbed } from '@/lib/discord-wl/sync-embed'
import { parseOwlwlCustomId } from '@/lib/discord-wl/custom-id'
import { formatWalletShort } from '@/lib/discord-wl/wallet-input'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function ephemeral(content: string) {
  return {
    type: 4,
    data: {
      content: content.slice(0, 2000),
      flags: 64,
    },
  }
}

type DiscordUser = { id?: string; username?: string; global_name?: string }

type DiscordInteraction = {
  type: number
  guild_id?: string
  channel_id?: string
  member?: {
    permissions?: string
    roles?: string[]
    user?: DiscordUser
    nick?: string
  }
  user?: DiscordUser
  data?: {
    name?: string
    custom_id?: string
    options?: Array<{
      name: string
      type: number
      value?: string | number
      options?: unknown[]
    }>
    components?: Array<{
      components?: Array<{ custom_id?: string; value?: string }>
    }>
    resolved?: {
      roles?: Record<string, { id?: string; name?: string }>
    }
  }
}

function discordUserId(interaction: DiscordInteraction): string {
  return (interaction.member?.user?.id || interaction.user?.id || '').trim()
}

function discordUsername(interaction: DiscordInteraction): string {
  const u = interaction.member?.user || interaction.user
  const name = (u?.global_name || u?.username || interaction.member?.nick || '').trim()
  return name.slice(0, 64)
}

function memberRoleIds(interaction: DiscordInteraction): string[] {
  return Array.isArray(interaction.member?.roles) ? interaction.member!.roles.map((r) => String(r)) : []
}

function getSubcommandAndOptions(data: DiscordInteraction['data']): {
  sub: string | null
  strOptions: Record<string, string>
  numOptions: Record<string, number>
  boolOptions: Record<string, boolean>
} {
  const opts = data?.options ?? []
  const sub = opts.find((o) => o.type === 1)
  if (!sub) return { sub: null, strOptions: {}, numOptions: {}, boolOptions: {} }
  const strOptions: Record<string, string> = {}
  const numOptions: Record<string, number> = {}
  const boolOptions: Record<string, boolean> = {}
  const nested = (sub.options ?? []) as Array<{
    name: string
    type: number
    value?: string | number | boolean
  }>
  for (const o of nested) {
    if ((o.type === 3 || o.type === 6 || o.type === 7 || o.type === 8) && typeof o.value === 'string') {
      strOptions[o.name] = o.value
    }
    if (o.type === 4 && typeof o.value === 'number') numOptions[o.name] = o.value
    if (o.type === 5 && typeof o.value === 'boolean') boolOptions[o.name] = o.value
  }
  return { sub: sub.name ?? null, strOptions, numOptions, boolOptions }
}

function modalWalletValue(interaction: DiscordInteraction): string {
  const rows = interaction.data?.components ?? []
  for (const row of rows) {
    for (const c of row.components ?? []) {
      if (c.custom_id === 'wallet' && typeof c.value === 'string') return c.value
    }
  }
  return ''
}

async function resolvePartnerTenant(guildId: string, wallet: string) {
  const byGuild = await getDiscordGiveawayPartnerByGuildId(guildId)
  if (byGuild) return byGuild
  const entitlement = await getPartnerRaffleVisibilityEntitlementForCreatorWallet(wallet)
  const tenantId = entitlement.discordPartnerTenantId?.trim()
  if (!tenantId) return null
  return getDiscordGiveawayPartnerById(tenantId)
}

async function requirePartner(interaction: DiscordInteraction): Promise<
  | { ok: true; wallet: string; isFounder: boolean }
  | { ok: false; response: Record<string, unknown> }
> {
  const guildId = interaction.guild_id?.trim()
  if (!guildId) return { ok: false, response: ephemeral('Use this command in a server, not DMs.') }
  const access = await assertDiscordPartnerCommandAccess(discordUserId(interaction), guildId)
  if (!access.ok) return { ok: false, response: ephemeral(access.message) }
  return { ok: true, wallet: access.wallet, isFounder: access.isFounder }
}

async function resolveCampaignFromCommand(
  interaction: DiscordInteraction,
  strOptions: Record<string, string>
): Promise<DiscordWlCampaignRow | null> {
  const guildId = interaction.guild_id?.trim() ?? ''
  return resolveDiscordWlCampaignInGuild({
    guildId,
    channelId: interaction.channel_id,
    spot: strOptions.spot,
  })
}

async function maybeAutoCloseIfFull(campaign: DiscordWlCampaignRow, nextCount: number): Promise<DiscordWlCampaignRow> {
  if (campaign.status !== 'open' || !isDiscordWlFull(campaign.max_entries, nextCount)) return campaign
  const updated = await updateDiscordWlCampaign(campaign.id, {
    status: 'closed',
    closed_at: new Date().toISOString(),
  })
  return updated ?? { ...campaign, status: 'closed' }
}

async function afterSuccessfulSubmit(campaign: DiscordWlCampaignRow, previousCount: number, nextCount: number) {
  const closed = await maybeAutoCloseIfFull(campaign, nextCount)
  if (
    shouldRefreshCampaignEmbed({
      previousCount,
      nextCount,
      becameClosed: closed.status === 'closed' && campaign.status === 'open',
      becameOpen: false,
      maxEntries: campaign.max_entries,
    })
  ) {
    await syncDiscordWlCampaignEmbed(closed)
  }
}

async function evaluateAndInsert(input: {
  campaign: DiscordWlCampaignRow
  interaction: DiscordInteraction
  walletRaw: string
  source: 'linked_wallet' | 'modal'
}): Promise<Record<string, unknown>> {
  const did = discordUserId(input.interaction)
  const rl = rateLimit(`discord-wl-submit:${did}`, 8, 60_000)
  if (!rl.allowed) return ephemeral('Slow down — try again in a minute.')

  const [currentCount, existingUser] = await Promise.all([
    countDiscordWlSubmissions(input.campaign.id),
    getDiscordWlSubmissionForUser(input.campaign.id, did),
  ])
  const walletPeek = input.walletRaw.trim()
  const existingWalletRow = walletPeek ? await getDiscordWlSubmissionForWallet(input.campaign.id, walletPeek) : null

  const decision = evaluateDiscordWlSubmit({
    status: input.campaign.status,
    maxEntries: input.campaign.max_entries,
    currentCount,
    requiredRoleId: input.campaign.required_role_id,
    requiredRoleName: input.campaign.required_role_name,
    memberRoleIds: memberRoleIds(input.interaction),
    existingByUserWallet: existingUser?.wallet ?? null,
    existingWalletOwnerUserId: existingWalletRow?.discord_user_id ?? null,
    discordUserId: did,
    walletRaw: input.walletRaw,
  })
  if (!decision.ok) return ephemeral(decision.message)

  const inserted = await insertDiscordWlSubmission({
    campaignId: input.campaign.id,
    discordUserId: did,
    discordUsername: discordUsername(input.interaction),
    wallet: decision.wallet,
    source: input.source,
  })
  if (!inserted.ok) {
    if (inserted.code === 'user_taken') {
      const again = await getDiscordWlSubmissionForUser(input.campaign.id, did)
      return ephemeral(
        again
          ? `You’re already on this list with **${formatWalletShort(again.wallet)}**.`
          : 'You’re already on this list.'
      )
    }
    return ephemeral(inserted.message)
  }

  void afterSuccessfulSubmit(input.campaign, currentCount, currentCount + 1)

  return ephemeral(
    formatSubmitSuccessMessage({
      phaseLabel: discordWlPhaseLabel(input.campaign.phase_key),
      wallet: decision.wallet,
      spots: input.campaign.spots_per_wallet,
    })
  )
}

async function handleMemberSubmitButton(interaction: DiscordInteraction, campaignId: number) {
  const campaign = await getDiscordWlCampaignById(campaignId)
  if (!campaign) return ephemeral('This whitelist spot is no longer available.')
  if (campaign.discord_guild_id !== (interaction.guild_id ?? '').trim()) {
    return ephemeral('This whitelist spot belongs to a different server.')
  }

  const did = discordUserId(interaction)
  const [currentCount, existingUser, linkedWallet] = await Promise.all([
    countDiscordWlSubmissions(campaign.id),
    getDiscordWlSubmissionForUser(campaign.id, did),
    getWalletAddressByDiscordUserId(did),
  ])

  const precheck = evaluateDiscordWlSubmit({
    status: campaign.status,
    maxEntries: campaign.max_entries,
    currentCount,
    requiredRoleId: campaign.required_role_id,
    requiredRoleName: campaign.required_role_name,
    memberRoleIds: memberRoleIds(interaction),
    existingByUserWallet: existingUser?.wallet ?? null,
    existingWalletOwnerUserId: null,
    discordUserId: did,
    walletRaw: linkedWallet || '11111111111111111111111111111111',
  })
  if (!precheck.ok && precheck.code !== 'invalid' && precheck.code !== 'evm' && precheck.code !== 'wallet_taken') {
    return ephemeral(precheck.message)
  }

  if (linkedWallet) {
    return buildLinkedWalletConfirmPayload({
      campaignId: campaign.id,
      phaseLabel: discordWlPhaseLabel(campaign.phase_key),
      wallet: linkedWallet,
    })
  }

  const state = generateDiscordMarketplaceLinkState(did)
  const connectUrl = `${getSiteBaseUrl()}/discord-shop/connect?state=${encodeURIComponent(state)}`
  return buildUnlinkedWalletChoicePayload({ campaignId: campaign.id, connectUrl })
}

async function handleMemberModalButton(interaction: DiscordInteraction, campaignId: number) {
  const campaign = await getDiscordWlCampaignById(campaignId)
  if (!campaign) return ephemeral('This whitelist spot is no longer available.')
  if (campaign.status !== 'open') {
    return ephemeral('This whitelist is **closed**. Watch announcements for the mint link.')
  }
  return buildWalletModal(campaign.id)
}

export async function handleDiscordWlImmediateComponent(
  interaction: DiscordInteraction
): Promise<Record<string, unknown>> {
  const parsed = parseOwlwlCustomId(interaction.data?.custom_id)
  if (!parsed) return ephemeral('Unknown button.')
  if (parsed.action === 'submit') return handleMemberSubmitButton(interaction, parsed.campaignId)
  if (parsed.action === 'modal') return handleMemberModalButton(interaction, parsed.campaignId)
  return ephemeral('Unknown button.')
}

async function resolveLaunchForPartner(
  raw: string,
  wallet: string
): Promise<{ launch: NonNullable<Awaited<ReturnType<typeof getOwlCenterLaunchByIdAdmin>>> } | { error: string }> {
  const t = raw.trim()
  if (!t) return { error: 'Collection not found. Pick a launch from autocomplete or create it in Owl Center first.' }
  const launch = UUID_RE.test(t) ? await getOwlCenterLaunchByIdAdmin(t) : await getOwlCenterLaunchBySlugAdmin(t)
  if (!launch) {
    return { error: 'Collection not found. Pick a launch from Owl Center or check the slug.' }
  }
  const access = await canEditLaunchMintDetails(wallet, launch)
  if (!access.ok) {
    return { error: 'That collection belongs to a different wallet. Use a launch you created.' }
  }
  return { launch }
}

async function handleCreate(interaction: DiscordInteraction, strOptions: Record<string, string>, numOptions: Record<string, number>) {
  const partner = await requirePartner(interaction)
  if (!partner.ok) return partner.response
  const guildId = interaction.guild_id!.trim()
  const tenant = await resolvePartnerTenant(guildId, partner.wallet)
  if (!tenant) {
    let hasPendingPayment = false
    try {
      hasPendingPayment = Boolean(await getPendingIntentForGuild(guildId))
    } catch (e) {
      console.error('wl create pending intent check:', e)
    }
    return ephemeral(formatMissingPartnerTenantMessage({ hasPendingPayment }))
  }

  const name = (strOptions.name ?? '').trim()
  if (!name) return ephemeral('Give the spot a **name** (shown on the embed), e.g. `OG Whitelist`.')
  const channelId = (strOptions.channel ?? interaction.channel_id ?? '').trim()
  if (!channelId) return ephemeral('Pick a text channel, or run this command in the channel where the button should live.')

  const phaseKey = normalizePhaseKey(strOptions.phase ?? 'wl') || 'wl'
  const maxEntries = numOptions.max != null && numOptions.max > 0 ? Math.floor(numOptions.max) : null
  const spots = numOptions.spots != null && numOptions.spots > 0 ? Math.floor(numOptions.spots) : 1
  const roleId = strOptions.role?.trim() || null
  const roleName = roleId ? interaction.data?.resolved?.roles?.[roleId]?.name ?? null : null

  let launchId: string | null = null
  const launchRaw = (strOptions.launch ?? '').trim()
  if (launchRaw) {
    const resolved = await resolveLaunchForPartner(launchRaw, partner.wallet)
    if ('error' in resolved) return ephemeral(resolved.error)
    launchId = resolved.launch.id
  }

  const campaign = await createDiscordWlCampaign({
    discordGuildId: guildId,
    partnerTenantId: tenant.id,
    channelId,
    name,
    phaseKey,
    launchId,
    maxEntries,
    spotsPerWallet: spots,
    requiredRoleId: roleId,
    requiredRoleName: roleName,
    createdByWallet: partner.wallet,
    createdByDiscordUserId: discordUserId(interaction),
  })

  const opened = await updateDiscordWlCampaign(campaign.id, {
    status: 'open',
    opened_at: new Date().toISOString(),
  })
  const live = opened ?? { ...campaign, status: 'open' as const }
  const posted = await syncDiscordWlCampaignEmbed(live, { pin: true })
  if (!posted.ok) {
    return ephemeral(
      [
        `Created **${name}**, but I couldn’t post in <#${channelId}>.`,
        posted.message,
        'Fix permissions, then run `/owltopia-wl open`.',
      ].join('\n')
    )
  }

  return ephemeral(
    formatPartnerLiveMessage({
      channelId,
      phaseLabel: discordWlPhaseLabel(live.phase_key),
      maxEntries: live.max_entries,
      spots: live.spots_per_wallet,
      requiredRoleName: live.required_role_name,
    })
  )
}

async function handleSetRole(
  interaction: DiscordInteraction,
  strOptions: Record<string, string>,
  boolOptions: Record<string, boolean>
) {
  const partner = await requirePartner(interaction)
  if (!partner.ok) return partner.response
  const campaign = await resolveCampaignFromCommand(interaction, strOptions)
  if (!campaign) {
    return ephemeral('No whitelist spot in this server yet. Run `/owltopia-wl create` first (you can pass `role:` there too).')
  }

  const clear = boolOptions.clear === true
  const roleId = strOptions.role?.trim() || null
  if (!clear && !roleId) {
    return ephemeral(
      [
        'Pick a **role** to require for Submit wallet, or set `clear:True` to remove the gate.',
        '',
        'Examples:',
        '`/owltopia-wl set-role role:@OG`',
        '`/owltopia-wl set-role clear:True`',
        '',
        'When creating a new spot: `/owltopia-wl create name:OG Whitelist role:@OG`',
      ].join('\n')
    )
  }

  const roleName = roleId ? interaction.data?.resolved?.roles?.[roleId]?.name ?? null : null
  const updated = await updateDiscordWlCampaign(campaign.id, {
    required_role_id: clear ? null : roleId,
    required_role_name: clear ? null : roleName,
  })
  const live = updated ?? {
    ...campaign,
    required_role_id: clear ? null : roleId,
    required_role_name: clear ? null : roleName,
  }
  await syncDiscordWlCampaignEmbed(live)

  if (clear || !live.required_role_id) {
    return ephemeral(`Role gate **cleared** on **${live.name}**. Anyone in the channel can submit (channel perms still apply).`)
  }
  const label = live.required_role_name?.trim() || live.required_role_id
  return ephemeral(
    `Role gate set on **${live.name}**: only **@${label.replace(/^@/, '')}** can press Submit wallet. Embed updated.`
  )
}

async function handleOpenClose(
  interaction: DiscordInteraction,
  strOptions: Record<string, string>,
  next: 'open' | 'closed'
) {
  const partner = await requirePartner(interaction)
  if (!partner.ok) return partner.response
  const campaign = await resolveCampaignFromCommand(interaction, strOptions)
  if (!campaign) return ephemeral('No whitelist spot in this server yet. Run `/owltopia-wl setup` then `/owltopia-wl create`.')

  const patch =
    next === 'open'
      ? { status: 'open' as const, opened_at: new Date().toISOString(), closed_at: null }
      : { status: 'closed' as const, closed_at: new Date().toISOString() }
  const updated = await updateDiscordWlCampaign(campaign.id, patch)
  const live = updated ?? { ...campaign, status: next }
  const synced = await syncDiscordWlCampaignEmbed(live, { pin: next === 'open' })
  if (!synced.ok && next === 'open') return ephemeral(synced.message)

  if (next === 'open') {
    return ephemeral(
      formatPartnerLiveMessage({
        channelId: live.channel_id,
        phaseLabel: discordWlPhaseLabel(live.phase_key),
        maxEntries: live.max_entries,
        spots: live.spots_per_wallet,
        requiredRoleName: live.required_role_name,
      })
    )
  }
  const count = await countDiscordWlSubmissions(live.id)
  return ephemeral(
    [
      `**${live.name}** is closed. ${count} wallet${count === 1 ? '' : 's'} registered.`,
      'You can reopen with `/owltopia-wl open`.',
      `Export or push: ${discordWlDashboardUrl()}`,
    ].join('\n')
  )
}

async function handleStatus(interaction: DiscordInteraction, strOptions: Record<string, string>) {
  const partner = await requirePartner(interaction)
  if (!partner.ok) return partner.response
  const campaign = await resolveCampaignFromCommand(interaction, strOptions)
  if (!campaign) return ephemeral('No whitelist spot in this server yet. Run `/owltopia-wl create`.')
  const count = await countDiscordWlSubmissions(campaign.id)
  const cap = campaign.max_entries != null ? String(campaign.max_entries) : 'unlimited'
  const launch = campaign.launch_id ? await getOwlCenterLaunchByIdAdmin(campaign.launch_id) : null
  return ephemeral(
    [
      `**${campaign.name}** (id \`${campaign.id}\`)`,
      `Status: **${campaign.status}** · Phase: ${discordWlPhaseLabel(campaign.phase_key)}`,
      `Channel: <#${campaign.channel_id}> · ${count} / ${cap}`,
      launch ? `Collection: ${launch.name} (\`${launch.slug}\`)` : 'Collection: not linked yet',
      campaign.last_pushed_at ? `Last push: ${campaign.last_pushed_at}` : 'Not pushed to Owl Center yet',
      `Dashboard: ${discordWlDashboardUrl()}`,
    ].join('\n')
  )
}

async function handleList(interaction: DiscordInteraction) {
  const partner = await requirePartner(interaction)
  if (!partner.ok) return partner.response
  const guildId = interaction.guild_id!.trim()
  const campaigns = await listDiscordWlCampaignsByGuild(guildId)
  if (campaigns.length === 0) {
    return ephemeral('No whitelist spots in this server yet. Run `/owltopia-wl setup`.')
  }
  const counts = await Promise.all(campaigns.map((c) => countDiscordWlSubmissions(c.id)))
  const lines = campaigns.map((c, i) => formatCampaignListLine({
    name: c.name,
    channelId: c.channel_id,
    status: c.status,
    currentCount: counts[i] ?? 0,
    maxEntries: c.max_entries,
  }))
  return ephemeral(
    [`**Whitelist spots**`, '', ...lines, '', `Export: ${discordWlDashboardUrl()}`].join('\n')
  )
}

async function handleExport(interaction: DiscordInteraction, strOptions: Record<string, string>) {
  const partner = await requirePartner(interaction)
  if (!partner.ok) return partner.response
  const campaign = await resolveCampaignFromCommand(interaction, strOptions)
  if (!campaign) return ephemeral('No whitelist spot in this server yet.')
  const rows = await listDiscordWlSubmissions(campaign.id)
  if (rows.length === 0) {
    return ephemeral('No wallets to export yet — open the spot and wait for submissions.')
  }
  const preview = rows
    .slice(0, 15)
    .map((r) => r.wallet)
    .join('\n')
  const more = rows.length > 15 ? `\n…and ${rows.length - 15} more` : ''
  return ephemeral(
    [
      `**${campaign.name}** — ${rows.length} wallet${rows.length === 1 ? '' : 's'}`,
      `Download CSV (best on phone): ${discordWlDashboardUrl()}`,
      '',
      '```',
      `${preview}${more}`,
      '```',
    ].join('\n')
  )
}

async function handlePush(interaction: DiscordInteraction, strOptions: Record<string, string>) {
  const partner = await requirePartner(interaction)
  if (!partner.ok) return partner.response
  const campaign = await resolveCampaignFromCommand(interaction, strOptions)
  if (!campaign) return ephemeral('No whitelist spot in this server yet.')
  const rows = await listDiscordWlSubmissions(campaign.id)
  if (rows.length === 0) {
    return ephemeral('No wallets to push — open the spot and wait for submissions, or export is empty.')
  }

  let launchId = campaign.launch_id
  const launchRaw = (strOptions.launch ?? '').trim()
  if (launchRaw) {
    const resolved = await resolveLaunchForPartner(launchRaw, partner.wallet)
    if ('error' in resolved) return ephemeral(resolved.error)
    launchId = resolved.launch.id
    await updateDiscordWlCampaign(campaign.id, { launch_id: launchId })
  }
  if (!launchId) {
    return ephemeral('Link a collection first: `/owltopia-wl push launch:<slug>` or set launch when you create the spot.')
  }
  const launch = await getOwlCenterLaunchByIdAdmin(launchId)
  if (!launch) return ephemeral('Collection not found. Pick a launch from Owl Center or check the slug.')
  const access = await canEditLaunchMintDetails(partner.wallet, launch)
  if (!access.ok) return ephemeral('That collection belongs to a different wallet. Use a launch you created.')
  if (!launchHasWhitelistProgram(launch)) {
    return ephemeral(
      `Your mint doesn’t have an **${discordWlPhaseLabel(campaign.phase_key)}** phase yet. Add it under Manage collection → Mint details, then push again.`
    )
  }
  const phases = resolvePartnerAllowlistPhases(launch)
  if (phases.length > 0 && !phases.some((p) => p.key === campaign.phase_key)) {
    return ephemeral(
      `Your mint doesn’t have an **${discordWlPhaseLabel(campaign.phase_key)}** phase yet. Add it under Manage collection → Mint details, then push again.`
    )
  }

  const result = await bulkUpsertLaunchWlWallets({
    launchId: launch.id,
    phaseKey: campaign.phase_key,
    wallets: mapPushWallets({
      wallets: rows.map((r) => r.wallet),
      spotsPerWallet: campaign.spots_per_wallet,
      notePrefix: 'discord-wl',
    }),
    createdByWallet: partner.wallet,
  })
  await updateDiscordWlCampaign(campaign.id, { last_pushed_at: new Date().toISOString() })
  const failN = result.failed.length
  return ephemeral(
    [
      `Pushed **${result.upserted}** wallet${result.upserted === 1 ? '' : 's'} to **${launch.name}** (${discordWlPhaseLabel(campaign.phase_key)}).`,
      failN ? `${failN} skipped.` : 'Existing Owl Center entries were kept.',
      `${getSiteBaseUrl()}/owl-center/collection/${encodeURIComponent(launch.slug)}`,
    ].join('\n')
  )
}

async function handleRemove(interaction: DiscordInteraction, strOptions: Record<string, string>) {
  const partner = await requirePartner(interaction)
  if (!partner.ok) return partner.response
  const campaign = await resolveCampaignFromCommand(interaction, strOptions)
  if (!campaign) return ephemeral('No whitelist spot in this server yet.')
  const result = await removeDiscordWlSubmission({
    campaignId: campaign.id,
    wallet: strOptions.wallet,
    discordUserId: strOptions.member,
  })
  if (!result.ok) return ephemeral(result.error)
  if (result.removed < 1) return ephemeral('No matching wallet on this list.')
  await refreshDiscordWlCampaignEmbedById(campaign.id)
  return ephemeral(`Removed ${result.removed} ${result.removed === 1 ? 'entry' : 'entries'} from **${campaign.name}**.`)
}

export async function handleDiscordWlCommand(interaction: DiscordInteraction): Promise<Record<string, unknown>> {
  const { sub, strOptions, numOptions, boolOptions } = getSubcommandAndOptions(interaction.data)
  if (sub === 'setup') return ephemeral(formatSetupChecklist())
  if (sub === 'create') return handleCreate(interaction, strOptions, numOptions)
  if (sub === 'set-role') return handleSetRole(interaction, strOptions, boolOptions)
  if (sub === 'open') return handleOpenClose(interaction, strOptions, 'open')
  if (sub === 'close') return handleOpenClose(interaction, strOptions, 'closed')
  if (sub === 'status') return handleStatus(interaction, strOptions)
  if (sub === 'list') return handleList(interaction)
  if (sub === 'export') return handleExport(interaction, strOptions)
  if (sub === 'push') return handlePush(interaction, strOptions)
  if (sub === 'remove') return handleRemove(interaction, strOptions)
  return ephemeral(
    `Unknown subcommand. Try \`/owltopia-wl setup\` — ${PLATFORM_NAME} whitelist collection.`
  )
}

export async function handleDiscordWlDeferred(interaction: DiscordInteraction): Promise<Record<string, unknown>> {
  if (interaction.type === 2 || interaction.data?.name === 'owltopia-wl') {
    return handleDiscordWlCommand(interaction)
  }
  const parsed = parseOwlwlCustomId(interaction.data?.custom_id)
  if (!parsed) return ephemeral('Unknown interaction.')

  const campaign = await getDiscordWlCampaignById(parsed.campaignId)
  if (!campaign) return ephemeral('This whitelist spot is no longer available.')

  if (parsed.action === 'confirm') {
    const linked = await getWalletAddressByDiscordUserId(discordUserId(interaction))
    if (!linked) {
      const state = generateDiscordMarketplaceLinkState(discordUserId(interaction))
      const connectUrl = `${getSiteBaseUrl()}/discord-shop/connect?state=${encodeURIComponent(state)}`
      return buildUnlinkedWalletChoicePayload({ campaignId: campaign.id, connectUrl })
    }
    return evaluateAndInsert({
      campaign,
      interaction,
      walletRaw: linked,
      source: 'linked_wallet',
    })
  }

  if (parsed.action === 'wallet') {
    return evaluateAndInsert({
      campaign,
      interaction,
      walletRaw: modalWalletValue(interaction),
      source: 'modal',
    })
  }

  return ephemeral('Unknown button.')
}
