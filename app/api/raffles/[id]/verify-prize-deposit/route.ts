import { NextRequest, NextResponse } from 'next/server'
import { getRaffleById, updateRaffle } from '@/lib/db/raffles'
import {
  assertEscrowSplPrizeNotFrozen,
  getEscrowHeldNftMints,
  getPrizeEscrowPublicKey,
  getEscrowTokenAccountForMint,
  isMplCoreAssetInEscrow,
} from '@/lib/raffles/prize-escrow'
import { getMintFromDepositTx, sumIncomingSplToEscrowForMint } from '@/lib/solana/parse-deposit-tx'
import { getSolanaConnection } from '@/lib/solana/connection'
import { isPartnerSplPrizeRaffle, getPartnerPrizeTokenByCurrency } from '@/lib/partner-prize-tokens'
import { humanPartnerPrizeToRawUnits } from '@/lib/partner-prize-amount'
import { normalizeDepositTxSignatureInput } from '@/lib/raffles/verify-prize-deposit-client'
import { requireSession } from '@/lib/auth-server'
import { getAdminRole } from '@/lib/db/admins'
import { safeErrorMessage } from '@/lib/safe-error'
import { PublicKey } from '@solana/web3.js'
import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddress, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { publicKey as umiPublicKey } from '@metaplex-foundation/umi'
import { dasApi } from '@metaplex-foundation/digital-asset-standard-api'
import { getAssetWithProof, mplBubblegum } from '@metaplex-foundation/mpl-bubblegum'
import { resolveServerSolanaRpcUrl } from '@/lib/solana-rpc-url'

export const dynamic = 'force-dynamic'

async function sumIncomingNativeSolToEscrowLamports(
  connection: ReturnType<typeof getSolanaConnection>,
  signature: string,
  escrowAddress: string
): Promise<bigint | null> {
  let escrowPk: PublicKey
  try {
    escrowPk = new PublicKey(escrowAddress)
  } catch {
    return null
  }
  const escrowBase58 = escrowPk.toBase58()

  const fetchOptions = [
    { commitment: 'confirmed' as const, maxSupportedTransactionVersion: 0 },
    { commitment: 'confirmed' as const },
    { commitment: 'finalized' as const, maxSupportedTransactionVersion: 0 },
    { commitment: 'finalized' as const },
  ]
  let tx: Awaited<ReturnType<typeof connection.getTransaction>> | null = null
  for (const opts of fetchOptions) {
    tx = await connection.getTransaction(signature, opts as any).catch(() => null)
    if (tx?.meta) break
    await new Promise((r) => setTimeout(r, 250))
  }
  if (!tx?.meta) return null

  const keyToBase58 = (k: unknown): string | null => {
    if (typeof k === 'string' && k.trim()) return k.trim()
    if (k && typeof k === 'object' && 'pubkey' in k && typeof (k as { pubkey?: string }).pubkey === 'string') {
      const p = (k as { pubkey: string }).pubkey.trim()
      return p || null
    }
    try {
      if (k instanceof PublicKey) return k.toBase58()
      if (k != null) return new PublicKey(k as ConstructorParameters<typeof PublicKey>[0]).toBase58()
    } catch {
      return null
    }
    return null
  }

  const msg = tx.transaction.message as {
    staticAccountKeys?: unknown[]
    accountKeys?: unknown[]
  }
  const baseKeys = msg.staticAccountKeys ?? msg.accountKeys ?? []
  const loadedWritable = (tx.meta.loadedAddresses?.writable ?? []) as unknown[]
  const loadedReadonly = (tx.meta.loadedAddresses?.readonly ?? []) as unknown[]
  const accountKeys = [...baseKeys, ...loadedWritable, ...loadedReadonly]
    .map((k) => keyToBase58(k))
    .filter((k): k is string => !!k)
  const recipientIndex = accountKeys.findIndex((k) => k === escrowBase58)
  if (recipientIndex < 0) return null
  const pre = tx.meta.preBalances?.[recipientIndex] ?? 0
  const post = tx.meta.postBalances?.[recipientIndex] ?? 0
  const increase = BigInt(post - pre)
  return increase > 0n ? increase : null
}

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
    const depositTx =
      typeof body.deposit_tx === 'string' ? normalizeDepositTxSignatureInput(body.deposit_tx) : null

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
    if (raffle.prize_deposited_at) {
      return NextResponse.json({
        success: true,
        alreadyVerified: true,
        prizeDepositedAt: raffle.prize_deposited_at,
      })
    }

    // Partner SPL (fungible) prizes: require deposit_tx; sum incoming transfers to escrow for the mint.
    if (isPartnerSplPrizeRaffle(raffle)) {
      const partner = getPartnerPrizeTokenByCurrency(raffle.prize_currency)
      if (!partner) {
        return NextResponse.json({ error: 'Unsupported partner prize currency' }, { status: 400 })
      }
      const requiredRaw = humanPartnerPrizeToRawUnits(raffle.prize_currency, raffle.prize_amount)
      if (requiredRaw == null) {
        return NextResponse.json({ error: 'Invalid prize amount for partner token verify' }, { status: 400 })
      }
      const escrowAddress = getPrizeEscrowPublicKey()
      if (!escrowAddress) {
        return NextResponse.json({ error: 'Prize escrow is not configured' }, { status: 503 })
      }
      const connection = getSolanaConnection()
      let verifiedByTx = false
      if (depositTx) {
        const incoming = await sumIncomingSplToEscrowForMint(
          connection,
          depositTx,
          escrowAddress,
          partner.mint
        )
        let txIncomingRaw = incoming
        if (txIncomingRaw == null && partner.currencyCode === 'SOL') {
          txIncomingRaw = await sumIncomingNativeSolToEscrowLamports(connection, depositTx, escrowAddress)
        }
        if (txIncomingRaw != null && txIncomingRaw >= requiredRaw) {
          verifiedByTx = true
        } else {
          return NextResponse.json(
            {
              error:
                txIncomingRaw == null
                  ? 'Could not read this deposit transaction, or it does not transfer the prize amount to escrow.'
                  : `Deposit transfer sum (${txIncomingRaw.toString()} raw units) is below the declared prize (${requiredRaw.toString()} raw units).`,
            },
            { status: 400 }
          )
        }
      }

      if (!verifiedByTx) {
        const escrowOwner = new PublicKey(escrowAddress)
        const mintPk = new PublicKey(partner.mint)
        const tokenProgram =
          partner.tokenProgram === 'token2022' ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID
        const escrowAta = await getAssociatedTokenAddress(
          mintPk,
          escrowOwner,
          false,
          tokenProgram,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
        const escrowBalanceRes = await connection.getTokenAccountBalance(escrowAta).catch(() => null)
        const escrowRaw = BigInt(escrowBalanceRes?.value?.amount || '0')
        if (escrowRaw < requiredRaw) {
          return NextResponse.json(
            {
              error:
                'Escrow balance for this prize token is still below the declared prize amount. If you just transferred, wait for confirmation and retry, or provide deposit_tx.',
            },
            { status: 400 }
          )
        }
      }
      try {
        const frozen = await assertEscrowSplPrizeNotFrozen(new PublicKey(partner.mint))
        if (frozen.blocked) {
          return NextResponse.json(
            { error: frozen.error, frozenEscrowDiagnostics: frozen.diagnostics },
            { status: 400 }
          )
        }
      } catch {
        // ignore invalid mint
      }
      const now = new Date().toISOString()
      await updateRaffle(id, {
        prize_deposited_at: now,
        is_active: true,
        prize_deposit_tx: depositTx,
        prize_standard: partner.tokenProgram === 'token2022' ? ('token2022' as const) : ('spl' as const),
      } as any)
      return NextResponse.json({
        success: true,
        prizeDepositedAt: now,
        prizeDepositTx: depositTx,
      })
    }

    if (raffle.prize_type !== 'nft') {
      return NextResponse.json(
        { error: 'This raffle does not have a prize that uses escrow verification' },
        { status: 400 }
      )
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
