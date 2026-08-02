'use client'

import { Connection, PublicKey } from '@solana/web3.js'
import {
  getAccount,
  getAssociatedTokenAddress,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token'

export type NftTransferBlockReason = 'not_held' | 'invalid'

export type NftTransferableResult =
  | { ok: true; tokenAccount: PublicKey; tokenProgram: PublicKey }
  | { ok: false; reason: NftTransferBlockReason; error: string }

function assetLabel(mint: string, name?: string | null): string {
  const n = name?.trim()
  if (n) return n
  return mint.length > 8 ? `${mint.slice(0, 4)}…${mint.slice(-4)}` : mint
}

/**
 * Resolve a classic SPL / Token-2022 hold for OwlSend.
 *
 * Do **not** soft-block on frozen/delegated here — the token program rejects non-transferable
 * accounts on-chain. Leftover Gen2 CM delegates after thaw are sendable; true freeze/stake
 * locks fail at simulation/confirm anyway.
 */
export async function assertNftTransferable(params: {
  connection: Connection
  mint: string
  owner: PublicKey
  tokenAccount?: string | null
  name?: string | null
}): Promise<NftTransferableResult> {
  const mintPk = new PublicKey(params.mint)
  const mintStr = mintPk.toBase58()
  const name = params.name

  if (params.tokenAccount && params.tokenAccount !== mintStr) {
    try {
      const ta = new PublicKey(params.tokenAccount)
      const info = await params.connection.getParsedAccountInfo(ta, 'processed')
      const ownerProgram = info.value?.owner
      const isSpl = ownerProgram?.equals(TOKEN_PROGRAM_ID) ?? false
      const isT22 = ownerProgram?.equals(TOKEN_2022_PROGRAM_ID) ?? false
      if (!isSpl && !isT22) {
        return {
          ok: false,
          reason: 'invalid',
          error: `${assetLabel(mintStr, name)} token account is not a classic SPL / Token-2022 hold.`,
        }
      }
      const parsed = (
        info.value?.data as { parsed?: { info?: Record<string, unknown> } | undefined } | undefined
      )?.parsed?.info
      if (!parsed) {
        return {
          ok: false,
          reason: 'invalid',
          error: `${assetLabel(mintStr, name)} token account could not be parsed.`,
        }
      }
      const selectedMint = typeof parsed.mint === 'string' ? parsed.mint : null
      const amountRaw =
        typeof parsed.tokenAmount === 'object' && parsed.tokenAmount
          ? (parsed.tokenAmount as { amount?: unknown }).amount
          : undefined
      const amount =
        typeof amountRaw === 'string'
          ? Number(amountRaw)
          : typeof amountRaw === 'number'
            ? amountRaw
            : 0
      // Stale/wrong picker hints must fall through to ATA / mint-filter — do not hard-fail.
      if (selectedMint === mintStr && Number.isFinite(amount) && amount >= 1) {
        return {
          ok: true,
          tokenAccount: ta,
          tokenProgram: isT22 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
        }
      }
    } catch {
      /* fall through to ATA probe */
    }
  }

  for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    try {
      const ata = await getAssociatedTokenAddress(mintPk, params.owner, false, programId)
      const account = await getAccount(params.connection, ata, 'processed', programId)
      if (account.amount < 1n) continue
      return { ok: true, tokenAccount: ata, tokenProgram: programId }
    } catch {
      /* try next program */
    }
  }

  return {
    ok: false,
    reason: 'not_held',
    error: `${assetLabel(mintStr, name)} is not a classic SPL hold in this wallet (may be Core/cNFT/pNFT — send alone).`,
  }
}

/**
 * Kept for call-site compatibility. Freeze/stake is enforced on-chain at transfer time —
 * this preflight does not soft-block those states.
 */
export async function assertOwlSendLinesTransferable(_params: {
  connection: Connection
  owner: PublicKey
  lines: Array<{ mint: string; tokenAccount?: string | null; name?: string | null }>
}): Promise<{ ok: true } | { ok: false; error: string; failedMints: string[] }> {
  return { ok: true }
}
