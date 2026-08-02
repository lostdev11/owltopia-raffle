'use client'

import { Connection, PublicKey } from '@solana/web3.js'
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAccount,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token'

export type OwlSendSplHolder = {
  tokenProgram: PublicKey
  tokenAccount: PublicKey
}

/** When DAS left tokenAccount=mint, use the classic SPL ATA (Gen2 hold). */
export function owlSendTokenAccountHint(params: {
  mint: string
  owner: PublicKey
  tokenAccount?: string | null
}): string {
  const mint = params.mint.trim()
  const hint = params.tokenAccount?.trim() || ''
  if (hint && hint !== mint) return hint
  try {
    return getAssociatedTokenAddressSync(
      new PublicKey(mint),
      params.owner,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    ).toBase58()
  } catch {
    return hint || mint
  }
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
 * Resolve an SPL / Token-2022 hold for OwlSend (all Gen2s are classic SPL ATAs).
 *
 * - Accepts leftover CM/nest delegates (owner can still transfer).
 * - Prefers derived ATA (deterministic) before mint-filter RPC.
 * - When RPC verify flakes, trusts a non-mint picker hint or derived classic ATA.
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

  const classicAta = getAssociatedTokenAddressSync(
    mint,
    owner,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  )
  const t22Ata = getAssociatedTokenAddressSync(
    mint,
    owner,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  )

  // 1) Explicit hint (server-enriched ATA from /api/wallet/nfts)
  if (hint && hint !== mintStr) {
    try {
      const ta = new PublicKey(hint)
      for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
        const hit = await readHolderAt(connection, mint, ta, programId)
        if (hit) return hit
      }
      // RPC flake: Gen2 / classic SPL ATAs match the deterministic address — trust classic ATA hint.
      if (ta.equals(classicAta)) {
        return { tokenProgram: TOKEN_PROGRAM_ID, tokenAccount: ta }
      }
      if (ta.equals(t22Ata)) {
        return { tokenProgram: TOKEN_2022_PROGRAM_ID, tokenAccount: ta }
      }
      // Non-ATA hint from RPC scan — still trust after verify failed (common mobile rate limits).
      return { tokenProgram: TOKEN_PROGRAM_ID, tokenAccount: ta }
    } catch {
      /* invalid hint */
    }
  }

  // 2) Deterministic ATAs (Gen2 Candy Machine holds live here)
  {
    const classic = await readHolderAt(connection, mint, classicAta, TOKEN_PROGRAM_ID)
    if (classic) return classic
    const t22 = await readHolderAt(connection, mint, t22Ata, TOKEN_2022_PROGRAM_ID)
    if (t22) return t22
  }

  // 3) Mint-filtered wallet scan (non-ATA holds)
  try {
    const byMint = await connection.getParsedTokenAccountsByOwner(owner, { mint }, 'confirmed')
    for (const { pubkey, account } of byMint.value) {
      const info = account.data?.parsed?.info
      if (!info || (info.mint as string) !== mintStr) continue
      const programOwner = account.owner
      const isT22 = programOwner.equals(TOKEN_2022_PROGRAM_ID)
      const isSpl = programOwner.equals(TOKEN_PROGRAM_ID)
      if (!isT22 && !isSpl) continue
      const amountRaw = info.tokenAmount?.amount
      const amount =
        typeof amountRaw === 'string'
          ? Number(amountRaw)
          : typeof amountRaw === 'number'
            ? amountRaw
            : 0
      if (!Number.isFinite(amount) || amount < 1) continue
      return {
        tokenProgram: isT22 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
        tokenAccount: pubkey,
      }
    }
  } catch {
    /* fall through */
  }

  // 4) Last resort: Gen2s are classic ATAs — use derived address when DAS only gave mint.
  // Transfer will fail on-chain if the account is empty; better than false Core/pNFT soft-block.
  return { tokenProgram: TOKEN_PROGRAM_ID, tokenAccount: classicAta }
}
