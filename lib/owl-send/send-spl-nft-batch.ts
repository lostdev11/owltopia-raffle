'use client'

import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js'
import type { WalletAdapter } from '@solana/wallet-adapter-base'
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  AccountLayout,
  createAssociatedTokenAccountInstruction,
  createRevokeInstruction,
  createTransferInstruction,
  getAssociatedTokenAddress,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token'
import { confirmSignatureSuccessOnChain } from '@/lib/solana/confirm-signature-success'
import type { WalletSendTransactionFn } from '@/lib/solana/send-umi-builder-via-wallet'
import { getPlatformFeeTreasuryWalletAddressClient } from '@/lib/solana/platform-fee-treasury-wallet'
import {
  OWL_SEND_BUILD_TIMEOUT_HINT,
  OWL_SEND_BUILD_TIMEOUT_MS,
  OWL_SEND_CONFIRM_TIMEOUT_HINT,
  OWL_SEND_CONFIRM_TIMEOUT_MS,
  withOwlSendTimeout,
} from '@/lib/owl-send/confirm'
import { getOwlSendFeeLamportsForCount } from '@/lib/owl-send/fee'
import { OWL_SEND_MAX_PER_TX } from '@/lib/owl-send/constants'
import type { OwlSendLine } from '@/lib/owl-send/batch'
import {
  attributeOwlSendFrozenFailures,
  findFrozenOwlSendMints,
} from '@/lib/owl-send/attribute-batch-failure'
import { resolveOwlSendSplHolder } from '@/lib/owl-send/resolve-spl-holder'
import {
  isOwlSendFrozenTransferError,
  isOwlSendWalletExtensionError,
  owlSendWalletExtensionHint,
} from '@/lib/owl-send/wallet-send-errors'
import { assertWalletReadyForSigning } from '@/lib/solana/assert-wallet-ready-for-signing'
import { sendTransactionWithTimeout } from '@/lib/solana/send-transaction-with-timeout'

export type OwlSendBatchResult =
  | { ok: true; signature: string; newAtaCount: number }
  | { ok: false; error: string; failedMints?: string[] }

/** UI phases while a batch is in flight (wallet approve → RPC confirm). */
export type OwlSendSendPhase = 'building' | 'approving' | 'confirming'

type ResolvedHolder = {
  mintPk: PublicKey
  recipientPk: PublicKey
  line: OwlSendLine
  tokenProgram: PublicKey
  tokenAccount: PublicKey
  destAta: PublicKey
}

async function resolveHolder(
  connection: Connection,
  mint: PublicKey,
  owner: PublicKey,
  hintTokenAccount?: string | null,
  _name?: string | null
) {
  return resolveOwlSendSplHolder({
    connection,
    mint,
    owner,
    hintTokenAccount,
  })
}

async function buildOwlSendSplNftTransaction(params: {
  connection: Connection
  owner: PublicKey
  lines: OwlSendLine[]
  /** Owltopia holder discount (bps). */
  feeDiscountBps?: number
}): Promise<
  | { ok: true; tx: Transaction; newAtaCount: number }
  | { ok: false; error: string; failedMints: string[] }
> {
  const { connection, owner, lines } = params
  const treasury = getPlatformFeeTreasuryWalletAddressClient()
  const feeLamports = getOwlSendFeeLamportsForCount(lines.length, params.feeDiscountBps ?? 0)
  if (feeLamports > 0 && !treasury) {
    return {
      ok: false,
      error: 'OwlSend fee treasury is not configured (NEXT_PUBLIC_OWL_PLATFORM_FEE_TREASURY_WALLET).',
      failedMints: [],
    }
  }

  const resolved: ResolvedHolder[] = []
  const holderResults = await Promise.all(
    lines.map(async (line) => {
      let mintPk: PublicKey
      let recipientPk: PublicKey
      try {
        mintPk = new PublicKey(line.mint.trim())
        recipientPk = new PublicKey(line.recipient.trim())
      } catch {
        return {
          ok: false as const,
          mint: line.mint,
          error: `Invalid mint or recipient for ${line.name ?? line.mint}.`,
        }
      }

      try {
        const holder = await resolveHolder(
          connection,
          mintPk,
          owner,
          line.tokenAccount,
          line.name
        )
        if (!holder) {
          return {
            ok: false as const,
            mint: line.mint,
            error: `Could not find a transferable SPL token account for ${line.name ?? line.mint.slice(0, 8)}. Compressed / Core / pNFTs may need a single-NFT send.`,
          }
        }
        const destAta = await getAssociatedTokenAddress(
          mintPk,
          recipientPk,
          false,
          holder.tokenProgram,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
        return {
          ok: true as const,
          value: {
            mintPk,
            recipientPk,
            line,
            tokenProgram: holder.tokenProgram,
            tokenAccount: holder.tokenAccount,
            destAta,
          },
        }
      } catch (e) {
        return {
          ok: false as const,
          mint: line.mint,
          error: e instanceof Error ? e.message : String(e),
        }
      }
    })
  )

  for (const result of holderResults) {
    if (!result.ok) {
      return { ok: false, error: result.error, failedMints: [result.mint] }
    }
    resolved.push(result.value)
  }

  // Fail during "building" if any source ATA is frozen — do not enter "Approve in wallet"
  // (Phantom pre-sim would reject and never show a popup, which looks like a wallet bug).
  const sourceInfos = await connection.getMultipleAccountsInfo(
    resolved.map((r) => r.tokenAccount),
    'processed'
  )
  const frozenMints: string[] = []
  const revokeIndexes = new Set<number>()
  const ACCOUNT_STATE_FROZEN = 2
  for (let i = 0; i < resolved.length; i++) {
    const info = sourceInfos[i]
    const r = resolved[i]!
    if (!info) continue
    const isTokenProg =
      info.owner.equals(TOKEN_PROGRAM_ID) || info.owner.equals(TOKEN_2022_PROGRAM_ID)
    if (!isTokenProg || info.data.length < AccountLayout.span) continue
    try {
      const decoded = AccountLayout.decode(info.data)
      if (Number(decoded.state) === ACCOUNT_STATE_FROZEN) {
        frozenMints.push(r.line.mint.trim())
        continue
      }
      // Gen2 freezeSolPayment thaw often leaves a dead CM freeze-escrow delegate.
      // Revoke in the same approval so wallets/Blowfish don't treat it as still staked.
      if (decoded.delegateOption && decoded.delegate) {
        revokeIndexes.add(i)
      }
    } catch {
      /* ignore decode errors */
    }
  }
  if (frozenMints.length > 0) {
    return {
      ok: false,
      ...attributeOwlSendFrozenFailures({
        lines,
        frozenMints,
        baseError: 'Account is frozen',
      }),
    }
  }

  // One RPC for all destination ATAs (processed = faster; missing → create ATA ix).
  const destInfos = await connection.getMultipleAccountsInfo(
    resolved.map((r) => r.destAta),
    'processed'
  )

  const tx = new Transaction()
  let newAtaCount = 0

  for (let i = 0; i < resolved.length; i++) {
    const r = resolved[i]!
    const info = destInfos[i]
    const ownerProgram = info?.owner
    const hasAta =
      !!info &&
      (ownerProgram?.equals(TOKEN_PROGRAM_ID) || ownerProgram?.equals(TOKEN_2022_PROGRAM_ID))

    if (!hasAta) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          owner,
          r.destAta,
          r.recipientPk,
          r.mintPk,
          r.tokenProgram,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      )
      newAtaCount += 1
    }

    if (revokeIndexes.has(i)) {
      tx.add(createRevokeInstruction(r.tokenAccount, owner, [], r.tokenProgram))
    }

    tx.add(
      createTransferInstruction(
        r.tokenAccount,
        r.destAta,
        owner,
        1n,
        [],
        r.tokenProgram
      )
    )
  }

  if (feeLamports > 0 && treasury) {
    tx.add(
      SystemProgram.transfer({
        fromPubkey: owner,
        toPubkey: new PublicKey(treasury),
        lamports: feeLamports,
      })
    )
  }

  // Attach blockhash here so Phantom/adapter do not hang on getLatestBlockhash during "approve".
  tx.feePayer = owner
  const { blockhash } = await connection.getLatestBlockhash('processed')
  tx.recentBlockhash = blockhash

  return { ok: true, tx, newAtaCount }
}

/**
 * Send up to 5 classic SPL / Token-2022 NFTs + Owl fee in one wallet approval.
 * Returns an error if any asset is not a simple SPL hold (pNFT/Core/cNFT need the special path).
 */
export async function sendOwlSendSplNftBatch(params: {
  connection: Connection
  owner: PublicKey
  sendTransaction: WalletSendTransactionFn
  lines: OwlSendLine[]
  onPhase?: (phase: OwlSendSendPhase) => void
  /** Owltopia holder discount (bps). */
  feeDiscountBps?: number
  /** When set, fail fast if Phantom's injected provider is unreachable (no popup). */
  walletAdapter?: WalletAdapter | null
}): Promise<OwlSendBatchResult> {
  const { connection, owner, sendTransaction, lines, onPhase } = params
  if (lines.length < 1) return { ok: false, error: 'Nothing to send in this batch.' }
  if (lines.length > OWL_SEND_MAX_PER_TX) {
    return {
      ok: false,
      error: `This batch has ${lines.length} NFTs — max ${OWL_SEND_MAX_PER_TX} per approval.`,
    }
  }

  onPhase?.('building')

  let built: Awaited<ReturnType<typeof buildOwlSendSplNftTransaction>>
  try {
    built = await withOwlSendTimeout(
      buildOwlSendSplNftTransaction({
        connection,
        owner,
        lines,
        feeDiscountBps: params.feeDiscountBps,
      }),
      OWL_SEND_BUILD_TIMEOUT_MS,
      OWL_SEND_BUILD_TIMEOUT_HINT
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg || OWL_SEND_BUILD_TIMEOUT_HINT, failedMints: lines.map((l) => l.mint) }
  }

  if (!built.ok) {
    return { ok: false, error: built.error, failedMints: built.failedMints }
  }

  try {
    // Catch broken Phantom extension before we paint "Approve in wallet…" with no popup.
    await assertWalletReadyForSigning({
      connected: true,
      publicKey: owner,
      walletAdapter: params.walletAdapter ?? null,
      connection,
    })

    onPhase?.('approving')
    // Let React paint "Approve in wallet" before we open the provider (esp. mobile).
    await new Promise<void>((resolve) => setTimeout(resolve, 50))
    const signature = await sendTransactionWithTimeout(sendTransaction, built.tx, connection, {
      // Pre-sign simulate is handled (with timeout) in the Phantom path; skip RPC preflight on submit
      // so a second slow simulate cannot block after the user already approved.
      skipPreflight: true,
      preflightCommitment: 'processed',
      maxRetries: 3,
      timeoutMs: 60_000,
    })
    onPhase?.('confirming')
    await confirmSignatureSuccessOnChain(
      connection,
      signature,
      OWL_SEND_CONFIRM_TIMEOUT_MS,
      OWL_SEND_CONFIRM_TIMEOUT_HINT
    )
    return { ok: true, signature, newAtaCount: built.newAtaCount }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/too large|versionedtransaction too large|transaction too large/i.test(msg)) {
      return {
        ok: false,
        error:
          'This batch does not fit in one Solana transaction (often when many new token accounts are created). Remove an NFT or send to wallets that already hold that collection, then retry.',
        failedMints: lines.map((l) => l.mint),
      }
    }

    if (isOwlSendWalletExtensionError(msg)) {
      return {
        ok: false,
        error: owlSendWalletExtensionHint(),
        // Do not amber-highlight sendable Gen2s for a Phantom channel failure.
        failedMints: [],
      }
    }

    if (/timed out|timeout|AbortError|wallet approval/i.test(msg)) {
      return {
        ok: false,
        error: msg,
        failedMints: [],
      }
    }

    const baseError = msg || 'Wallet rejected or send failed.'

    // Only re-attribute to frozen mints when the failure itself looks like a freeze reject.
    // Wallet/extension/timeout errors must not be blamed on a coincidental frozen NFT.
    if (isOwlSendFrozenTransferError(baseError)) {
      try {
        const frozenMints = await findFrozenOwlSendMints({ connection, lines, owner })
        if (frozenMints.length > 0) {
          return {
            ok: false,
            ...attributeOwlSendFrozenFailures({ lines, frozenMints, baseError }),
          }
        }
      } catch {
        /* keep full-batch attribution */
      }
    }

    // Generic wallet/send failure — keep the error, but don't mark leftover CM-delegate
    // Gen2s as "problem NFTs" unless we proved a specific mint failed.
    return { ok: false, error: baseError, failedMints: [] }
  }
}
