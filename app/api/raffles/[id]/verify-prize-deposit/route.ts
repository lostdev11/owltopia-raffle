import { NextRequest, NextResponse } from 'next/server'
import { getRaffleById, updateRaffle } from '@/lib/db/raffles'
import {
  assertEscrowSplPrizeNotFrozen,
  getEscrowHeldNftMints,
  getPrizeEscrowPublicKey,
  getEscrowTokenAccountForMint,
  isMplCoreAssetInEscrow,
} from '@/lib/raffles/prize-escrow'
import { getMintFromDepositTx } from '@/lib/solana/parse-deposit-tx'
import { getSolanaConnection } from '@/lib/solana/connection'
import { requireSession } from '@/lib/auth-server'
import { getAdminRole } from '@/lib/db/admins'
import { safeErrorMessage } from '@/lib/safe-error'
import { PublicKey } from '@solana/web3.js'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { publicKey as umiPublicKey } from '@metaplex-foundation/umi'
import { dasApi } from '@metaplex-foundation/digital-asset-standard-api'
import { getAssetWithProof, mplBubblegum } from '@metaplex-foundation/mpl-bubblegum'
import { resolveServerSolanaRpcUrl } from '@/lib/solana-rpc-url'

export const dynamic = 'force-dynamic'

/**
 * POST /api/raffles/[id]/verify-prize-deposit
 * Verifies that an NFT prize is in the platform escrow (discovered by what escrow holds)
 * and sets prize_deposited_at. Updates raffle nft_mint_address when escrow has exactly one NFT.
 * Optional body: { deposit_tx?: string } - when provided, parses the tx to identify which mint
 * was transferred to escrow (works even when escrow holds multiple NFTs).
 * Caller must be the raffle creator or a full admin.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const params = await context.params
    const id = params.id
    if (typeof id !== 'string') {
      return NextResponse.json({ error: 'Invalid raffle id' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const depositTx = typeof body.deposit_tx === 'string' ? body.deposit_tx.trim() : null

    const raffle = await getRaffleById(id)
    if (!raffle) {
      return NextResponse.json({ error: 'Raffle not found' }, { status: 404 })
    }
    const creatorWallet = (raffle.creator_wallet || raffle.created_by || '').trim()
    const isCreator = creatorWallet && session.wallet === creatorWallet
    const isAdmin = (await getAdminRole(session.wallet)) !== null
    if (!isCreator && !isAdmin) {
      return NextResponse.json(
        { error: 'Only the raffle creator or an admin can verify the prize deposit' },
        { status: 403 }
      )
    }
    if (raffle.prize_type !== 'nft') {
      return NextResponse.json(
        { error: 'This raffle does not have an NFT prize' },
        { status: 400 }
      )
    }
    if (raffle.prize_deposited_at) {
      return NextResponse.json({
        success: true,
        alreadyVerified: true,
        prizeDepositedAt: raffle.prize_deposited_at,
      })
    }

    // Mpl Core prizes: check asset owner first. If that fails, fall through — DB may say Core while
    // the asset is SPL (or RPC/Core fetch failed); SPL + compressed paths below still apply.
    if ((raffle as any).prize_standard === 'mpl_core') {
      if (!raffle.nft_mint_address) {
        return NextResponse.json({ error: 'Missing NFT mint address' }, { status: 400 })
      }
      let inCoreEscrow = false
      try {
        inCoreEscrow = await isMplCoreAssetInEscrow(raffle.nft_mint_address)
      } catch {
        inCoreEscrow = false
      }
      if (inCoreEscrow) {
        const now = new Date().toISOString()
        await updateRaffle(id, {
          prize_deposited_at: now,
          is_active: true,
          nft_mint_address: raffle.nft_mint_address,
        })
        return NextResponse.json({
          success: true,
          prizeDepositedAt: now,
          nftMintAddress: raffle.nft_mint_address,
        })
      }
    }

    const held = await getEscrowHeldNftMints()
    const preferredMint = (raffle.nft_mint_address || '').trim()

    // When deposit_tx is provided, parse it to get the mint transferred to escrow.
    // This identifies which NFT belongs to this raffle even when escrow holds multiple NFTs.
    if (depositTx) {
      const escrowAddress = getPrizeEscrowPublicKey()
      if (escrowAddress) {
        const connection = getSolanaConnection()
        const mintFromTx = await getMintFromDepositTx(connection, depositTx, escrowAddress)
        if (mintFromTx) {
          // Validate mint is in escrow
          const ata = await getEscrowTokenAccountForMint(new PublicKey(mintFromTx))
          const inCoreEscrow = ata ? true : await isMplCoreAssetInEscrow(mintFromTx).catch(() => false)
          if (ata || inCoreEscrow) {
            if (ata) {
              const frozen = await assertEscrowSplPrizeNotFrozen(new PublicKey(mintFromTx))
              if (frozen.blocked) {
                return NextResponse.json(
                  { error: frozen.error, frozenEscrowDiagnostics: frozen.diagnostics },
                  { status: 400 }
                )
              }
            }
            const now = new Date().toISOString()
            const update: Record<string, unknown> = {
              prize_deposited_at: now,
              is_active: true,
              nft_mint_address: mintFromTx,
              nft_token_id: mintFromTx,
              prize_deposit_tx: depositTx,
            }
            if (inCoreEscrow && !ata) {
              update.prize_standard = 'mpl_core'
            }
            await updateRaffle(id, update as any)
            return NextResponse.json({
              success: true,
              prizeDepositedAt: now,
              nftMintAddress: mintFromTx,
              prizeDepositTx: depositTx,
            })
          }
        }
      }
    }

    // Confirm escrow holds this raffle's mint via ATA lookup. Handles RPC flakiness where
    // getParsedTokenAccountsByOwner returns nothing even though the escrow token account exists.
    if (preferredMint) {
      try {
        const mintPk = new PublicKey(preferredMint)
        const ataForPreferred = await getEscrowTokenAccountForMint(mintPk)
        if (ataForPreferred) {
          const frozen = await assertEscrowSplPrizeNotFrozen(mintPk)
          if (frozen.blocked) {
            return NextResponse.json(
              { error: frozen.error, frozenEscrowDiagnostics: frozen.diagnostics },
              { status: 400 }
            )
          }
          const now = new Date().toISOString()
          const tokenId =
            typeof raffle.nft_token_id === 'string' && raffle.nft_token_id.trim()
              ? raffle.nft_token_id.trim()
              : preferredMint
          await updateRaffle(id, {
            prize_deposited_at: now,
            is_active: true,
            nft_mint_address: preferredMint,
            nft_token_id: tokenId,
            ...(depositTx ? { prize_deposit_tx: depositTx } : {}),
          } as any)
          return NextResponse.json({
            success: true,
            prizeDepositedAt: now,
            nftMintAddress: preferredMint,
            ...(depositTx ? { prizeDepositTx: depositTx } : {}),
          })
        }
      } catch {
        // Invalid mint address or transient RPC — continue with held-list logic.
      }
    }

    if (held.length === 0) {
      // Compressed NFTs (bubblegum) are not represented as SPL/Token-2022 accounts.
      // For those, verify by checking that the compressed asset's `leafOwner` equals the escrow owner.
      try {
        const escrowOwner = getPrizeEscrowPublicKey()
        const escrowOwnerPk = escrowOwner ? umiPublicKey(escrowOwner) : null
        if (escrowOwnerPk) {
          const assetIdCandidates = Array.from(
            new Set(
              [raffle.nft_token_id, raffle.nft_mint_address]
                .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
                .map((v) => v.trim())
            )
          )
          if (assetIdCandidates.length > 0) {
            const endpoint = resolveServerSolanaRpcUrl()

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const umi: any = (createUmi as any)(endpoint as any).use(dasApi()).use(mplBubblegum())

            for (const assetId of assetIdCandidates) {
              try {
                const asset: any = await getAssetWithProof(umi, umiPublicKey(assetId), { truncateCanopy: true })
                const leafOwner = asset?.leafOwner
                if (leafOwner && String(leafOwner) === String(escrowOwnerPk)) {
                  const now = new Date().toISOString()
                  await updateRaffle(id, {
                    prize_deposited_at: now,
                    is_active: true,
                    nft_mint_address: assetId,
                    nft_token_id: assetId,
                    prize_standard: 'compressed' as any,
                  } as any)
                  return NextResponse.json({
                    success: true,
                    prizeDepositedAt: now,
                    nftMintAddress: assetId,
                    prizeStandard: 'compressed',
                  })
                }
              } catch {
                // Try other candidate ids
              }
            }
          }
        }
      } catch {
        // Continue to existing SPL/Mpl Core fallback below
      }

      // Fallback: some raffles are created as SPL but transferred as Mpl Core asset IDs.
      // If escrow owns the Core asset, treat deposit as verified and sync raffle standard.
      const coreCandidates = Array.from(
        new Set(
          [raffle.nft_token_id, raffle.nft_mint_address]
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
          await updateRaffle(id, {
            prize_deposited_at: now,
            is_active: true,
            prize_standard: 'mpl_core' as any,
            // Keep the canonical on-chain id in nft_mint_address for existing winner-claim flow.
            nft_mint_address: assetId,
          })
          return NextResponse.json({
            success: true,
            prizeDepositedAt: now,
            nftMintAddress: assetId,
            prizeStandard: 'mpl_core',
          })
        } catch {
          // continue trying other candidates
        }
      }
      return NextResponse.json(
        {
          error:
            'NFT not found in prize escrow. Complete the transfer using the button above, wait for confirmation, then try Verify again.',
        },
        { status: 400 }
      )
    }

    let mintToSet: string
    if (held.length === 1) {
      const onlyMint = held[0].mint
      // When escrow has exactly one NFT, use it as the canonical mint (auto-correct wrong link).
      // The NFT in escrow is the source of truth; creator may have selected wrong NFT or metadata was wrong at creation.
      mintToSet = onlyMint
    } else {
      const match = held.find((h) => h.mint === preferredMint)
      if (match) {
        mintToSet = match.mint
      } else {
        // We didn't find the expected mint in the SPL/Token-2022 escrow token accounts list.
        // This can happen when:
        // - the prize is MPL Core (not represented as SPL token accounts), and escrow also holds some SPL NFTs; or
        // - the prize is compressed (bubblegum), which is not represented as SPL token accounts.
        //
        // Try MPL Core first (by asset owner), then compressed (bubblegum leafOwner) as a fallback.
        try {
          // MPL Core verification: escrow may hold a Core asset even if SPL token accounts list doesn't include it.
          const inCoreEscrow = await isMplCoreAssetInEscrow(preferredMint)
          if (inCoreEscrow) {
            const now = new Date().toISOString()
            await updateRaffle(id, {
              prize_deposited_at: now,
              is_active: true,
              prize_standard: 'mpl_core' as any,
              // Canonical on-chain id for Core prize
              nft_mint_address: preferredMint,
              nft_token_id: preferredMint,
            } as any)
            return NextResponse.json({
              success: true,
              prizeDepositedAt: now,
              nftMintAddress: preferredMint,
              prizeStandard: 'mpl_core',
            })
          }
        } catch {
          // Ignore and try compressed fallback below
        }

        // Compressed NFTs are not represented as SPL/Token-2022 token accounts.
        // If escrow holds a mix (SPL + compressed), `held` may be non-empty but still miss the expected prize.
        // In that case, verify compressed ownership via bubblegum `leafOwner`.
        try {
          const escrowOwner = getPrizeEscrowPublicKey()
          const escrowOwnerPk = escrowOwner ? umiPublicKey(escrowOwner) : null
          if (escrowOwnerPk) {
            const assetIdCandidates = Array.from(
              new Set(
                [raffle.nft_token_id, raffle.nft_mint_address]
                  .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
                  .map((v) => v.trim())
              )
            )
            const endpoint = resolveServerSolanaRpcUrl()

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const umi: any = (createUmi as any)(endpoint as any).use(dasApi()).use(mplBubblegum())

            for (const assetId of assetIdCandidates) {
              try {
                const asset: any = await getAssetWithProof(umi, umiPublicKey(assetId), { truncateCanopy: true })
                const leafOwner = asset?.leafOwner
                if (leafOwner && String(leafOwner) === String(escrowOwnerPk)) {
                  const now = new Date().toISOString()
                  await updateRaffle(id, {
                    prize_deposited_at: now,
                    is_active: true,
                    nft_mint_address: assetId,
                    nft_token_id: assetId,
                    prize_standard: 'compressed' as any,
                  } as any)
                  return NextResponse.json({
                    success: true,
                    prizeDepositedAt: now,
                    nftMintAddress: assetId,
                    prizeStandard: 'compressed',
                  })
                }
              } catch {
                // Try other candidates
              }
            }
          }
        } catch {
          // ignore; fall back to SPL error below
        }

        return NextResponse.json(
          {
            error: `Escrow has multiple NFTs. This raffle expects mint ${preferredMint || '(not set)'}; none of the NFTs in escrow match. Set the raffle prize to the correct mint or leave only one NFT in escrow.`,
          },
          { status: 400 }
        )
      }
    }

    const frozen = await assertEscrowSplPrizeNotFrozen(new PublicKey(mintToSet))
    if (frozen.blocked) {
      return NextResponse.json(
        { error: frozen.error, frozenEscrowDiagnostics: frozen.diagnostics },
        { status: 400 }
      )
    }

    const now = new Date().toISOString()
    const mintChanged = mintToSet !== preferredMint
    await updateRaffle(id, {
      prize_deposited_at: now,
      is_active: true,
      ...(mintChanged ? { nft_mint_address: mintToSet, nft_token_id: mintToSet } : {}),
      ...(depositTx ? { prize_deposit_tx: depositTx } : {}),
    })
    return NextResponse.json({
      success: true,
      prizeDepositedAt: now,
      nftMintAddress: mintToSet,
    })
  } catch (error) {
    console.error('Verify prize deposit error:', error)
    return NextResponse.json(
      { error: safeErrorMessage(error) },
      { status: 500 }
    )
  }
}
