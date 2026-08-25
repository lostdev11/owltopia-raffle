import { getSiteBaseUrl } from '@/lib/site-config'
import {
  discordWlEmbedColor,
  discordWlPhaseLabel,
  formatSpotsFilled,
  type DiscordWlCampaignStatus,
} from '@/lib/discord-wl/campaign-rules'
import { formatWalletShort } from '@/lib/discord-wl/wallet-input'

export const DISCORD_WL_ANTI_PHISHING_FOOTER =
  'Only use the Submit wallet button on this official Owltopia bot message. We never ask for SOL, seed phrases, or DMs.'

export const DISCORD_WL_ANNOUNCEMENT_SNIPPET =
  'Whitelist is open — tap **Submit wallet** on the pinned Owltopia message. One wallet per person, no fee. Do **not** post your address in chat.'

export function discordWlDashboardUrl(): string {
  return `${getSiteBaseUrl()}/partners/dashboard#wl-campaigns`
}

export function discordWlMintUrl(slug: string | null | undefined): string | null {
  const s = slug?.trim()
  if (!s) return null
  return `${getSiteBaseUrl()}/owl-center/collection/${encodeURIComponent(s)}`
}

export type DiscordWlEmbedCampaign = {
  name: string
  phaseKey: string
  status: DiscordWlCampaignStatus
  currentCount: number
  maxEntries: number | null
  requiredRoleName: string | null
  launchName: string | null
  launchSlug: string | null
}

export function buildDiscordWlPublicEmbed(campaign: DiscordWlEmbedCampaign): {
  title: string
  description: string
  color: number
  fields: { name: string; value: string; inline?: boolean }[]
  footer: { text: string }
} {
  const phaseLabel = discordWlPhaseLabel(campaign.phaseKey)
  const title = `${phaseLabel} Whitelist — ${campaign.name}`
  const full = campaign.maxEntries != null && campaign.currentCount >= campaign.maxEntries
  const closed = campaign.status !== 'open' || full
  const description = closed
    ? 'Submissions are closed. Mint list will be posted on Owltopia when ready.'
    : 'Tap **Submit wallet** below to register. One wallet per Discord account.'

  const statusValue = full ? 'Full' : campaign.status === 'open' ? 'Open' : campaign.status === 'closed' ? 'Closed' : 'Draft'
  const roleValue = campaign.requiredRoleName?.trim()
    ? `@${campaign.requiredRoleName.replace(/^@/, '')} role required`
    : 'Anyone in this server'

  const fields: { name: string; value: string; inline?: boolean }[] = [
    { name: 'Status', value: statusValue, inline: true },
    { name: 'Spots filled', value: formatSpotsFilled(campaign.currentCount, campaign.maxEntries), inline: true },
    { name: 'Phase', value: `${phaseLabel} allowlist`, inline: true },
    { name: 'Requirements', value: roleValue, inline: true },
  ]

  if (campaign.launchName) {
    const mintUrl = discordWlMintUrl(campaign.launchSlug)
    fields.push({
      name: 'Collection',
      value: mintUrl ? `[${campaign.launchName}](${mintUrl})` : campaign.launchName,
      inline: true,
    })
  }

  return {
    title,
    description,
    color: discordWlEmbedColor({
      status: campaign.status,
      currentCount: campaign.currentCount,
      maxEntries: campaign.maxEntries,
    }),
    fields,
    footer: { text: DISCORD_WL_ANTI_PHISHING_FOOTER.slice(0, 2048) },
  }
}

export function buildDiscordWlSubmitButtonRow(campaignId: number, disabled: boolean): Record<string, unknown> {
  return {
    type: 1,
    components: [
      {
        type: 2,
        style: disabled ? 2 : 3,
        label: disabled ? 'Submissions closed' : 'Submit wallet',
        custom_id: `owlwl:submit:${campaignId}`,
        disabled,
      },
    ],
  }
}

export function buildLinkedWalletConfirmPayload(input: {
  campaignId: number
  phaseLabel: string
  wallet: string
}): Record<string, unknown> {
  return {
    type: 4,
    data: {
      flags: 64,
      embeds: [
        {
          title: 'Confirm your whitelist spot',
          description: `Use linked wallet **${formatWalletShort(input.wallet)}** for **${input.phaseLabel} whitelist**?`,
          color: 0x00ff9c,
          footer: { text: 'Free to join · no payment · never share your seed phrase' },
        },
      ],
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 3,
              label: 'Yes, submit',
              custom_id: `owlwl:confirm:${input.campaignId}`,
            },
            {
              type: 2,
              style: 2,
              label: 'Use a different wallet',
              custom_id: `owlwl:modal:${input.campaignId}`,
            },
          ],
        },
      ],
    },
  }
}

export function buildUnlinkedWalletChoicePayload(input: {
  campaignId: number
  connectUrl: string
}): Record<string, unknown> {
  return {
    type: 4,
    data: {
      flags: 64,
      content:
        'Link a Solana wallet, or paste an address. We never ask for a seed phrase or payment to join.',
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 3,
              label: 'Enter wallet address',
              custom_id: `owlwl:modal:${input.campaignId}`,
            },
            {
              type: 2,
              style: 5,
              label: 'Link wallet on Owltopia',
              url: input.connectUrl,
            },
          ],
        },
      ],
    },
  }
}

export function buildWalletModal(campaignId: number): Record<string, unknown> {
  return {
    type: 9,
    data: {
      custom_id: `owlwl:wallet:${campaignId}`,
      title: 'Submit Solana wallet',
      components: [
        {
          type: 1,
          components: [
            {
              type: 4,
              custom_id: 'wallet',
              label: 'Wallet address',
              style: 1,
              min_length: 32,
              max_length: 64,
              required: true,
              placeholder: 'e.g. 7xK4…your Phantom address',
            },
          ],
        },
      ],
    },
  }
}

export function formatSubmitSuccessMessage(input: {
  phaseLabel: string
  wallet: string
  spots: number
}): string {
  return [
    '**You’re on the list**',
    '',
    `Phase: ${input.phaseLabel} · Wallet: **${formatWalletShort(input.wallet)}** · Spots: ${input.spots}`,
    'We’ll announce when mint opens on Owltopia.',
  ].join('\n')
}

export function formatPartnerLiveMessage(input: {
  channelId: string
  phaseLabel: string
  maxEntries: number | null
  spots: number
  requiredRoleName?: string | null
}): string {
  const cap = input.maxEntries != null ? String(input.maxEntries) : 'unlimited'
  const role = input.requiredRoleName?.trim()
  const roleLine = role
    ? `· Role gate: **@${role.replace(/^@/, '')}** required to submit`
    : '· Role gate: none (add with `role:` on create, or `/owltopia-wl set-role role:@YourRole`)'
  return [
    `Whitelist spot is live in <#${input.channelId}>`,
    `· Phase: ${input.phaseLabel} · Cap: ${cap} · ${input.spots} spot${input.spots === 1 ? '' : 's'} per wallet`,
    roleLine,
    '· Next: pin the message, announce in announcements',
    '· When ready: `/owltopia-wl close` then export or push',
    `Dashboard: ${discordWlDashboardUrl()}`,
  ].join('\n')
}

export function formatMissingPartnerTenantMessage(input: {
  hasPendingPayment: boolean
}): string {
  if (input.hasPendingPayment) {
    return [
      'This server still has a **legacy** Discord payment quote on file.',
      '',
      'Monthly Discord USDC renewals are **discontinued**. Partner Pro is a one-time setup.',
      'Ask Owltopia to link this Discord server in **Owl Vision → Partners** (wallet + server ID).',
      '',
      'Then run `/owltopia-wl create` again.',
    ].join('\n')
  }
  return [
    'This server is not linked for Partner Pro Discord tools yet.',
    '',
    'Partner Pro is a **one-time** setup — no monthly Discord subscribe/verify.',
    'Ask Owltopia to link your wallet + Discord **server ID** in Owl Vision → Partners.',
    '',
    'Then run `/owltopia-wl create` here.',
  ].join('\n')
}

export function formatSetupChecklist(): string {
  return [
    '**Set up a whitelist spot**',
    '',
    '0. Server must be linked for Partner Pro (Owl Vision → Partners → wallet + Discord server ID). One-time setup — no monthly Discord renewals.',
    '1. Run this in (or pick) your `#whitelist` channel (Text; turn off Send Messages for @everyone if you only want the button).',
    '2. Create with an optional **role gate**:',
    '   `/owltopia-wl create name:OG Whitelist phase:og role:@OG`',
    '   Already created? `/owltopia-wl set-role role:@OG`',
    '3. Pin the bot message. Share this with your community:',
    `> ${DISCORD_WL_ANNOUNCEMENT_SNIPPET}`,
    '4. When you’re done: `/owltopia-wl close`',
    `5. Download CSV or push to Owl Center from ${discordWlDashboardUrl()}`,
    '',
    'Members only tap **Submit wallet** — they never need a slash command.',
  ].join('\n')
}
