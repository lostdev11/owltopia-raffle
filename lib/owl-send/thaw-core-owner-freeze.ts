'use client'

/**
 * Client-side OwlSend thaw for leftover MPL Core Owner FreezeDelegate locks
 * (admin force-leave / closed nest still frozen on-chain).
 *
 * Prefers server-prepared txs (private RPC) when a session exists, then falls
 * back to browser RPC with retries so one flaky mint does not block the rest.
 */

import type { Connection } from '@solana/web3.js'
import type { WalletSendTransactionFn } from '@/lib/solana/send-umi-builder-via-wallet'
import { thawMplCoreOwnerFreezeInWallet } from '@/lib/solana/mpl-core-freeze'
import { isMplCoreWrongAccountTypeError } from '@/lib/solana/mpl-core-transfer-errors'
import { sendPreparedVersionedTransactionBase64 } from '@/lib/solana/send-prepared-versioned-tx'
import {
  MPL_CORE_OWNER_THAW_PREPARE_MAX,
  type PreparedMplCoreOwnerThaw,
} from '@/lib/solana/mpl-core-owner-thaw-prepare'

export type OwlSendCoreOwnerThawMintResult = {
  mint: string
  /** Wallet signed updatePlugin(frozen:false). */
  thawed: boolean
  /** Not a Core Owner freeze (or already thawed) — caller may try Gen2 server thaw. */
  skipToGen2: boolean
  error?: string
}

async function prepareOwnerThawViaServer(params: {
  ownerWallet: string
  mints: string[]
}): Promise<PreparedMplCoreOwnerThaw[] | null> {
  try {
    const res = await fetch('/api/me/staking/prepare-owner-thaw', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        'x-connected-wallet': params.ownerWallet,
      },
      body: JSON.stringify({ mints: params.mints }),
    })
    const data = (await res.json().catch(() => null)) as {
      items?: PreparedMplCoreOwnerThaw[]
    } | null
    if (!res.ok || !Array.isArray(data?.items)) return null
    return data.items
  } catch {
    return null
  }
}

/**
 * Attempt holder wallet thaw for each mint. Non-Core / already-thawed mints set skipToGen2.
 */
export async function thawOwlSendCoreOwnerFreezes(params: {
  connection: Connection
  wallet: any
  sendTransaction?: WalletSendTransactionFn
  mints: string[]
}): Promise<{ results: OwlSendCoreOwnerThawMintResult[]; thawedCount: number }> {
  const results: OwlSendCoreOwnerThawMintResult[] = []
  let thawedCount = 0
  const ownerWallet = String(
    params.wallet?.publicKey?.toBase58?.() ??
      params.wallet?.publicKey?.toString?.() ??
      params.wallet?.adapter?.publicKey?.toBase58?.() ??
      ''
  ).trim()

  const uniqueMints = [
    ...new Set(params.mints.map((m) => m.trim()).filter(Boolean)),
  ]

  for (let i = 0; i < uniqueMints.length; i += MPL_CORE_OWNER_THAW_PREPARE_MAX) {
    const chunk = uniqueMints.slice(i, i + MPL_CORE_OWNER_THAW_PREPARE_MAX)
    const prepared =
      ownerWallet.length > 0
        ? await prepareOwnerThawViaServer({ ownerWallet, mints: chunk })
        : null

    for (const mint of chunk) {
      const item = prepared?.find((p) => p.mint === mint) ?? null
      try {
        if (item?.status === 'skipped') {
          if (item.reason === 'already_thawed') {
            results.push({ mint, thawed: false, skipToGen2: true })
            continue
          }
          if (item.reason === 'not_core' || item.reason === 'not_wallet_freeze') {
            results.push({ mint, thawed: false, skipToGen2: true })
            continue
          }
          results.push({
            mint,
            thawed: false,
            skipToGen2: false,
            error: item.detail || item.reason,
          })
          continue
        }

        if (item?.status === 'ready' && params.sendTransaction) {
          await sendPreparedVersionedTransactionBase64({
            serializedBase64: item.serializedBase64,
            connection: params.connection,
            sendTransaction: params.sendTransaction,
            blockhash: item.blockhash,
            lastValidBlockHeight: item.lastValidBlockHeight,
            failMessagePrefix: 'Thaw would fail on-chain before wallet approval.',
          })
          results.push({ mint, thawed: true, skipToGen2: false })
          thawedCount += 1
          continue
        }

        const sig = await thawMplCoreOwnerFreezeInWallet({
          connection: params.connection,
          wallet: params.wallet,
          assetId: mint,
          sendTransaction: params.sendTransaction,
        })
        if (sig) {
          results.push({ mint, thawed: true, skipToGen2: false })
          thawedCount += 1
        } else {
          results.push({ mint, thawed: false, skipToGen2: true })
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (
          isMplCoreWrongAccountTypeError(msg) ||
          /not a metaplex core|wrong account|not of the expected type|assetaccountdata/i.test(msg) ||
          /not wallet-controlled|freeze is not wallet-controlled/i.test(msg)
        ) {
          results.push({ mint, thawed: false, skipToGen2: true })
          continue
        }
        results.push({ mint, thawed: false, skipToGen2: false, error: msg })
      }
    }
  }

  return { results, thawedCount }
}
