import type { Gen2DiscordRoleType } from '@/lib/db/discord-role-claims'
import { isWalletOnGen2Whitelist } from '@/lib/db/gen2-whitelist'
import { getPrimaryWalletForAddress, getWalletClusterAddresses } from '@/lib/db/wallet-links'
import { getBalanceByWallet } from '@/lib/gen2-presale/db'
import { isGen2PresalePaidParticipant } from '@/lib/gen2-presale/presale-participation'
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
  return isGen2PresalePaidParticipant(bal)
}

export async function walletQualifiesForGen2WhitelistDiscord(wallet: string): Promise<boolean> {
  const w = normalizeSolanaWalletAddress(wallet)
  if (!w) return false
  return isWalletOnGen2Whitelist(w)
}

/** Eligibility across primary + linked wallets. */
export async function getGen2DiscordEligibilityForCluster(primaryWallet: string): Promise<Gen2DiscordEligibility> {
  const cluster = await getWalletClusterAddresses(primaryWallet)
  let presale = false
  let whitelist = false
  for (const w of cluster) {
    if (!presale) presale = await walletQualifiesForGen2PresaleDiscord(w)
    if (!whitelist) whitelist = await walletQualifiesForGen2WhitelistDiscord(w)
    if (presale && whitelist) break
  }

  const eligibleRoleTypes: Gen2DiscordRoleType[] = []
  if (presale) eligibleRoleTypes.push('gen2_presale')
  if (whitelist) eligibleRoleTypes.push('gen2_whitelist')

  return { presale, whitelist, eligibleRoleTypes }
}

export async function getGen2DiscordEligibility(wallet: string): Promise<Gen2DiscordEligibility> {
  const primary = (await getPrimaryWalletForAddress(wallet)) ?? wallet
  return getGen2DiscordEligibilityForCluster(primary)
}

export function isValidGen2DiscordRoleType(value: string): value is Gen2DiscordRoleType {
  return value === 'gen2_presale' || value === 'gen2_whitelist'
}

export async function walletQualifiesForGen2DiscordRoleType(
  primaryWallet: string,
  roleType: Gen2DiscordRoleType
): Promise<boolean> {
  const { eligibleRoleTypes } = await getGen2DiscordEligibilityForCluster(primaryWallet)
  return eligibleRoleTypes.includes(roleType)
}
