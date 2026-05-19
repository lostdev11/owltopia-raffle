import type { Gen2DiscordRoleType } from '@/lib/db/discord-role-claims'
import { isWalletOnGen2Whitelist } from '@/lib/db/gen2-whitelist'
import { getBalanceByWallet } from '@/lib/gen2-presale/db'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

export type Gen2DiscordEligibility = {
  presale: boolean
  whitelist: boolean
  eligibleRoleTypes: Gen2DiscordRoleType[]
}

/** Presale qualified: at least one confirmed presale purchase (purchased_mints > 0). */
export async function walletQualifiesForGen2PresaleDiscord(wallet: string): Promise<boolean> {
  const w = normalizeSolanaWalletAddress(wallet)
  if (!w) return false
  const bal = await getBalanceByWallet(w)
  return (bal?.purchased_mints ?? 0) > 0
}

export async function walletQualifiesForGen2WhitelistDiscord(wallet: string): Promise<boolean> {
  const w = normalizeSolanaWalletAddress(wallet)
  if (!w) return false
  return isWalletOnGen2Whitelist(w)
}

export async function getGen2DiscordEligibility(wallet: string): Promise<Gen2DiscordEligibility> {
  const [presale, whitelist] = await Promise.all([
    walletQualifiesForGen2PresaleDiscord(wallet),
    walletQualifiesForGen2WhitelistDiscord(wallet),
  ])

  const eligibleRoleTypes: Gen2DiscordRoleType[] = []
  if (presale) eligibleRoleTypes.push('gen2_presale')
  if (whitelist) eligibleRoleTypes.push('gen2_whitelist')

  return { presale, whitelist, eligibleRoleTypes }
}

export function isValidGen2DiscordRoleType(value: string): value is Gen2DiscordRoleType {
  return value === 'gen2_presale' || value === 'gen2_whitelist'
}

export async function walletQualifiesForGen2DiscordRoleType(
  wallet: string,
  roleType: Gen2DiscordRoleType
): Promise<boolean> {
  if (roleType === 'gen2_presale') return walletQualifiesForGen2PresaleDiscord(wallet)
  return walletQualifiesForGen2WhitelistDiscord(wallet)
}
