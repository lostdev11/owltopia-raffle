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
}): string {
  const cap = input.maxEntries != null ? String(input.maxEntries) : 'unlimited'
  return [
    `Whitelist spot is live in <#${input.channelId}>`,
    `· Phase: ${input.phaseLabel} · Cap: ${cap} · ${input.spots} spot${input.spots === 1 ? '' : 's'} per wallet`,
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
      'Payment is still **pending verification** for this server.',
      '',
      'After your USDC transfer confirms, run:',
      '`/owltopia-partner verify signature:<your_tx_signature>`',
      '',
      'Use the Solana transaction signature (Solscan link or Phantom history). The payment must include the exact `OWLGW:…` memo from your subscribe quote.',
      '',
      'Then run `/owltopia-wl create` again.',
    ].join('\n')
  }
  return [
    'This server needs an active Owltopia Discord partner subscription before whitelist spots work.',
    '',
    '1. `/owltopia-partner subscribe` — pay the USDC quote **with the exact memo** in the same transaction',
    '2. `/owltopia-partner verify signature:<your_tx_signature>` — activates this server',
    '3. `/owltopia-wl create` — open your whitelist spot',
    '',
    'Partner Pro on the website alone is not enough until Discord payment is verified here. Ask Owltopia support if your Discord was already linked by the team.',
  ].join('\n')
}

export function formatSetupChecklist(): string {
  return [
    '**Set up a whitelist spot**',
    '',
    '0. If this server is new to Owltopia Discord tools: `/owltopia-partner subscribe` → pay with memo → `/owltopia-partner verify signature:…` (paying alone does not activate).',
    '1. Run this in (or pick) your `#whitelist` channel.',
    '2. `/owltopia-wl create name:OG Whitelist phase:og` — defaults: this channel, unlimited cap, 1 mint spot.',
    '3. Pin the bot message. Share this with your community:',
    `> ${DISCORD_WL_ANNOUNCEMENT_SNIPPET}`,
    '4. When you’re done: `/owltopia-wl close`',
    `5. Download CSV or push to Owl Center from ${discordWlDashboardUrl()}`,
    '',
    'Members only tap **Submit wallet** — they never need a slash command.',
  ].join('\n')
}
