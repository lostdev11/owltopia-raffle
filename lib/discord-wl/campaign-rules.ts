import { PARTNER_ALLOWLIST_PRESETS } from '@/lib/owl-center/partner-allowlist-phases'
import { formatWalletShort, parseDiscordWlWalletInput } from '@/lib/discord-wl/wallet-input'

export type DiscordWlCampaignStatus = 'draft' | 'open' | 'closed'

export type DiscordWlSubmitDecision =
  | { ok: true; wallet: string }
  | {
      ok: false
      code: 'invalid' | 'evm' | 'closed' | 'full' | 'missing_role' | 'already' | 'wallet_taken'
      message: string
      existingWallet?: string
    }

export function discordWlPhaseLabel(phaseKey: string): string {
  const key = phaseKey.trim().toLowerCase()
  const preset = PARTNER_ALLOWLIST_PRESETS.find((p) => p.key === key)
  if (preset) return preset.label
  if (!key) return 'Whitelist'
  return key.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function isDiscordWlFull(maxEntries: number | null | undefined, currentCount: number): boolean {
  if (maxEntries == null || maxEntries <= 0) return false
  return currentCount >= maxEntries
}

export function isDiscordWlAlmostFull(
  maxEntries: number | null | undefined,
  currentCount: number
): boolean {
  if (maxEntries == null || maxEntries <= 0) return false
  return currentCount / maxEntries >= 0.9 && currentCount < maxEntries
}

export function discordWlMemberHasRequiredRole(
  requiredRoleId: string | null | undefined,
  memberRoleIds: string[]
): boolean {
  const need = requiredRoleId?.trim()
  if (!need) return true
  return memberRoleIds.some((id) => id.trim() === need)
}

export function evaluateDiscordWlSubmit(input: {
  status: DiscordWlCampaignStatus
  maxEntries: number | null
  currentCount: number
  requiredRoleId: string | null
  requiredRoleName: string | null
  memberRoleIds: string[]
  existingByUserWallet: string | null
  existingWalletOwnerUserId: string | null
  discordUserId: string
  walletRaw: string
}): DiscordWlSubmitDecision {
  if (input.status !== 'open') {
    return {
      ok: false,
      code: 'closed',
      message: 'This whitelist is **closed**. Watch announcements for the mint link.',
    }
  }
  if (isDiscordWlFull(input.maxEntries, input.currentCount)) {
    const cap = input.maxEntries ?? 0
    return {
      ok: false,
      code: 'full',
      message: `This list is **full** (${cap}/${cap}). Thanks for your interest!`,
    }
  }
  if (!discordWlMemberHasRequiredRole(input.requiredRoleId, input.memberRoleIds)) {
    const role = input.requiredRoleName?.trim()
    const label = role ? `@${role.replace(/^@/, '')}` : 'the required'
    return {
      ok: false,
      code: 'missing_role',
      message: `You need the **${label}** role to join this list. Ask a mod if you should have it.`,
    }
  }
  if (input.existingByUserWallet) {
    return {
      ok: false,
      code: 'already',
      message: `You’re already on this list with **${formatWalletShort(input.existingByUserWallet)}**.`,
      existingWallet: input.existingByUserWallet,
    }
  }

  const parsed = parseDiscordWlWalletInput(input.walletRaw)
  if (!parsed.ok) {
    return { ok: false, code: parsed.code, message: parsed.message }
  }

  const owner = input.existingWalletOwnerUserId?.trim()
  if (owner && owner !== input.discordUserId.trim()) {
    return {
      ok: false,
      code: 'wallet_taken',
      message: 'That wallet is already registered on this list by another account.',
    }
  }

  return { ok: true, wallet: parsed.wallet }
}

export function shouldRefreshCampaignEmbed(input: {
  previousCount: number
  nextCount: number
  becameClosed: boolean
  becameOpen: boolean
  maxEntries: number | null
}): boolean {
  if (input.becameClosed || input.becameOpen) return true
  // Always refresh when the registered count changes so small partner lists
  // don't stay stuck at "0 registered" until the next 10-signup bucket.
  if (input.previousCount !== input.nextCount) return true
  return false
}

export function discordWlEmbedColor(input: {
  status: DiscordWlCampaignStatus
  currentCount: number
  maxEntries: number | null
}): number {
  if (input.status !== 'open' || isDiscordWlFull(input.maxEntries, input.currentCount)) {
    return 0x5c6773
  }
  if (isDiscordWlAlmostFull(input.maxEntries, input.currentCount)) {
    return 0xffd769
  }
  return 0x00ff9c
}

export function formatSpotsFilled(currentCount: number, maxEntries: number | null): string {
  if (maxEntries != null && maxEntries > 0) {
    const full = currentCount >= maxEntries
    return full ? `${maxEntries} / ${maxEntries} · Full` : `${currentCount} / ${maxEntries}`
  }
  return `${currentCount} registered`
}

export function formatCampaignListLine(input: {
  name: string
  channelId: string
  status: DiscordWlCampaignStatus
  currentCount: number
  maxEntries: number | null
}): string {
  const statusLabel = input.status === 'open' ? 'Open' : input.status === 'closed' ? 'Closed' : 'Draft'
  return `${input.name} · <#${input.channelId}> · ${statusLabel} · ${formatSpotsFilled(input.currentCount, input.maxEntries)}`
}
