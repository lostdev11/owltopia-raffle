'use client'

import { Connection, PublicKey } from '@solana/web3.js'
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAccount,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token'
import { getNftHolderInWallet } from '@/lib/solana/wallet-tokens'

export type OwlSendSplHolder = {
  tokenProgram: PublicKey
  tokenAccount: PublicKey
}

/**
 * Source of truth for ATA create / transfer: the mint account's owner program.
 * Using classic SPL when the mint is Token-2022 (or vice versa) yields
 * `IncorrectProgramId` on Associated Token Account Create — the Viking OwlSend failure.
 */
export async function resolveMintTokenProgram(
  connection: Connection,
  mint: PublicKey,
  commitment: 'processed' | 'confirmed' | 'finalized' = 'processed'
): Promise<typeof TOKEN_PROGRAM_ID | typeof TOKEN_2022_PROGRAM_ID | null> {
  try {
    const info = await connection.getAccountInfo(mint, commitment)
    if (!info) {
      try {
        const retry = await connection.getAccountInfo(mint, 'confirmed')
        if (!retry) return null
        if (retry.owner.equals(TOKEN_PROGRAM_ID)) return TOKEN_PROGRAM_ID
        if (retry.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID
        return null
      } catch {
        return null
      }
    }
    if (info.owner.equals(TOKEN_PROGRAM_ID)) return TOKEN_PROGRAM_ID
    if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID
    return null
  } catch {
    return null
  }
}

function ataForProgram(mint: PublicKey, owner: PublicKey, programId: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(
    mint,
    owner,
    false,
    programId,
    ASSOCIATED_TOKEN_PROGRAM_ID
  )
}

/**
 * When DAS left tokenAccount=mint, keep the mint id.
 * Do **not** invent a classic SPL ATA here — that address is wrong for Token-2022
 * and previously caused OwlSend to create destination ATAs with the wrong program.
 * {@link resolveOwlSendSplHolder} derives the correct program ATA from mint owner.
 */
export function owlSendTokenAccountHint(params: {
  mint: string
  owner: PublicKey
  tokenAccount?: string | null
}): string {
  const mint = params.mint.trim()
  const hint = params.tokenAccount?.trim() || ''
  if (hint && hint !== mint) return hint
  return mint
}

async function readHolderAt(
  connection: Connection,
  mint: PublicKey,
  tokenAccount: PublicKey,
  programId: PublicKey
): Promise<OwlSendSplHolder | null> {
  try {
    const account = await getAccount(connection, tokenAccount, 'processed', programId)
    if (account.mint.equals(mint) && account.amount >= 1n) {
      return { tokenProgram: programId, tokenAccount }
    }
  } catch {
    try {
      const account = await getAccount(connection, tokenAccount, 'confirmed', programId)
      if (account.mint.equals(mint) && account.amount >= 1n) {
        return { tokenProgram: programId, tokenAccount }
      }
    } catch {
      /* not this program / missing */
    }
  }
  return null
}

/**
 * Resolve an SPL / Token-2022 hold for OwlSend.
 *
 * - Token program comes from the **mint account owner** whenever possible.
 * - Accepts leftover CM/nest delegates (owner can still transfer).
 * - Prefers derived ATA (deterministic) before mint-filter RPC.
 * - Never trusts a classic-SPL ATA fallback for a Token-2022 mint (IncorrectProgramId).
 */
export async function resolveOwlSendSplHolder(params: {
  connection: Connection
  mint: PublicKey
  owner: PublicKey
  hintTokenAccount?: string | null
}): Promise<OwlSendSplHolder | null> {
  const { connection, mint, owner } = params
  const mintStr = mint.toBase58()
  const hint = params.hintTokenAccount?.trim() || null

  const mintProgram = await resolveMintTokenProgram(connection, mint)
  const classicAta = ataForProgram(mint, owner, TOKEN_PROGRAM_ID)
  const t22Ata = ataForProgram(mint, owner, TOKEN_2022_PROGRAM_ID)
  const preferredPrograms: PublicKey[] = mintProgram
    ? [mintProgram]
    : [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]

  // 1) Explicit hint (server-enriched ATA from /api/wallet/nfts)
  if (hint && hint !== mintStr) {
    try {
      const ta = new PublicKey(hint)
      for (const programId of preferredPrograms) {
        const hit = await readHolderAt(connection, mint, ta, programId)
        if (hit) return hit
      }
      // Also try the other program if mint owner was unknown / RPC flake on mint.
      if (!mintProgram) {
        for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
          const hit = await readHolderAt(connection, mint, ta, programId)
          if (hit) return hit
        }
      }

      // RPC flake: only trust deterministic ATA + matching mint program.
      if (mintProgram) {
        const expectedAta = ataForProgram(mint, owner, mintProgram)
        if (ta.equals(expectedAta)) {
          return { tokenProgram: mintProgram, tokenAccount: ta }
        }
        // Non-ATA token account from RPC scan — still bind to mint's program.
        return { tokenProgram: mintProgram, tokenAccount: ta }
      }
      if (ta.equals(classicAta)) {
        return { tokenProgram: TOKEN_PROGRAM_ID, tokenAccount: ta }
      }
      if (ta.equals(t22Ata)) {
        return { tokenProgram: TOKEN_2022_PROGRAM_ID, tokenAccount: ta }
      }
      // Unknown mint program + non-ATA hint: do not guess classic SPL (Token-2022 hazard).
    } catch {
      /* invalid hint */
    }
  }

  // 2) Deterministic ATAs for the mint's program (Gen2 Candy Machine holds live on classic).
  for (const programId of preferredPrograms) {
    const ata = ataForProgram(mint, owner, programId)
    const hit = await readHolderAt(connection, mint, ata, programId)
    if (hit) return hit
  }

  // 3) Shared wallet holder lookup (now accepts leftover Gen2 CM delegates).
  try {
    const h = await getNftHolderInWallet(connection, mint, owner, 'confirmed')
    if (h && 'tokenProgram' in h && 'tokenAccount' in h) {
      // Prefer mint-owner program when holder RPC disagrees (stale / wrong program).
      if (mintProgram && !h.tokenProgram.equals(mintProgram)) {
        const correctedAta = ataForProgram(mint, owner, mintProgram)
        const corrected = await readHolderAt(connection, mint, correctedAta, mintProgram)
        if (corrected) return corrected
        return { tokenProgram: mintProgram, tokenAccount: h.tokenAccount }
      }
      return { tokenProgram: h.tokenProgram, tokenAccount: h.tokenAccount }
    }
  } catch {
    /* fall through */
  }

  // 4) Last resort: derive ATA for the mint's real program (never invent classic for T22).
  if (mintProgram) {
    return {
      tokenProgram: mintProgram,
      tokenAccount: ataForProgram(mint, owner, mintProgram),
    }
  }
  // Mint account unreadable — Gen2s are overwhelmingly classic SPL; transfer fails if empty.
  return { tokenProgram: TOKEN_PROGRAM_ID, tokenAccount: classicAta }
}
