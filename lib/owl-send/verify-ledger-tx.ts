import { Connection, PublicKey } from '@solana/web3.js'
import { getTransactionCached } from '@/lib/solana-rpc-transaction-cache'
import { resolveServerSolanaRpcUrl } from '@/lib/solana-rpc-url'
import { getFullAccountKeysForTransaction } from '@/lib/verify-transaction'
import { getPlatformFeeTreasuryWalletAddress } from '@/lib/solana/platform-fee-treasury-wallet'
import type { OwlSendLedgerLine } from '@/lib/db/owl-send-ledger'
import {
  collectMplCoreTransferV1FromTx,
  mplCoreTransferCoversLedgerLine,
} from '@/lib/owl-send/mpl-core-ledger-transfers'

export type VerifyOwlSendLedgerTxResult =
  | { ok: true }
  | { ok: false; error: string }

/**
 * Verify an OwlSend ledger claim against the on-chain transaction.
 * - Tx exists and succeeded
 * - Fee payer matches fromWallet (session-bound caller)
 * - Each claimed mint shows a positive SPL token delta to the claimed recipient, OR
 *   an MPL Core TransferV1 (asset → new_owner) for that mint/recipient
 *   (Core NFTs have no SPL token accounts / token-balance rows)
 * - When feeLamports > 0 and treasury is configured, treasury SOL balance increased
 */
export async function verifyOwlSendLedgerTx(params: {
  signature: string
  fromWallet: string
  lines: OwlSendLedgerLine[]
  feeLamports?: number | null
}): Promise<VerifyOwlSendLedgerTxResult> {
  const signature = params.signature.trim()
  const fromWallet = params.fromWallet.trim()
  if (!signature || signature.length < 32) {
    return { ok: false, error: 'Invalid transaction signature.' }
  }

  let fromPk: PublicKey
  try {
    fromPk = new PublicKey(fromWallet)
  } catch {
    return { ok: false, error: 'Invalid from wallet.' }
  }

  const rpcUrl = resolveServerSolanaRpcUrl()
  const connection = new Connection(rpcUrl, 'confirmed')

  const transaction = await getTransactionCached(signature, async () => {
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

  if (!transaction) {
    return { ok: false, error: 'Transaction not found on-chain yet. Try again in a moment.' }
  }
  if (transaction.meta?.err) {
    return { ok: false, error: 'Transaction failed on-chain.' }
  }
  if (!transaction.meta) {
    return { ok: false, error: 'Transaction metadata missing.' }
  }

  const keys = getFullAccountKeysForTransaction({
    transaction: transaction.transaction,
    meta: transaction.meta,
  })
  const feePayer = keys[0]
  if (!feePayer || !feePayer.equals(fromPk)) {
    return { ok: false, error: 'Transaction fee payer does not match signed-in wallet.' }
  }

  const pre = transaction.meta.preTokenBalances ?? []
  const post = transaction.meta.postTokenBalances ?? []

  type BalKey = string
  const balMap = (rows: typeof pre) => {
    const m = new Map<BalKey, bigint>()
    for (const row of rows) {
      const owner = typeof row.owner === 'string' ? row.owner : ''
      const mint = typeof row.mint === 'string' ? row.mint : ''
      if (!owner || !mint) continue
      const amount = BigInt(row.uiTokenAmount?.amount ?? '0')
      const key = `${owner}|${mint}`
      m.set(key, (m.get(key) ?? 0n) + amount)
    }
    return m
  }
  const preMap = balMap(pre)
  const postMap = balMap(post)
  const coreTransfers = collectMplCoreTransferV1FromTx(
    {
      transaction: transaction.transaction,
      meta: transaction.meta,
    },
    keys
  )

  if (params.lines.length < 1) {
    return { ok: false, error: 'No ledger lines to verify.' }
  }

  for (const line of params.lines) {
    const recipient = line.recipient?.trim()
    const mint = line.mint?.trim()
    if (!recipient || !mint) {
      return { ok: false, error: 'Each ledger line needs recipient and mint.' }
    }
    try {
      // eslint-disable-next-line no-new
      new PublicKey(recipient)
      // eslint-disable-next-line no-new
      new PublicKey(mint)
    } catch {
      return { ok: false, error: 'Invalid recipient or mint in ledger lines.' }
    }
    const key = `${recipient}|${mint}`
    const before = preMap.get(key) ?? 0n
    const after = postMap.get(key) ?? 0n
    const delta = after - before
    if (delta > 0n) {
      if (line.amount_raw != null && String(line.amount_raw).trim() !== '') {
        try {
          const expected = BigInt(String(line.amount_raw).trim())
          if (expected > 0n && delta < expected) {
            return {
              ok: false,
              error: `Token amount to ${recipient.slice(0, 4)}… is less than claimed.`,
            }
          }
        } catch {
          return { ok: false, error: 'Invalid amount_raw in ledger lines.' }
        }
      }
      continue
    }

    // MPL Core (and similar non-SPL) assets never produce token-balance deltas.
    if (
      mplCoreTransferCoversLedgerLine(coreTransfers, {
        mint,
        recipient,
        fromWallet: fromPk.toBase58(),
      })
    ) {
      continue
    }

    return {
      ok: false,
      error: `On-chain token transfer to ${recipient.slice(0, 4)}… for mint ${mint.slice(0, 4)}… not found.`,
    }
  }

  const feeLamports = params.feeLamports ?? 0
  if (feeLamports > 0) {
    const treasury = getPlatformFeeTreasuryWalletAddress()
    if (!treasury) {
      return { ok: false, error: 'Owl fee treasury is not configured on the server.' }
    }
    try {
      const treasuryPk = new PublicKey(treasury)
      const idx = keys.findIndex((k) => k.equals(treasuryPk))
      if (idx < 0) {
        return { ok: false, error: 'Owl fee treasury not present in transaction.' }
      }
      const preBal = transaction.meta.preBalances[idx] ?? 0
      const postBal = transaction.meta.postBalances[idx] ?? 0
      if (postBal - preBal < feeLamports) {
        return { ok: false, error: 'Owl fee to treasury not found in transaction.' }
      }
    } catch {
      return { ok: false, error: 'Invalid platform fee treasury configuration.' }
    }
  }

  return { ok: true }
}
