/**
 * Server-side thaw for OwlSend when Gen2 ATAs are still frozen after collection mint-out.
 *
 * Prefer nest FreezeDelegatedAccount thaw when Owltopia holds the lock and there is no
 * open nest position. Fall back to Candy Machine freezeSolPayment thaw for leftover mint freezes.
 */

import { getAnyOpenStakingPositionByAssetIdentifier } from '@/lib/db/staking-positions'
import { thawGen2AssetForOwner } from '@/lib/owl-center/gen2-freeze-thaw'
import {
  readSplTokenNestAccountState,
  thawSplTokenNestAccount,
} from '@/lib/solana/spl-token-nest-lock'
import { thawTokenMetadataNestAccount } from '@/lib/solana/token-metadata-nest-lock'

export type OwlSendThawMintKind =
  | 'already_thawed'
  | 'nest_thawed'
  | 'cm_thawed'
  | 'active_nest'
  | 'unsupported'
  | 'error'

export type OwlSendThawMintResult = {
  mint: string
  ok: boolean
  kind: OwlSendThawMintKind
  error?: string
  signature?: string | null
}

const MAX_THAW_PER_REQUEST = 5

export async function thawOwlSendFrozenNfts(params: {
  ownerWallet: string
  mints: string[]
}): Promise<{ results: OwlSendThawMintResult[]; thawedCount: number }> {
  const ownerWallet = params.ownerWallet.trim()
  const mints = [...new Set(params.mints.map((m) => m.trim()).filter(Boolean))].slice(
    0,
    MAX_THAW_PER_REQUEST
  )
  const results: OwlSendThawMintResult[] = []
  let thawedCount = 0

  for (const mint of mints) {
    const result = await thawOne({ mint, ownerWallet })
    results.push(result)
    if (result.ok && (result.kind === 'nest_thawed' || result.kind === 'cm_thawed')) {
      thawedCount += 1
    }
  }

  return { results, thawedCount }
}

async function thawOne(params: {
  mint: string
  ownerWallet: string
}): Promise<OwlSendThawMintResult> {
  const { mint, ownerWallet } = params

  let state
  try {
    state = await readSplTokenNestAccountState({ mint, ownerWallet })
  } catch (e) {
    return {
      mint,
      ok: false,
      kind: 'error',
      error: e instanceof Error ? e.message : 'Could not read token account.',
    }
  }

  if (!state.isFrozen) {
    return { mint, ok: true, kind: 'already_thawed', signature: null }
  }

  if (state.heldByNestingLock) {
    try {
      const open = await getAnyOpenStakingPositionByAssetIdentifier(mint)
      if (open) {
        return {
          mint,
          ok: false,
          kind: 'active_nest',
          error:
            'This Gen2 is still nested on Owltopia. Unnest it on Nesting first, then send.',
        }
      }
    } catch (e) {
      return {
        mint,
        ok: false,
        kind: 'error',
        error: e instanceof Error ? e.message : 'Could not check nest status.',
      }
    }

    try {
      if (state.nestingIsTokenDelegate) {
        const thawed = await thawTokenMetadataNestAccount({ mint, ownerWallet })
        return {
          mint,
          ok: true,
          kind: 'nest_thawed',
          signature: thawed.signature,
        }
      }
      if (state.nestingAuthorityCanFreeze) {
        const thawed = await thawSplTokenNestAccount({ mint, ownerWallet })
        return {
          mint,
          ok: true,
          kind: 'nest_thawed',
          signature: thawed.signature,
        }
      }
    } catch (e) {
      return {
        mint,
        ok: false,
        kind: 'error',
        error: e instanceof Error ? e.message : 'Nest thaw failed.',
      }
    }
  }

  // Leftover Candy Machine mint freeze (or unknown freeze with CM thaw path).
  try {
    const cm = await thawGen2AssetForOwner({ mint, ownerWallet })
    if (cm.thawed) {
      return { mint, ok: true, kind: 'cm_thawed', signature: cm.signature }
    }
    if (cm.skipped) {
      // Re-check — may already be transferable after a race.
      const again = await readSplTokenNestAccountState({ mint, ownerWallet })
      if (!again.isFrozen) {
        return { mint, ok: true, kind: 'already_thawed', signature: null }
      }
      return {
        mint,
        ok: false,
        kind: 'unsupported',
        error:
          'Still frozen on-chain and Owltopia cannot auto-thaw this lock. If nested, unnest first; otherwise contact support.',
      }
    }
    return {
      mint,
      ok: false,
      kind: 'error',
      error: cm.error || 'Candy Machine thaw failed.',
    }
  } catch (e) {
    return {
      mint,
      ok: false,
      kind: 'error',
      error: e instanceof Error ? e.message : 'Candy Machine thaw failed.',
    }
  }
}
