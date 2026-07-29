/**
 * On-chain validation that an address is a real SPL Token / Token-2022 mint.
 */

import { Connection, PublicKey } from '@solana/web3.js'
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getMint,
} from '@solana/spl-token'
import { resolveServerSolanaRpcUrl } from '@/lib/solana-rpc-url'
import { isProbableSolanaPubkey } from '@/lib/nesting/admin-quick-pool'

export type ResolvedSplMint = {
  mint: string
  decimals: number
  program: 'spl-token' | 'token-2022'
  supply: string
}

export type ResolveSplMintResult =
  | { ok: true; mint: ResolvedSplMint }
  | { ok: false; error: string }

/**
 * Confirm `mintAddress` exists on-chain as an SPL / Token-2022 mint account.
 * Rejects empty accounts, system accounts, and non-mint token accounts.
 */
export async function resolveSplMintOnChain(mintAddress: string): Promise<ResolveSplMintResult> {
  const raw = mintAddress.trim()
  if (!raw) return { ok: false, error: 'Token mint address is required.' }
  if (!isProbableSolanaPubkey(raw)) {
    return { ok: false, error: 'Token mint does not look like a Solana public key.' }
  }

  let mintPk: PublicKey
  try {
    mintPk = new PublicKey(raw)
  } catch {
    return { ok: false, error: 'Token mint is not a valid Solana address.' }
  }

  try {
    const connection = new Connection(resolveServerSolanaRpcUrl(), 'confirmed')
    const info = await connection.getAccountInfo(mintPk, 'confirmed')
    if (!info) {
      return {
        ok: false,
        error: 'No account found at this mint address on Solana. Double-check the token mint.',
      }
    }

    let program: 'spl-token' | 'token-2022'
    let programId: typeof TOKEN_PROGRAM_ID | typeof TOKEN_2022_PROGRAM_ID
    if (info.owner.equals(TOKEN_PROGRAM_ID)) {
      program = 'spl-token'
      programId = TOKEN_PROGRAM_ID
    } else if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) {
      program = 'token-2022'
      programId = TOKEN_2022_PROGRAM_ID
    } else {
      return {
        ok: false,
        error:
          'This address is not an SPL Token or Token-2022 mint. Paste the token mint (not a wallet or NFT asset id).',
      }
    }

    const mintInfo = await getMint(connection, mintPk, 'confirmed', programId)
    return {
      ok: true,
      mint: {
        mint: mintPk.toBase58(),
        decimals: mintInfo.decimals,
        program,
        supply: mintInfo.supply.toString(),
      },
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      ok: false,
      error: `Could not verify token mint on-chain: ${msg}`,
    }
  }
}
