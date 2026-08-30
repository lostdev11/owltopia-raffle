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
import { prependOwlSendComputeBudget } from '@/lib/owl-send/compute-budget'
import { getOwlSendFeeLamportsForCount } from '@/lib/owl-send/fee'
import { OWL_SEND_MAX_PER_TX } from '@/lib/owl-send/constants'
import type { OwlSendLine } from '@/lib/owl-send/batch'
import { isOwlSendPacketSizeError, owlSendTxFitsSafePacket } from '@/lib/owl-send/tx-size'
import {
  attributeOwlSendFrozenFailures,
  findFrozenOwlSendMints,
} from '@/lib/owl-send/attribute-batch-failure'
import {
  resolveMintTokenProgram,
  resolveOwlSendSplHolder,
} from '@/lib/owl-send/resolve-spl-holder'
import {
  isOwlSendFrozenTransferError,
  isOwlSendWalletExtensionError,
  owlSendWalletExtensionHint,
} from '@/lib/owl-send/wallet-send-errors'
import { assertWalletReadyForSigning } from '@/lib/solana/assert-wallet-ready-for-signing'
import {
  assertTransactionSimulatesClean,
  isPhantomPresimulateError,
} from '@/lib/solana/phantom-presimulate'
import { sendTransactionWithTimeout } from '@/lib/solana/send-transaction-with-timeout'
import { tokenRecordAccountExists } from '@/lib/solana/nft-transfer-lock'

export type OwlSendBatchResult =
  | { ok: true; signature: string; newAtaCount: number; sentMints?: string[] }
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

export async function buildOwlSendSplNftTransaction(params: {
  connection: Connection
  owner: PublicKey
  lines: OwlSendLine[]
  /** Owltopia holder discount (bps). */
  feeDiscountBps?: number
  /**
   * Skip the OwlSend platform fee (e.g. admin packs vault deposit).
   * Transfers only — no treasury SystemProgram.transfer.
   */
  omitPlatformFee?: boolean
}): Promise<
  | { ok: true; tx: Transaction; newAtaCount: number; includedCount: number }
  | { ok: false; error: string; failedMints: string[] }
> {
  const { connection, owner, lines } = params
  const treasury = getPlatformFeeTreasuryWalletAddressClient()
  const feeLamports = params.omitPlatformFee
    ? 0
    : getOwlSendFeeLamportsForCount(lines.length, params.feeDiscountBps ?? 0)
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
        // Mint owner is authoritative — never create a dest ATA with the wrong program
        // (classic Token CPI against a Token-2022 mint → IncorrectProgramId).
        const mintProgram = await resolveMintTokenProgram(connection, mintPk)
        const tokenProgram =
          mintProgram && !mintProgram.equals(holder.tokenProgram)
            ? mintProgram
            : holder.tokenProgram
        const destAta = await getAssociatedTokenAddress(
          mintPk,
          recipientPk,
          false,
          tokenProgram,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
        return {
          ok: true as const,
          value: {
            mintPk,
            recipientPk,
            line,
            tokenProgram,
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

  // Fail during "building" if any source ATA is nest-locked frozen — do not enter
  // "Approve in wallet". pNFT rule-set freeze (Token Record) is NOT a nest lock —
  // route those to the Token Metadata special path instead of "Account is frozen".
  const sourceInfos = await connection.getMultipleAccountsInfo(
    resolved.map((r) => r.tokenAccount),
    'processed'
  )
  const frozenCandidates: string[] = []
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
        frozenCandidates.push(r.line.mint.trim())
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
  if (frozenCandidates.length > 0) {
    const nestLocked: string[] = []
    const pnftFrozen: string[] = []
    await Promise.all(
      frozenCandidates.map(async (mint) => {
        const row = resolved.find((r) => r.line.mint.trim() === mint)
        if (!row) {
          nestLocked.push(mint)
          return
        }
        try {
          const isPnft = await tokenRecordAccountExists(
            connection,
            row.mintPk,
            row.tokenAccount,
            'processed'
          )
          if (isPnft) pnftFrozen.push(mint)
          else nestLocked.push(mint)
        } catch {
          nestLocked.push(mint)
        }
      })
    )
    if (nestLocked.length > 0) {
      return {
        ok: false,
        ...attributeOwlSendFrozenFailures({
          lines,
          frozenMints: nestLocked,
          baseError: 'Account is frozen',
        }),
      }
    }
    if (pnftFrozen.length > 0) {
      const labels = lines
        .filter((l) => pnftFrozen.includes(l.mint.trim()))
        .map((l) => l.name?.trim() || `${l.mint.slice(0, 4)}…${l.mint.slice(-4)}`)
      return {
        ok: false,
        error:
          pnftFrozen.length === 1 && lines.length === 1
            ? `${labels[0] ?? 'This NFT'} is a pNFT (Token Metadata) — use the single-NFT send path.`
            : `${labels.join(', ') || 'pNFT(s)'} need a separate pNFT send (Token Metadata). Deselect and send alone.`,
        failedMints: pnftFrozen,
      }
    }
  }

  // One RPC for all destination ATAs (processed = faster; missing → create ATA ix).
  const destInfos = await connection.getMultipleAccountsInfo(
    resolved.map((r) => r.destAta),
    'processed'
  )

  // Attach blockhash once so Phantom/adapter do not hang on getLatestBlockhash during "approve".
  const { blockhash } = await connection.getLatestBlockhash('processed')

  const assemble = (count: number, includeRevoke: boolean) => {
    const slice = resolved.slice(0, count)
    const sliceFee = params.omitPlatformFee
      ? 0
      : getOwlSendFeeLamportsForCount(slice.length, params.feeDiscountBps ?? 0)
    const tx = new Transaction()
    let newAtaCount = 0

    for (let i = 0; i < slice.length; i++) {
      const r = slice[i]!
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

      if (includeRevoke && revokeIndexes.has(i)) {
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

    if (sliceFee > 0 && treasury) {
      tx.add(
        SystemProgram.transfer({
          fromPubkey: owner,
          toPubkey: new PublicKey(treasury),
          lamports: sliceFee,
        })
      )
    }

    // Raise CU above the 200k default — revoke+ATA+transfer otherwise fails wallet sim
    // (Jupiter/Phantom never show approve).
    prependOwlSendComputeBudget(tx)
    tx.feePayer = owner
    tx.recentBlockhash = blockhash
    return { tx, newAtaCount }
  }

  // Fit under the safe packet budget so Jupiter/Phantom Lighthouse ixs still fit.
  // Drop leftover-CM revokes first (owner can transfer without revoke); then peel NFTs.
  let includedCount = resolved.length
  let includeRevoke = true
  let assembled = assemble(includedCount, includeRevoke)
  while (includedCount > 1 && !owlSendTxFitsSafePacket(assembled.tx)) {
    if (includeRevoke) {
      includeRevoke = false
      assembled = assemble(includedCount, false)
      continue
    }
    includedCount -= 1
    includeRevoke = true
    assembled = assemble(includedCount, true)
  }

  return { ok: true, tx: assembled.tx, newAtaCount: assembled.newAtaCount, includedCount }
}

function humanizeOwlSendSendError(msg: string): string {
  const m = (msg ?? '').toLowerCase()
  if (
    m.includes('computational budget') ||
    m.includes('programfailedtocomplete') ||
    m.includes('exceeded cu') ||
    m.includes('exceeded the compute')
  ) {
    return 'This approval needs more compute than Solana\'s default budget. Hard-refresh OwlSend and retry — batches now request a higher compute limit.'
  }
  // ATA Create against a non-SPL mint (cNFT asset id) or Token vs Token-2022 mismatch.
  // Keep wording broad so single-NFT send can fall through to Bubblegum / Core / TM.
  if (
    m.includes('incorrectprogramid') ||
    m.includes('incorrect program id')
  ) {
    return (
      'This NFT is not a classic SPL hold (cNFT / Core / Token-2022 mismatch). ' +
      'OwlSend will retry the compressed / Core / Token Metadata path — or send it alone.'
    )
  }
  return msg
}

/**
 * Send classic SPL / Token-2022 NFTs + Owl fee in one wallet approval.
 * Shrinks the packet (drop leftover-CM revokes, then peel NFTs) so Jupiter/Phantom
 * Lighthouse guards still fit under Solana's 1232-byte limit.
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
  /** Skip OwlSend platform fee (packs vault deposit). */
  omitPlatformFee?: boolean
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
        omitPlatformFee: params.omitPlatformFee,
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

    // Simulate for every wallet (not only Phantom) so Jupiter does not silently
    // skip the approve sheet on a doomed batch (frozen / CU / bad accounts).
    try {
      await assertTransactionSimulatesClean(connection, built.tx, {
        failMessagePrefix: 'This send would fail on-chain before wallet approval. ',
        ignoreRpcErrors: true,
      })
    } catch (e) {
      if (isPhantomPresimulateError(e)) {
        const simMsg = humanizeOwlSendSendError(e.message)
        if (isOwlSendFrozenTransferError(simMsg)) {
          try {
            const frozenMints = await findFrozenOwlSendMints({ connection, lines, owner })
            if (frozenMints.length > 0) {
              return {
                ok: false,
                ...attributeOwlSendFrozenFailures({
                  lines,
                  frozenMints,
                  baseError: simMsg,
                }),
              }
            }
          } catch {
            /* fall through */
          }
        }
        return { ok: false, error: simMsg, failedMints: [] }
      }
      throw e
    }

    onPhase?.('approving')
    // Let React paint "Approve in wallet" before we open the provider (esp. mobile).
    await new Promise<void>((resolve) => setTimeout(resolve, 50))
    const signature = await sendTransactionWithTimeout(sendTransaction, built.tx, connection, {
      // Pre-sign simulate is handled above / in the Phantom path; skip RPC preflight on submit
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
    return {
      ok: true,
      signature,
      newAtaCount: built.newAtaCount,
      sentMints: lines.slice(0, built.includedCount).map((l) => l.mint),
    }
  } catch (e) {
    const msg = humanizeOwlSendSendError(e instanceof Error ? e.message : String(e))
    if (isOwlSendPacketSizeError(msg) || /too large|versionedtransaction too large|transaction too large/i.test(msg)) {
      return {
        ok: false,
        error:
          'This batch does not fit in one Solana transaction (often when sending Gen2s to new wallets). OwlSend will use a smaller approval — tap Retry.',
        failedMints: [],
      }
    }

    if (isOwlSendWalletExtensionError(msg)) {
      return {
        ok: false,
        error: owlSendWalletExtensionHint(params.walletAdapter?.name ?? null),
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
