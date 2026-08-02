'use client'

import { Connection, PublicKey } from '@solana/web3.js'
import {
  getAccount,
  getAssociatedTokenAddress,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token'

export type NftTransferBlockReason = 'frozen' | 'not_held' | 'invalid'

export type NftTransferableResult =
  | { ok: true; tokenAccount: PublicKey; tokenProgram: PublicKey }
  | { ok: false; reason: NftTransferBlockReason; error: string }

function assetLabel(mint: string, name?: string | null): string {
  const n = name?.trim()
  if (n) return n
  return mint.length > 8 ? `${mint.slice(0, 4)}…${mint.slice(-4)}` : mint
}

/**
 * Fast preflight: reject **frozen** token accounts (nested / mint-locked).
 * A leftover SPL delegate without freeze (common after Candy Machine thaw) does not block
 * owner transfers — do not treat that as staked/nested.
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
  const frozenMsg = `${assetLabel(mintStr, name)} is frozen on-chain (Owltopia nest lock or Gen2 Candy Machine mint freeze) — unnest/thaw before sending. A leftover stake delegate after thaw alone does not block sends.`

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
        info.value?.data as { parsed?: { info?: Record<string, unknown> } } | undefined
      )?.parsed?.info
      if (!parsed) {
        return {
          ok: false,
          reason: 'invalid',
          error: `${assetLabel(mintStr, name)} token account could not be parsed.`,
        }
      }
      const selectedMint = typeof parsed.mint === 'string' ? parsed.mint : null
      if (selectedMint !== mintStr) {
        return {
          ok: false,
          reason: 'not_held',
          error: `${assetLabel(mintStr, name)} is not in the selected token account.`,
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
          error: `${assetLabel(mintStr, name)} is not held in your wallet.`,
        }
      }
      const state = typeof parsed.state === 'string' ? parsed.state.toLowerCase() : ''
      if (state === 'frozen') {
        return { ok: false, reason: 'frozen', error: frozenMsg }
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
        return { ok: false, reason: 'frozen', error: frozenMsg }
      }
      return { ok: true, tokenAccount: ata, tokenProgram: programId }
    } catch {
      /* try next program */
    }
  }

  return {
    ok: false,
    reason: 'not_held',
    error: `${assetLabel(mintStr, name)} is not a transferable SPL hold in this wallet (may be Core/cNFT/pNFT — send alone).`,
  }
}

/** Preflight every line; returns blocking errors naming each frozen asset. */
export async function assertOwlSendLinesTransferable(params: {
  connection: Connection
  owner: PublicKey
  lines: Array<{ mint: string; tokenAccount?: string | null; name?: string | null }>
}): Promise<{ ok: true } | { ok: false; error: string; failedMints: string[] }> {
  const results = await Promise.all(
    params.lines.map((line) =>
      assertNftTransferable({
        connection: params.connection,
        mint: line.mint,
        owner: params.owner,
        tokenAccount: line.tokenAccount,
        name: line.name,
      }).then((result) => ({ line, result }))
    )
  )

  const failedMints: string[] = []
  const errors: string[] = []
  for (const { line, result } of results) {
    if (!result.ok && result.reason === 'frozen') {
      failedMints.push(line.mint)
      errors.push(result.error)
    }
  }
  if (errors.length === 0) return { ok: true }
  const more = errors.length > 3 ? ` (+${errors.length - 3} more)` : ''
  return {
    ok: false,
    error: `${errors.slice(0, 3).join(' ')}${more}`,
    failedMints,
  }
}
