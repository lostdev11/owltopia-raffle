import { getGen2CandyMachineId, getGen2CollectionMint } from '@/lib/solana/network'

type OwlCenterMintInfraLaunch = {
  is_paused: boolean
  candy_machine_id?: string | null
  collection_mint?: string | null
  devnet_candy_machine_id?: string | null
  devnet_collection_mint?: string | null
}

function readBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (!raw) return fallback
  const value = raw.trim().toLowerCase()
  if (value === 'true' || value === '1' || value === 'yes') return true
  if (value === 'false' || value === '0' || value === 'no') return false
  return fallback
}

function owlCenterMintDisabledEnvRaw(): string | undefined {
  if (typeof process === 'undefined') return undefined
  return process.env['OWL_CENTER_' + 'MINT_DISABLED']
}

/**
 * When true (`OWL_CENTER_MINT_DISABLED=true`), Gen2 mint is blocked server-side regardless of admin UI.
 * Use for incidents or deploy safety; cannot be overridden by unpausing in Owl Center admin.
 */
export function isOwlCenterMintEnvKillSwitchEnabled(): boolean {
  return readBoolean(owlCenterMintDisabledEnvRaw(), false)
}

/**
 * Gen2 public mint is sold out — mint ops (cosign, backstop, phase advance, reprice, mint CTAs)
 * are soft-retired. Post-mint tools (thaw, ledger, nesting, marketplace) stay active.
 *
 * Emergency re-open only: set `GEN2_PUBLIC_MINT_ENABLED=true` in the deployment env.
 */
export function isGen2PublicMintRetired(): boolean {
  if (typeof process === 'undefined') return true
  return !readBoolean(process.env.GEN2_PUBLIC_MINT_ENABLED, false)
}

/** JSON body for Gen2 mint endpoints that must no longer accept new mints. */
export function gen2MintRetiredResponseBody() {
  return {
    error: 'gen2_mint_retired',
    message: 'Owltopia Gen2 mint is sold out. Mint tools are retired.',
    sold_out: true,
  } as const
}

export type OwlCenterMintControls = {
  /** True when mint must not proceed (env kill switch or admin pause). */
  disabled: boolean
  env_kill_switch: boolean
  admin_paused: boolean
}

export function buildOwlCenterMintControls(adminPaused: boolean): OwlCenterMintControls {
  const env_kill_switch = isOwlCenterMintEnvKillSwitchEnabled()
  return {
    env_kill_switch,
    admin_paused: adminPaused,
    disabled: env_kill_switch || adminPaused,
  }
}

export function isOwlCenterMintGloballyDisabled(adminPaused: boolean): boolean {
  return buildOwlCenterMintControls(adminPaused).disabled
}

/** True when mint can proceed: not paused/kill-switched and Candy Machine + collection are configured. */
export function isOwlCenterMintOperational(launch: OwlCenterMintInfraLaunch): boolean {
  if (isOwlCenterMintGloballyDisabled(launch.is_paused)) return false
  return Boolean(getGen2CandyMachineId(launch)?.trim() && getGen2CollectionMint(launch)?.trim())
}
