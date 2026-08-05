'use client'

import { Connection, PublicKey } from '@solana/web3.js'
import {
  AccountLayout,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token'
import type { OwlSendLine } from '@/lib/owl-send/batch'

/** SPL AccountState.Frozen */
const ACCOUNT_STATE_FROZEN = 2

function assetLabel(mint: string, name?: string | null): string {
  const n = name?.trim()
  if (n) return n
  return mint.length > 8 ? `${mint.slice(0, 4)}…${mint.slice(-4)}` : mint
}

/**
 * When a batch fails, only attribute failure to mints that are frozen on-chain.
 * Otherwise keep the full batch (wallet reject / RPC / size errors).
 */
export function attributeOwlSendFrozenFailures(params: {
  lines: Array<{ mint: string; name?: string | null }>
  frozenMints: Iterable<string>
  baseError: string
}): { error: string; failedMints: string[] } {
  const frozenSet = new Set(
    [...params.frozenMints].map((m) => m.trim()).filter(Boolean)
  )
  const frozenLines = params.lines.filter((l) => frozenSet.has(l.mint.trim()))
  if (frozenLines.length < 1) {
    return {
      error: params.baseError,
      failedMints: params.lines.map((l) => l.mint),
    }
  }

  const labels = frozenLines.map((l) => assetLabel(l.mint, l.name))
  const labelText = labels.join(', ')
  const verb = labels.length === 1 ? 'is' : 'are'
  const pronoun = labels.length === 1 ? 'it' : 'them'
  return {
    error: `${labelText} ${verb} nested/frozen — remove or unnest ${pronoun}; the others are fine.`,
    failedMints: frozenLines.map((l) => l.mint),
  }
}

function decodeFrozen(data: Buffer | Uint8Array | undefined): boolean {
  if (!data || data.length < AccountLayout.span) return false
  try {
    const decoded = AccountLayout.decode(data)
    return Number(decoded.state) === ACCOUNT_STATE_FROZEN
  } catch {
    return false
  }
}

function classicAtaForMint(mint: string, owner: PublicKey): PublicKey | null {
  try {
    return getAssociatedTokenAddressSync(
      new PublicKey(mint),
      owner,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    )
  } catch {
    return null
  }
}

/**
 * Read freeze state for OwlSend batch source token accounts (one RPC).
 * Prefers real ATA hints; when DAS left tokenAccount=mint, derives the classic Gen2 ATA.
 */
export async function findFrozenOwlSendMints(params: {
  connection: Connection
  lines: OwlSendLine[]
  /** Required to derive classic ATAs when DAS left tokenAccount=mint. */
  owner?: PublicKey
  /** Optional pre-resolved source token accounts (mint → ATA). */
  resolvedTokenAccounts?: Map<string, PublicKey>
}): Promise<string[]> {
  const { connection, lines, owner, resolvedTokenAccounts } = params
  const lookups: Array<{ mint: string; tokenAccount: PublicKey }> = []
  const seen = new Set<string>()

  for (const line of lines) {
    const mint = line.mint.trim()
    if (!mint || seen.has(mint)) continue

    const resolved = resolvedTokenAccounts?.get(mint)
    if (resolved) {
      lookups.push({ mint, tokenAccount: resolved })
      seen.add(mint)
      continue
    }

    const hint = line.tokenAccount?.trim() || ''
    if (hint && hint !== mint) {
      try {
        lookups.push({ mint, tokenAccount: new PublicKey(hint) })
        seen.add(mint)
        continue
      } catch {
        /* fall through to derive */
      }
    }

    if (owner) {
      const ata = classicAtaForMint(mint, owner)
      if (ata) {
        lookups.push({ mint, tokenAccount: ata })
        seen.add(mint)
      }
    }
  }

  if (lookups.length < 1) return []

  try {
    const infos = await connection.getMultipleAccountsInfo(
      lookups.map((l) => l.tokenAccount),
      'processed'
    )
    const frozen: string[] = []
    for (let i = 0; i < lookups.length; i++) {
      const info = infos[i]
      if (!info) continue
      const isTokenProg =
        info.owner.equals(TOKEN_PROGRAM_ID) || info.owner.equals(TOKEN_2022_PROGRAM_ID)
      if (!isTokenProg) continue
      if (decodeFrozen(info.data)) frozen.push(lookups[i]!.mint)
    }
    return frozen
  } catch {
    return []
  }
}
