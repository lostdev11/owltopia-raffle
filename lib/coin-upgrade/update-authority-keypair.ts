import { Keypair, PublicKey } from '@solana/web3.js'
import bs58 from 'bs58'
import { getCoinArtUpgradeAuthorityRow } from '@/lib/db/coin-art-upgrade-authority'

function parseSolanaSecretKey(raw: string | undefined | null): Keypair | null {
  const trimmed = raw?.trim()
  if (!trimmed) return null
  try {
    const parsed = JSON.parse(trimmed) as number[]
    if (Array.isArray(parsed) && parsed.length >= 64) {
      return Keypair.fromSecretKey(Uint8Array.from(parsed))
    }
  } catch {
    // not JSON
  }
  try {
    return Keypair.fromSecretKey(bs58.decode(trimmed))
  } catch {
    return null
  }
}

let cache: Keypair | null | undefined
let cacheSource: 'env' | 'database' | 'none' | undefined

export function clearCoinArtUpdateAuthorityKeypairCache(): void {
  cache = undefined
  cacheSource = undefined
}

function keypairFromEnv(): Keypair | null {
  const kp = parseSolanaSecretKey(process.env.COIN_ART_UPGRADE_AUTHORITY_SECRET_KEY)
  if (!kp) return null

  const expected = process.env.COIN_ART_UPGRADE_AUTHORITY_WALLET?.trim() || ''
  if (expected) {
    try {
      const want = new PublicKey(expected)
      if (!kp.publicKey.equals(want)) {
        console.warn(
          '[coin-upgrade] COIN_ART_UPGRADE_AUTHORITY_SECRET_KEY public key does not match COIN_ART_UPGRADE_AUTHORITY_WALLET.'
        )
        return null
      }
    } catch {
      return null
    }
  }
  return kp
}

/**
 * Sync env-only lookup (no DB). Prefer {@link resolveCoinArtUpdateAuthorityKeypair}
 * for runtime signing — that also loads the admin-generated DB hot key.
 */
export function getCoinArtUpdateAuthorityKeypairFromEnv(): Keypair | null {
  return keypairFromEnv()
}

/**
 * Signer for Owltopia coin MPL Core metadata (URI) updates.
 * Precedence: Vercel env secret → admin-generated DB hot key (Option A).
 */
export async function resolveCoinArtUpdateAuthorityKeypair(): Promise<Keypair | null> {
  if (cache !== undefined) return cache

  const fromEnv = keypairFromEnv()
  if (fromEnv) {
    cache = fromEnv
    cacheSource = 'env'
    return fromEnv
  }

  try {
    const row = await getCoinArtUpgradeAuthorityRow()
    const fromDb = parseSolanaSecretKey(row?.secret_key)
    if (fromDb && row?.wallet_address) {
      try {
        const want = new PublicKey(row.wallet_address.trim())
        if (!fromDb.publicKey.equals(want)) {
          console.warn(
            '[coin-upgrade] DB hot key secret does not match coin_art_upgrade_authority.wallet_address.'
          )
          cache = null
          cacheSource = 'none'
          return null
        }
      } catch {
        cache = null
        cacheSource = 'none'
        return null
      }
    }
    cache = fromDb
    cacheSource = fromDb ? 'database' : 'none'
    return fromDb
  } catch (e) {
    console.error('[coin-upgrade] failed to load DB hot key:', e)
    cache = null
    cacheSource = 'none'
    return null
  }
}

export async function resolveCoinArtUpdateAuthorityWallet(): Promise<string> {
  const configured = process.env.COIN_ART_UPGRADE_AUTHORITY_WALLET?.trim() || ''
  if (configured) return configured
  const kp = await resolveCoinArtUpdateAuthorityKeypair()
  return kp?.publicKey.toBase58() ?? ''
}

export async function resolveCoinArtUpdateAuthoritySource(): Promise<'env' | 'database' | 'none'> {
  await resolveCoinArtUpdateAuthorityKeypair()
  return cacheSource ?? 'none'
}

/** @deprecated Prefer resolveCoinArtUpdateAuthorityWallet — sync helper for env-only. */
export function getCoinArtUpdateAuthorityWallet(): string {
  const configured = process.env.COIN_ART_UPGRADE_AUTHORITY_WALLET?.trim() || ''
  if (configured) return configured
  return keypairFromEnv()?.publicKey.toBase58() ?? ''
}

/** @deprecated Prefer resolveCoinArtUpdateAuthorityKeypair. */
export function getCoinArtUpdateAuthorityKeypair(): Keypair | null {
  if (cache !== undefined) return cache
  return keypairFromEnv()
}
