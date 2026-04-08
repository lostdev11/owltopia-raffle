/**
 * Shared on-chain verification for NFT prizes in platform escrow (raffles + community giveaways).
 * Returns a DB patch (includes is_active: true for raffles); callers for giveaways must omit is_active.
 */

import {
  getEscrowHeldNftMints,
  getPrizeEscrowPublicKey,
  getEscrowTokenAccountForMint,
  isMplCoreAssetInEscrow,
} from '@/lib/raffles/prize-escrow'
import { getMintFromDepositTx } from '@/lib/solana/parse-deposit-tx'
import { getSolanaConnection } from '@/lib/solana/connection'
import { PublicKey } from '@solana/web3.js'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { publicKey as umiPublicKey } from '@metaplex-foundation/umi'
import { dasApi } from '@metaplex-foundation/digital-asset-standard-api'
import { getAssetWithProof, mplBubblegum } from '@metaplex-foundation/mpl-bubblegum'

export type NftPrizeDepositSubject = {
  nft_mint_address: string | null
  nft_token_id?: string | null
  prize_standard?: string | null
}

export type VerifyNftPrizeDepositCoreResult =
  | { kind: 'already_verified'; prizeDepositedAt: string }
  | {
      kind: 'ok'
      prizeDepositedAt: string
      nftMintAddress: string
      prizeDepositTx?: string
      prizeStandard?: string
      /** Includes is_active: true for raffles; strip for community_giveaways. */
      dbPatch: Record<string, unknown>
    }
  | { kind: 'error'; message: string; status: number }

export async function verifyNftPrizeDepositCore(
  subject: NftPrizeDepositSubject,
  depositTx: string | null,
  existingPrizeDepositedAt: string | null
): Promise<VerifyNftPrizeDepositCoreResult> {
  if (existingPrizeDepositedAt) {
    return { kind: 'already_verified', prizeDepositedAt: existingPrizeDepositedAt }
  }

  const prizeStandard = subject.prize_standard

  if (prizeStandard === 'mpl_core') {
    if (!subject.nft_mint_address) {
      return { kind: 'error', message: 'Missing NFT mint address', status: 400 }
    }
    const inEscrow = await isMplCoreAssetInEscrow(subject.nft_mint_address)
    if (!inEscrow) {
      return {
        kind: 'error',
        message:
          'Core NFT not found in prize escrow. Complete the transfer, wait for confirmation, then try Verify again.',
        status: 400,
      }
    }
    const now = new Date().toISOString()
    const mint = subject.nft_mint_address
    return {
      kind: 'ok',
      prizeDepositedAt: now,
      nftMintAddress: mint,
      dbPatch: {
        prize_deposited_at: now,
        is_active: true,
        nft_mint_address: mint,
      },
    }
  }

  const held = await getEscrowHeldNftMints()

  if (depositTx) {
    const escrowAddress = getPrizeEscrowPublicKey()
    if (escrowAddress) {
      const connection = getSolanaConnection()
      const mintFromTx = await getMintFromDepositTx(connection, depositTx, escrowAddress)
      if (mintFromTx) {
        const ata = await getEscrowTokenAccountForMint(new PublicKey(mintFromTx))
        const inCoreEscrow = ata ? true : await isMplCoreAssetInEscrow(mintFromTx).catch(() => false)
        if (ata || inCoreEscrow) {
          const now = new Date().toISOString()
          const dbPatch: Record<string, unknown> = {
            prize_deposited_at: now,
            is_active: true,
            nft_mint_address: mintFromTx,
            nft_token_id: mintFromTx,
            prize_deposit_tx: depositTx,
          }
          if (inCoreEscrow && !ata) {
            dbPatch.prize_standard = 'mpl_core'
          }
          return {
            kind: 'ok',
            prizeDepositedAt: now,
            nftMintAddress: mintFromTx,
            prizeDepositTx: depositTx,
            prizeStandard: inCoreEscrow && !ata ? 'mpl_core' : undefined,
            dbPatch,
          }
        }
      }
    }
  }

  if (held.length === 0) {
    try {
      const escrowOwner = getPrizeEscrowPublicKey()
      const escrowOwnerPk = escrowOwner ? umiPublicKey(escrowOwner) : null
      if (escrowOwnerPk) {
        const assetIdCandidates = Array.from(
          new Set(
            [subject.nft_token_id, subject.nft_mint_address]
              .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
              .map((v) => v.trim())
          )
        )
        if (assetIdCandidates.length > 0) {
          const endpoint =
            process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
            process.env.SOLANA_RPC_URL ||
            'https://solana.drpc.org'

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const umi: any = (createUmi as any)(endpoint as any).use(dasApi()).use(mplBubblegum())

          for (const assetId of assetIdCandidates) {
            try {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const asset: any = await getAssetWithProof(umi, umiPublicKey(assetId), { truncateCanopy: true })
              const leafOwner = asset?.leafOwner
              if (leafOwner && String(leafOwner) === String(escrowOwnerPk)) {
                const now = new Date().toISOString()
                return {
                  kind: 'ok',
                  prizeDepositedAt: now,
                  nftMintAddress: assetId,
                  prizeStandard: 'compressed',
                  dbPatch: {
                    prize_deposited_at: now,
                    is_active: true,
                    nft_mint_address: assetId,
                    nft_token_id: assetId,
                    prize_standard: 'compressed',
                  },
                }
              }
            } catch {
              // Try other candidate ids
            }
          }
        }
      }
    } catch {
      // Continue to MPL Core fallback below
    }

    const coreCandidates = Array.from(
      new Set(
        [subject.nft_token_id, subject.nft_mint_address]
          .filter((v): v is string => typeof v === 'string')
          .map((v) => v.trim())
          .filter(Boolean)
      )
    )
    for (const assetId of coreCandidates) {
      try {
        const inCoreEscrow = await isMplCoreAssetInEscrow(assetId)
        if (!inCoreEscrow) continue
        const now = new Date().toISOString()
        return {
          kind: 'ok',
          prizeDepositedAt: now,
          nftMintAddress: assetId,
          prizeStandard: 'mpl_core',
          dbPatch: {
            prize_deposited_at: now,
            is_active: true,
            prize_standard: 'mpl_core',
            nft_mint_address: assetId,
          },
        }
      } catch {
        // continue trying other candidates
      }
    }
    return {
      kind: 'error',
      message:
        'NFT not found in prize escrow. Complete the transfer using the button above, wait for confirmation, then try Verify again.',
      status: 400,
    }
  }

  const preferredMint = (subject.nft_mint_address || '').trim()
  let mintToSet: string
  if (held.length === 1) {
    mintToSet = held[0].mint
  } else {
    const match = held.find((h) => h.mint === preferredMint)
    if (match) {
      mintToSet = match.mint
    } else {
      try {
        const inCoreEscrow = await isMplCoreAssetInEscrow(preferredMint)
        if (inCoreEscrow) {
          const now = new Date().toISOString()
          return {
            kind: 'ok',
            prizeDepositedAt: now,
            nftMintAddress: preferredMint,
            prizeStandard: 'mpl_core',
            dbPatch: {
              prize_deposited_at: now,
              is_active: true,
              prize_standard: 'mpl_core',
              nft_mint_address: preferredMint,
              nft_token_id: preferredMint,
            },
          }
        }
      } catch {
        // Ignore and try compressed fallback below
      }

      try {
        const escrowOwner = getPrizeEscrowPublicKey()
        const escrowOwnerPk = escrowOwner ? umiPublicKey(escrowOwner) : null
        if (escrowOwnerPk) {
          const assetIdCandidates = Array.from(
            new Set(
              [subject.nft_token_id, subject.nft_mint_address]
                .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
                .map((v) => v.trim())
            )
          )
          const endpoint =
            process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
            process.env.SOLANA_RPC_URL ||
            'https://solana.drpc.org'

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const umi: any = (createUmi as any)(endpoint as any).use(dasApi()).use(mplBubblegum())

          for (const assetId of assetIdCandidates) {
            try {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const asset: any = await getAssetWithProof(umi, umiPublicKey(assetId), { truncateCanopy: true })
              const leafOwner = asset?.leafOwner
              if (leafOwner && String(leafOwner) === String(escrowOwnerPk)) {
                const now = new Date().toISOString()
                return {
                  kind: 'ok',
                  prizeDepositedAt: now,
                  nftMintAddress: assetId,
                  prizeStandard: 'compressed',
                  dbPatch: {
                    prize_deposited_at: now,
                    is_active: true,
                    nft_mint_address: assetId,
                    nft_token_id: assetId,
                    prize_standard: 'compressed',
                  },
                }
              }
            } catch {
              // Try other candidates
            }
          }
        }
      } catch {
        // ignore; fall back to SPL error below
      }

      return {
        kind: 'error',
        message: `Escrow has multiple NFTs. Expected mint ${preferredMint || '(not set)'}; none of the NFTs in escrow match. Set the prize to the correct mint or leave only one NFT in escrow.`,
        status: 400,
      }
    }
  }

  const now = new Date().toISOString()
  const mintChanged = mintToSet !== preferredMint
  const dbPatch: Record<string, unknown> = {
    prize_deposited_at: now,
    is_active: true,
    ...(mintChanged ? { nft_mint_address: mintToSet, nft_token_id: mintToSet } : {}),
    ...(depositTx ? { prize_deposit_tx: depositTx } : {}),
  }
  return {
    kind: 'ok',
    prizeDepositedAt: now,
    nftMintAddress: mintToSet,
    prizeDepositTx: depositTx ?? undefined,
    dbPatch,
  }
}
