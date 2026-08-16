/**
 * Rebuild OwlSend ledger lines from a confirmed transaction signature.
 * Used to recover Core (and classic NFT) sends that succeeded on-chain but
 * never landed in owl_send_ledger (e.g. pre–Core-verify bug).
 */
import { Connection, PublicKey } from '@solana/web3.js'
import { getTransactionCached } from '@/lib/solana-rpc-transaction-cache'
import { resolveServerSolanaRpcUrl } from '@/lib/solana-rpc-url'
import { getFullAccountKeysForTransaction } from '@/lib/verify-transaction'
import { getPlatformFeeTreasuryWalletAddress } from '@/lib/solana/platform-fee-treasury-wallet'
import { getOwlSendFeeLamports } from '@/lib/owl-send/fee'
import {
  describeInvalidSolanaTxSignatureInput,
  isValidSolanaTxSignatureBase58,
  normalizeDepositTxSignatureInput,
} from '@/lib/raffles/verify-prize-deposit-client'
import {
  collectMplCoreTransferV1FromTx,
  type MplCoreLedgerTxShape,
} from '@/lib/owl-send/mpl-core-ledger-transfers'
import type {
  OwlSendLedgerAssetKind,
  OwlSendLedgerLine,
  OwlSendLedgerMode,
} from '@/lib/db/owl-send-ledger'

export type RecoverOwlSendLedgerDraft = {
  txSignature: string
  fromWallet: string
  mode: OwlSendLedgerMode
  assetKind: OwlSendLedgerAssetKind
  lines: OwlSendLedgerLine[]
  /** Observed Owl fee to treasury in this tx (lamports). */
  feeLamports: number
}

export type RecoverOwlSendLedgerResult =
  | { ok: true; draft: RecoverOwlSendLedgerDraft }
  | { ok: false; error: string }

type TokenBalRow = {
  owner?: string
  mint?: string
  uiTokenAmount?: { amount?: string; decimals?: number }
}

function balMap(rows: TokenBalRow[]): Map<string, { amount: bigint; decimals: number }> {
  const m = new Map<string, { amount: bigint; decimals: number }>()
  for (const row of rows) {
    const owner = typeof row.owner === 'string' ? row.owner : ''
    const mint = typeof row.mint === 'string' ? row.mint : ''
    if (!owner || !mint) continue
    const amount = BigInt(row.uiTokenAmount?.amount ?? '0')
    const decimals = typeof row.uiTokenAmount?.decimals === 'number' ? row.uiTokenAmount.decimals : 0
    const key = `${owner}|${mint}`
    const prev = m.get(key)
    m.set(key, {
      amount: (prev?.amount ?? 0n) + amount,
      decimals: prev?.decimals ?? decimals,
    })
  }
  return m
}

/**
 * Infer outbound transfers from `fromWallet` in a confirmed tx:
 * - MPL Core TransferV1 where payer/authority is fromWallet
 * - SPL / Token-2022 balance deltas (mint left fromWallet, arrived at recipient)
 */
export function buildOwlSendLedgerDraftFromTx(params: {
  signature: string
  fromWallet: string
  transaction: {
    transaction: { message: unknown }
    meta: NonNullable<
      NonNullable<Awaited<ReturnType<Connection['getTransaction']>>>['meta']
    >
  }
}): RecoverOwlSendLedgerResult {
  const fromWallet = params.fromWallet.trim()
  let fromPk: PublicKey
  try {
    fromPk = new PublicKey(fromWallet)
  } catch {
    return { ok: false, error: 'Invalid from wallet.' }
  }

  const { transaction } = params
  if (transaction.meta.err) {
    return { ok: false, error: 'Transaction failed on-chain.' }
  }

  const keys = getFullAccountKeysForTransaction({
    transaction: transaction.transaction,
    meta: transaction.meta,
  })
  const feePayer = keys[0]
  if (!feePayer || !feePayer.equals(fromPk)) {
    return { ok: false, error: 'Transaction fee payer does not match signed-in wallet.' }
  }

  const lines: OwlSendLedgerLine[] = []
  const seen = new Set<string>()

  const coreTransfers = collectMplCoreTransferV1FromTx(
    {
      transaction: transaction.transaction,
      meta: transaction.meta,
    } as MplCoreLedgerTxShape,
    keys
  )
  for (const t of coreTransfers) {
    if (t.payer !== fromWallet && t.authority !== fromWallet) continue
    if (t.newOwner === fromWallet) continue
    const key = `${t.newOwner}|${t.asset}`
    if (seen.has(key)) continue
    seen.add(key)
    lines.push({
      recipient: t.newOwner,
      mint: t.asset,
      name: null,
      amount_raw: '1',
      decimals: 0,
      symbol: null,
    })
  }

  const pre = balMap((transaction.meta.preTokenBalances ?? []) as TokenBalRow[])
  const post = balMap((transaction.meta.postTokenBalances ?? []) as TokenBalRow[])
  const allKeys = new Set([...pre.keys(), ...post.keys()])

  // Mints the sender lost (or reduced)
  const senderLosses = new Map<string, bigint>()
  for (const key of allKeys) {
    const [owner, mint] = key.split('|')
    if (owner !== fromWallet || !mint) continue
    const before = pre.get(key)?.amount ?? 0n
    const after = post.get(key)?.amount ?? 0n
    const loss = before - after
    if (loss > 0n) senderLosses.set(mint, (senderLosses.get(mint) ?? 0n) + loss)
  }

  for (const key of allKeys) {
    const [owner, mint] = key.split('|')
    if (!owner || !mint || owner === fromWallet) continue
    const lost = senderLosses.get(mint)
    if (!lost || lost <= 0n) continue
    const before = pre.get(key)?.amount ?? 0n
    const after = post.get(key)?.amount ?? 0n
    const gain = after - before
    if (gain <= 0n) continue
    // Cap to what the sender lost on this mint (scatter / multi-recipient)
    const amount = gain <= lost ? gain : lost
    if (amount <= 0n) continue
    const lineKey = `${owner}|${mint}`
    if (seen.has(lineKey)) continue
    seen.add(lineKey)
    const decimals =
      post.get(key)?.decimals ?? pre.get(key)?.decimals ?? 0
    lines.push({
      recipient: owner,
      mint,
      name: null,
      amount_raw: amount.toString(),
      decimals,
      symbol: null,
    })
  }

  if (lines.length < 1) {
    return {
      ok: false,
      error:
        'No outbound NFT/token transfers from your wallet found in this transaction (SPL or MPL Core).',
    }
  }
  if (lines.length > 20) {
    return { ok: false, error: 'Too many transfer lines in this transaction to recover (max 20).' }
  }

  const baseFee = getOwlSendFeeLamports()
  let feeLamports = 0
  const treasury = getPlatformFeeTreasuryWalletAddress()
  if (treasury) {
    try {
      const treasuryPk = new PublicKey(treasury)
      const idx = keys.findIndex((k) => k.equals(treasuryPk))
      if (idx >= 0) {
        const preBal = transaction.meta.preBalances[idx] ?? 0
        const postBal = transaction.meta.postBalances[idx] ?? 0
        feeLamports = Math.max(0, postBal - preBal)
      }
    } catch {
      feeLamports = 0
    }
  }

  // OwlSend txs pay the platform fee in the same approval when fee is enabled.
  if (baseFee > 0) {
    if (!treasury) {
      return { ok: false, error: 'Owl fee treasury is not configured on the server.' }
    }
    if (feeLamports <= 0) {
      return {
        ok: false,
        error:
          'No Owl fee to treasury in this transaction — only OwlSend transfers can be recovered.',
      }
    }
  }

  const allNftLike = lines.every((l) => {
    const raw = l.amount_raw != null ? BigInt(String(l.amount_raw)) : 1n
    return raw === 1n && (l.decimals == null || l.decimals === 0)
  })
  const assetKind: OwlSendLedgerAssetKind = allNftLike ? 'nft' : 'token'
  const recipientCount = new Set(lines.map((l) => l.recipient)).size
  const mode: OwlSendLedgerMode =
    assetKind === 'nft'
      ? recipientCount <= 1
        ? 'nft_one'
        : 'nft_scatter'
      : recipientCount <= 1
        ? 'token_one'
        : 'token_scatter'

  return {
    ok: true,
    draft: {
      txSignature: params.signature.trim(),
      fromWallet,
      mode,
      assetKind,
      lines,
      feeLamports: baseFee > 0 ? feeLamports : 0,
    },
  }
}

function rpcTxLookupErrorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  if (/WrongSize|invalid param/i.test(msg)) {
    return 'That is not a valid Solana transaction signature. Copy the full signature from Solscan, or paste the Solscan /tx/ URL.'
  }
  return 'Could not load this transaction from RPC. Try again in a moment.'
}

export async function recoverOwlSendLedgerDraftFromSignature(params: {
  signature: string
  fromWallet: string
}): Promise<RecoverOwlSendLedgerResult> {
  const signature = normalizeDepositTxSignatureInput(params.signature)
  if (!isValidSolanaTxSignatureBase58(signature)) {
    return {
      ok: false,
      error: describeInvalidSolanaTxSignatureInput(params.signature) || 'Invalid transaction signature.',
    }
  }

  const rpcUrl = resolveServerSolanaRpcUrl()
  const connection = new Connection(rpcUrl, 'confirmed')

  let transaction: Awaited<ReturnType<typeof getTransactionCached>>
  try {
    transaction = await getTransactionCached(signature, async () => {
      await new Promise((r) => setTimeout(r, 400))
      let tx = await connection.getTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      })
      if (!tx) {
        tx = await connection.getTransaction(signature, { commitment: 'confirmed' })
      }
      return tx
    })
  } catch (e) {
    return { ok: false, error: rpcTxLookupErrorMessage(e) }
  }

  if (!transaction?.meta) {
    return {
      ok: false,
      error:
        'Transaction not found on-chain. If you copied from Discord, a character may have been dropped — paste the Solscan /tx/ URL.',
    }
  }

  return buildOwlSendLedgerDraftFromTx({
    signature,
    fromWallet: params.fromWallet,
    transaction: {
      transaction: transaction.transaction,
      meta: transaction.meta,
    },
  })
}
