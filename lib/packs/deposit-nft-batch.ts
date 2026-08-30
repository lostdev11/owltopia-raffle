/**
 * Batch pack-inventory deposits so classic SPL NFTs share wallet approvals.
 * Core / compressed still need one approval each (large Bubblegum/Core ixs).
 *
 * Classic path: build small multi-transfer txs (≤2), then Phantom/sign-all
 * collapses them into **one** wallet sheet when the adapter supports it.
 */
'use client'

import type { Connection, PublicKey } from '@solana/web3.js'
import type { WalletAdapter } from '@solana/wallet-adapter-base'
import {
  OWL_SEND_BUILD_TIMEOUT_HINT,
  OWL_SEND_BUILD_TIMEOUT_MS,
  withOwlSendTimeout,
} from '@/lib/owl-send/confirm'
import { isOwlSendPacketSizeError } from '@/lib/owl-send/tx-size'
import { buildOwlSendSplNftTransaction } from '@/lib/owl-send/send-spl-nft-batch'
import { sendOwlSendSplNftBatch } from '@/lib/owl-send/send-spl-nft-batch'
import {
  owlSendBatchesCanSignAll,
  sendOwlSendSignedBatchGroup,
  walletSupportsOwlSendSignAll,
} from '@/lib/owl-send/sign-all'
import {
  chunkPackDepositBatches,
  halvePackDepositChunk,
  packDepositApprovalGapMs,
  packDepositNeedsSpecialPath,
  rewriteOwlSendCopyForPacks,
  walletNftsToPackDepositLines,
} from '@/lib/packs/deposit-nft-batch-plan'
import { depositPrizeNftToEscrowFromWallet } from '@/lib/solana/deposit-prize-nft-to-escrow-wallet'
import type { WalletSendTransactionFn } from '@/lib/solana/send-umi-builder-via-wallet'
import type { WalletNft } from '@/lib/solana/wallet-tokens'

export {
  chunkPackDepositBatches,
  estimatePackDepositApprovals,
  PACK_DEPOSIT_MAX_PER_TX,
  packDepositApprovalGapMs,
  packDepositNeedsSpecialPath,
  rewriteOwlSendCopyForPacks,
  walletNftsToPackDepositLines,
} from '@/lib/packs/deposit-nft-batch-plan'

export { walletSupportsOwlSendSignAll as walletSupportsPackDepositSignAll } from '@/lib/owl-send/sign-all'

export type PackDepositBatchPhase = 'building' | 'approving' | 'confirming'

export type PackDepositNftResult = {
  deposited: Array<{ mint: string; signature: string }>
  failed: Array<{ mint: string; error: string }>
  /** True when classic SPL used one multi-tx wallet sheet. */
  usedSignAll: boolean
}

/**
 * Deposit a classic-SPL chunk to the packs vault in one approval (no OwlSend fee).
 * Prefer {@link depositPackInventoryNfts} which sign-alls multiple chunks.
 */
export async function depositPackClassicSplBatch(params: {
  connection: Connection
  owner: PublicKey
  sendTransaction: WalletSendTransactionFn
  walletAdapter: WalletAdapter | null
  vaultAddress: string
  nfts: WalletNft[]
  onPhase?: (phase: PackDepositBatchPhase) => void
}): Promise<
  | { ok: true; signature: string; sentMints: string[] }
  | { ok: false; error: string; failedMints?: string[]; packetTooLarge?: boolean }
> {
  if (params.nfts.length < 1) {
    return { ok: false, error: 'Nothing to deposit in this batch.' }
  }
  if (params.nfts.some(packDepositNeedsSpecialPath)) {
    return {
      ok: false,
      error:
        'This batch includes Core or compressed NFTs — deposit those one at a time.',
      failedMints: params.nfts.filter(packDepositNeedsSpecialPath).map((n) => n.mint),
    }
  }

  const lines = walletNftsToPackDepositLines(params.nfts, params.vaultAddress)
  const result = await sendOwlSendSplNftBatch({
    connection: params.connection,
    owner: params.owner,
    sendTransaction: params.sendTransaction,
    walletAdapter: params.walletAdapter,
    lines,
    omitPlatformFee: true,
    onPhase: params.onPhase,
  })

  if (!result.ok) {
    return {
      ok: false,
      error: rewriteOwlSendCopyForPacks(result.error),
      failedMints: result.failedMints,
      packetTooLarge: isOwlSendPacketSizeError(result.error),
    }
  }

  return {
    ok: true,
    signature: result.signature,
    sentMints: result.sentMints ?? lines.map((l) => l.mint),
  }
}

async function buildClassicPackTxs(params: {
  connection: Connection
  owner: PublicKey
  vaultAddress: string
  nfts: WalletNft[]
  onProgress?: (msg: string) => void
}): Promise<
  | {
      ok: true
      built: Array<{
        tx: import('@solana/web3.js').Transaction
        lines: ReturnType<typeof walletNftsToPackDepositLines>
        newAtaCount: number
      }>
    }
  | { ok: false; error: string; failedMints: string[] }
> {
  const queue = chunkPackDepositBatches(params.nfts).map((chunk) => [...chunk])
  const built: Array<{
    tx: import('@solana/web3.js').Transaction
    lines: ReturnType<typeof walletNftsToPackDepositLines>
    newAtaCount: number
  }> = []

  while (queue.length > 0) {
    const chunk = queue.shift()!
    if (chunk.length === 0) continue
    if (chunk.some(packDepositNeedsSpecialPath)) {
      return {
        ok: false,
        error: 'Unexpected Core/compressed NFT in classic build queue.',
        failedMints: chunk.filter(packDepositNeedsSpecialPath).map((n) => n.mint),
      }
    }

    params.onProgress?.(
      `Building deposit tx for ${chunk.length} NFT${chunk.length === 1 ? '' : 's'}…`
    )

    let lines = walletNftsToPackDepositLines(chunk, params.vaultAddress)
    let builtOne: Awaited<ReturnType<typeof buildOwlSendSplNftTransaction>>
    try {
      builtOne = await withOwlSendTimeout(
        buildOwlSendSplNftTransaction({
          connection: params.connection,
          owner: params.owner,
          lines,
          omitPlatformFee: true,
        }),
        OWL_SEND_BUILD_TIMEOUT_MS,
        OWL_SEND_BUILD_TIMEOUT_HINT
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (chunk.length > 1 && (isOwlSendPacketSizeError(msg) || /too large/i.test(msg))) {
        queue.unshift(...halvePackDepositChunk(chunk))
        continue
      }
      return {
        ok: false,
        error: rewriteOwlSendCopyForPacks(msg || OWL_SEND_BUILD_TIMEOUT_HINT),
        failedMints: chunk.map((n) => n.mint),
      }
    }

    if (!builtOne.ok) {
      if (chunk.length > 1) {
        queue.unshift(...halvePackDepositChunk(chunk))
        continue
      }
      return {
        ok: false,
        error: rewriteOwlSendCopyForPacks(builtOne.error),
        failedMints: builtOne.failedMints,
      }
    }

    built.push({
      tx: builtOne.tx,
      lines: lines.slice(0, builtOne.includedCount),
      newAtaCount: builtOne.newAtaCount,
    })
    if (builtOne.includedCount < chunk.length) {
      queue.unshift(chunk.slice(builtOne.includedCount))
    }
  }

  return { ok: true, built }
}

/**
 * Deposit selected inventory NFTs: classic SPL via multi-transfer (+ sign-all when
 * possible); Core/compressed via the existing single-NFT escrow path.
 */
export async function depositPackInventoryNfts(params: {
  connection: Connection
  owner: PublicKey
  sendTransaction: WalletSendTransactionFn
  walletAdapter: WalletAdapter | null
  vaultAddress: string
  nfts: WalletNft[]
  onProgress?: (msg: string) => void
}): Promise<PackDepositNftResult> {
  const deposited: PackDepositNftResult['deposited'] = []
  const failed: PackDepositNftResult['failed'] = []
  let usedSignAll = false

  const classic: WalletNft[] = []
  const special: WalletNft[] = []
  for (const nft of params.nfts) {
    if (packDepositNeedsSpecialPath(nft)) special.push(nft)
    else classic.push(nft)
  }

  if (classic.length > 0) {
    const builtResult = await buildClassicPackTxs({
      connection: params.connection,
      owner: params.owner,
      vaultAddress: params.vaultAddress,
      nfts: classic,
      onProgress: params.onProgress,
    })

    if (!builtResult.ok) {
      // Fall back: each classic NFT via the TM/SPL single path so deposit still works.
      params.onProgress?.(
        `Batch build failed (${builtResult.error}). Falling back to one-at-a-time…`
      )
      for (const nft of classic) {
        params.onProgress?.(`Depositing ${nft.name || nft.mint.slice(0, 8)}… (single)`)
        const dep = await depositPrizeNftToEscrowFromWallet({
          connection: params.connection,
          publicKey: params.owner,
          sendTransaction: params.sendTransaction,
          walletAdapter: params.walletAdapter,
          selectedNft: nft,
          prizeMintAddress: nft.mint,
          escrowAddress: params.vaultAddress,
          logCtx: {
            raffleId: 'packs-inventory',
            nftMint: nft.mint,
            transferAssetId: nft.mint,
            escrowAddress: params.vaultAddress,
            fromWallet: params.owner.toBase58(),
          },
        })
        if (dep.ok) deposited.push({ mint: nft.mint, signature: dep.signature })
        else failed.push({ mint: nft.mint, error: dep.error })
        await new Promise((r) => setTimeout(r, packDepositApprovalGapMs()))
      }
    } else if (builtResult.built.length > 0) {
      const lineBatches = builtResult.built.map((b) => b.lines)
      const canSignAll =
        builtResult.built.length >= 2 &&
        walletSupportsOwlSendSignAll(params.walletAdapter) &&
        owlSendBatchesCanSignAll(lineBatches)

      if (canSignAll) {
        usedSignAll = true
        params.onProgress?.(
          `Approve ${builtResult.built.length} deposit txs in one wallet sheet (${classic.length} NFTs)…`
        )
        try {
          const group = await sendOwlSendSignedBatchGroup({
            connection: params.connection,
            owner: params.owner,
            walletAdapter: params.walletAdapter,
            built: builtResult.built,
            onPhase: (phase) => {
              if (phase === 'approving') {
                params.onProgress?.(
                  `Approve in wallet — ${builtResult.built.length} txs / ${classic.length} NFTs…`
                )
              } else if (phase === 'confirming') {
                params.onProgress?.('Confirming deposits on-chain…')
              }
            },
          })
          for (let i = 0; i < group.length; i++) {
            const row = group[i]!
            const lines = builtResult.built[i]!.lines
            for (const line of lines) {
              deposited.push({ mint: line.mint, signature: row.signature })
            }
          }
        } catch (e) {
          const msg = rewriteOwlSendCopyForPacks(
            e instanceof Error ? e.message : String(e)
          )
          // Fall back to sequential sends for the built txs.
          params.onProgress?.(`Multi-approve failed (${msg}). Sending batches one by one…`)
          usedSignAll = false
          for (const row of builtResult.built) {
            const nfts = row.lines
              .map((l) => classic.find((n) => n.mint.trim() === l.mint.trim()))
              .filter((n): n is WalletNft => n != null)
            if (nfts.length === 0) continue
            const dep = await depositPackClassicSplBatch({
              connection: params.connection,
              owner: params.owner,
              sendTransaction: params.sendTransaction,
              walletAdapter: params.walletAdapter,
              vaultAddress: params.vaultAddress,
              nfts,
              onPhase: (phase) => {
                if (phase === 'approving') {
                  params.onProgress?.(
                    `Approve in wallet (${nfts.length} NFT${nfts.length === 1 ? '' : 's'})…`
                  )
                } else if (phase === 'confirming') {
                  params.onProgress?.('Confirming deposit on-chain…')
                }
              },
            })
            if (dep.ok) {
              for (const mint of dep.sentMints) {
                deposited.push({ mint, signature: dep.signature })
              }
            } else if (dep.packetTooLarge && nfts.length > 1) {
              for (const half of halvePackDepositChunk(nfts)) {
                const halfDep = await depositPackClassicSplBatch({
                  connection: params.connection,
                  owner: params.owner,
                  sendTransaction: params.sendTransaction,
                  walletAdapter: params.walletAdapter,
                  vaultAddress: params.vaultAddress,
                  nfts: half,
                })
                if (halfDep.ok) {
                  for (const mint of halfDep.sentMints) {
                    deposited.push({ mint, signature: halfDep.signature })
                  }
                } else {
                  for (const nft of half) {
                    failed.push({ mint: nft.mint, error: halfDep.error })
                  }
                }
              }
            } else {
              for (const nft of nfts) {
                failed.push({ mint: nft.mint, error: dep.error })
              }
            }
            await new Promise((r) => setTimeout(r, packDepositApprovalGapMs()))
          }
        }
      } else {
        // Sequential: one wallet popup per built tx (already ≤2 NFTs each).
        for (const row of builtResult.built) {
          const nfts = row.lines
            .map((l) => classic.find((n) => n.mint.trim() === l.mint.trim()))
            .filter((n): n is WalletNft => n != null)
          if (nfts.length === 0) continue
          params.onProgress?.(
            `Depositing ${nfts.length} NFT${nfts.length === 1 ? '' : 's'} (one approval)…`
          )
          const dep = await depositPackClassicSplBatch({
            connection: params.connection,
            owner: params.owner,
            sendTransaction: params.sendTransaction,
            walletAdapter: params.walletAdapter,
            vaultAddress: params.vaultAddress,
            nfts,
            onPhase: (phase) => {
              if (phase === 'approving') {
                params.onProgress?.(
                  `Approve in wallet (${nfts.length} NFT${nfts.length === 1 ? '' : 's'} → packs vault)…`
                )
              } else if (phase === 'confirming') {
                params.onProgress?.('Confirming deposit on-chain…')
              }
            },
          })
          if (dep.ok) {
            for (const mint of dep.sentMints) {
              deposited.push({ mint, signature: dep.signature })
            }
          } else if (dep.packetTooLarge && nfts.length > 1) {
            for (const half of halvePackDepositChunk(nfts)) {
              const halfDep = await depositPackClassicSplBatch({
                connection: params.connection,
                owner: params.owner,
                sendTransaction: params.sendTransaction,
                walletAdapter: params.walletAdapter,
                vaultAddress: params.vaultAddress,
                nfts: half,
              })
              if (halfDep.ok) {
                for (const mint of halfDep.sentMints) {
                  deposited.push({ mint, signature: halfDep.signature })
                }
              } else {
                // Last resort: Token Metadata / Core single path.
                for (const nft of half) {
                  const single = await depositPrizeNftToEscrowFromWallet({
                    connection: params.connection,
                    publicKey: params.owner,
                    sendTransaction: params.sendTransaction,
                    walletAdapter: params.walletAdapter,
                    selectedNft: nft,
                    prizeMintAddress: nft.mint,
                    escrowAddress: params.vaultAddress,
                    logCtx: {
                      raffleId: 'packs-inventory',
                      nftMint: nft.mint,
                      transferAssetId: nft.mint,
                      escrowAddress: params.vaultAddress,
                      fromWallet: params.owner.toBase58(),
                    },
                  })
                  if (single.ok) deposited.push({ mint: nft.mint, signature: single.signature })
                  else failed.push({ mint: nft.mint, error: single.error })
                }
              }
            }
          } else if (nfts.length === 1) {
            const nft = nfts[0]!
            const single = await depositPrizeNftToEscrowFromWallet({
              connection: params.connection,
              publicKey: params.owner,
              sendTransaction: params.sendTransaction,
              walletAdapter: params.walletAdapter,
              selectedNft: nft,
              prizeMintAddress: nft.mint,
              escrowAddress: params.vaultAddress,
              logCtx: {
                raffleId: 'packs-inventory',
                nftMint: nft.mint,
                transferAssetId: nft.mint,
                escrowAddress: params.vaultAddress,
                fromWallet: params.owner.toBase58(),
              },
            })
            if (single.ok) deposited.push({ mint: nft.mint, signature: single.signature })
            else failed.push({ mint: nft.mint, error: single.error || dep.error })
          } else {
            for (const nft of nfts) {
              failed.push({ mint: nft.mint, error: dep.error })
            }
          }
          await new Promise((r) => setTimeout(r, packDepositApprovalGapMs()))
        }
      }
    }
  }

  for (const nft of special) {
    params.onProgress?.(
      `Depositing ${nft.name || nft.mint.slice(0, 8)}… (Core/cNFT — 1 approval)`
    )
    const dep = await depositPrizeNftToEscrowFromWallet({
      connection: params.connection,
      publicKey: params.owner,
      sendTransaction: params.sendTransaction,
      walletAdapter: params.walletAdapter,
      selectedNft: nft,
      prizeMintAddress: nft.mint,
      escrowAddress: params.vaultAddress,
      logCtx: {
        raffleId: 'packs-inventory',
        nftMint: nft.mint,
        transferAssetId: nft.mint,
        escrowAddress: params.vaultAddress,
        fromWallet: params.owner.toBase58(),
      },
    })
    if (dep.ok) deposited.push({ mint: nft.mint, signature: dep.signature })
    else failed.push({ mint: nft.mint, error: dep.error })
    await new Promise((r) => setTimeout(r, packDepositApprovalGapMs()))
  }

  return { deposited, failed, usedSignAll }
}
