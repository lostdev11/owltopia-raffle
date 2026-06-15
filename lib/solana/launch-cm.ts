import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'
import { resolvePublicSolanaRpcUrl, sanitizeRpcUrl } from '@/lib/solana-rpc-url'
import { isDevnetMintEnabled, type OwlMintNetwork } from '@/lib/solana/network'
import { sanitizeLaunchMintPubkey } from '@/lib/solana/validate-pubkey'

type LaunchCmFields = Pick<
  OwlCenterLaunchPublic,
  | 'slug'
  | 'mint_mode'
  | 'mint_network'
  | 'candy_machine_id'
  | 'collection_mint'
  | 'devnet_candy_machine_id'
  | 'devnet_collection_mint'
>

function envForSlug(slug: string, key: 'CM' | 'COLLECTION', network: OwlMintNetwork): string {
  const slugKey = slug.toUpperCase().replace(/[^A-Z0-9]/g, '_')
  const net = network === 'devnet' ? 'DEVNET_' : ''
  const suffix = key === 'CM' ? 'CANDY_MACHINE_ID' : 'COLLECTION_MINT'
  const specific = process.env[`NEXT_PUBLIC_OWL_CENTER_${slugKey}_${net}${suffix}`]?.trim()
  if (specific) return specific
  if (slug === 'demo') {
    const demo = process.env[`NEXT_PUBLIC_OWL_CENTER_DEMO_${net}${suffix}`]?.trim()
    if (demo) return demo
  }
  return ''
}

/** Per-launch cluster — public_simple defaults to mainnet unless mint_network is set. */
export function resolveLaunchMintNetwork(launch: Pick<OwlCenterLaunchPublic, 'mint_mode' | 'mint_network'>): OwlMintNetwork {
  const explicit = launch.mint_network
  if (explicit === 'devnet' || explicit === 'mainnet') return explicit
  if (launch.mint_mode === 'public_simple') return 'mainnet'
  return isDevnetMintEnabled() ? 'devnet' : 'mainnet'
}

export function getLaunchCandyMachineId(launch: LaunchCmFields, network?: OwlMintNetwork): string {
  const net = network ?? resolveLaunchMintNetwork(launch)
  const raw =
    net === 'devnet'
      ? launch.devnet_candy_machine_id?.trim() || envForSlug(launch.slug, 'CM', 'devnet') || ''
      : launch.candy_machine_id?.trim() || envForSlug(launch.slug, 'CM', 'mainnet') || ''
  return sanitizeLaunchMintPubkey(raw) ?? ''
}

export function getLaunchCollectionMint(launch: LaunchCmFields, network?: OwlMintNetwork): string {
  const net = network ?? resolveLaunchMintNetwork(launch)
  const raw =
    net === 'devnet'
      ? launch.devnet_collection_mint?.trim() || envForSlug(launch.slug, 'COLLECTION', 'devnet') || ''
      : launch.collection_mint?.trim() || envForSlug(launch.slug, 'COLLECTION', 'mainnet') || ''
  return sanitizeLaunchMintPubkey(raw) ?? ''
}

export function launchMintInfraConfigured(launch: LaunchCmFields): boolean {
  const net = resolveLaunchMintNetwork(launch)
  return Boolean(getLaunchCandyMachineId(launch, net) && getLaunchCollectionMint(launch, net))
}

/** Browser RPC for Owl Center candy-machine mints (same-origin proxy on production). */
export function resolveOwlCenterMintRpcUrl(): string {
  if (typeof window === 'undefined') {
    return resolvePublicSolanaRpcUrl()
  }
  const direct = process.env.NEXT_PUBLIC_MINT_SOLANA_RPC_URL?.trim()
  if (direct) return sanitizeRpcUrl(direct)
  // Umi / web3.js Connection reject relative paths ("Endpoint URL must start with http: or https:").
  return `${window.location.origin}/api/solana/rpc`
}

/** Browser/server RPC for a specific launch mint (respects per-launch network). */
export function getLaunchSolanaRpcUrl(network: OwlMintNetwork): string {
  if (network === 'devnet') {
    const u = process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() || process.env.SOLANA_RPC_DEVNET_URL?.trim()
    return u ? sanitizeRpcUrl(u) : 'https://api.devnet.solana.com'
  }
  return resolveOwlCenterMintRpcUrl()
}
