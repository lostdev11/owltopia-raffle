'use client'

import { Connection, PublicKey } from '@solana/web3.js'
import {
  getAccount,
  getAssociatedTokenAddress,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token'

export type NftTransferBlockReason = 'frozen' | 'delegated' | 'not_held' | 'invalid'

export type NftTransferableResult =
  | { ok: true; tokenAccount: PublicKey; tokenProgram: PublicKey }
  | { ok: false; reason: NftTransferBlockReason; error: string }

function shortMint(mint: string): string {
  return mint.length > 8 ? `${mint.slice(0, 4)}…` : mint
}

function blockedMessage(mint: string, reason: 'frozen' | 'delegated'): string {
  const id = shortMint(mint)
  if (reason === 'frozen') {
    return `NFT ${id} is frozen (often nested) — unnest or thaw before sending.`
  }
  return `NFT ${id} is staked or nested (delegated) — unstake/unnest before sending.`
}

/**
 * Fast preflight: read the token account (hint or ATA) and reject frozen/delegated holdings
 * without multi-attempt holder lookup retries.
 */
export async function assertNftTransferable(params: {
  connection: Connection
  mint: string
  owner: PublicKey
  tokenAccount?: string | null
}): Promise<NftTransferableResult> {
  const mintPk = new PublicKey(params.mint)
  const mintStr = mintPk.toBase58()

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
          error: `NFT ${shortMint(mintStr)} token account is not a classic SPL / Token-2022 hold.`,
        }
      }
      const parsed = (
        info.value?.data as { parsed?: { info?: Record<string, unknown> } } | undefined
      )?.parsed?.info
      if (!parsed) {
        return {
          ok: false,
          reason: 'invalid',
          error: `NFT ${shortMint(mintStr)} token account could not be parsed.`,
        }
      }
      const selectedMint = typeof parsed.mint === 'string' ? parsed.mint : null
      if (selectedMint !== mintStr) {
        return {
          ok: false,
          reason: 'not_held',
          error: `NFT ${shortMint(mintStr)} is not in the selected token account.`,
        }
      }
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
      if (!Number.isFinite(amount) || amount < 1) {
        return {
          ok: false,
          reason: 'not_held',
          error: `NFT ${shortMint(mintStr)} is not held in your wallet.`,
        }
      }
      const state = typeof parsed.state === 'string' ? parsed.state.toLowerCase() : ''
      if (state === 'frozen') {
        return { ok: false, reason: 'frozen', error: blockedMessage(mintStr, 'frozen') }
      }
      const delegate = typeof parsed.delegate === 'string' ? parsed.delegate : null
      if (delegate) {
        return { ok: false, reason: 'delegated', error: blockedMessage(mintStr, 'delegated') }
      }
      return {
        ok: true,
        tokenAccount: ta,
        tokenProgram: isT22 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
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
      if (account.isFrozen) {
        return { ok: false, reason: 'frozen', error: blockedMessage(mintStr, 'frozen') }
      }
      if (account.delegate) {
        return { ok: false, reason: 'delegated', error: blockedMessage(mintStr, 'delegated') }
      }
      return { ok: true, tokenAccount: ata, tokenProgram: programId }
    } catch {
      /* try next program */
    }
  }

  return {
    ok: false,
    reason: 'not_held',
    error: `NFT ${shortMint(mintStr)} is not a transferable SPL hold in this wallet (may be Core/cNFT/pNFT — send alone).`,
  }
}

/** Preflight every line; returns the first blocking error or null. */
export async function assertOwlSendLinesTransferable(params: {
  connection: Connection
  owner: PublicKey
  lines: Array<{ mint: string; tokenAccount?: string | null; name?: string | null }>
}): Promise<{ ok: true } | { ok: false; error: string; failedMints: string[] }> {
  const failedMints: string[] = []
  const errors: string[] = []
  for (const line of params.lines) {
    const result = await assertNftTransferable({
      connection: params.connection,
      mint: line.mint,
      owner: params.owner,
      tokenAccount: line.tokenAccount,
    })
    if (!result.ok && (result.reason === 'frozen' || result.reason === 'delegated')) {
      failedMints.push(line.mint)
      errors.push(result.error)
    }
  }
  if (errors.length === 0) return { ok: true }
  return {
    ok: false,
    error: errors.slice(0, 3).join(' '),
    failedMints,
  }
}
