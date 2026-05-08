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
import {
  normalizeDepositTxSignatureInput,
  type FrozenEscrowDiagnostics,
} from '@/lib/raffles/verify-prize-deposit-client'
import { safeErrorMessage } from '@/lib/safe-error'
import { PublicKey } from '@solana/web3.js'
import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddress, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { publicKey as umiPublicKey } from '@metaplex-foundation/umi'
import { dasApi } from '@metaplex-foundation/digital-asset-standard-api'
import { getAssetWithProof, mplBubblegum } from '@metaplex-foundation/mpl-bubblegum'
import { resolveServerSolanaRpcUrl } from '@/lib/solana-rpc-url'

export type VerifyPrizeDepositInternalResult =
  | {
      ok: true
      alreadyVerified?: boolean
      prizeDepositedAt?: string
      nftMintAddress?: string
      prizeDepositTx?: string | null
      prizeStandard?: string
    }
  | {
      ok: false
      httpStatus: number
      error: string
      frozenEscrowDiagnostics?: FrozenEscrowDiagnostics
    }

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
 * Core escrow verification (NFT + partner SPL). Used by POST verify-prize-deposit, register-deposit-tx, and cron.
 * Merges `depositTxFromRequest` with stored `raffle.prize_deposit_tx` so pending registrations still verify.
 */
export async function verifyPrizeDepositInternal(
  raffleId: string,
  depositTxFromRequest: string | null
): Promise<VerifyPrizeDepositInternalResult> {
  try {
    if (!raffleId || typeof raffleId !== 'string') {
      return { ok: false, httpStatus: 400, error: 'Invalid raffle id' }
    }

    const raffle = await getRaffleById(raffleId)
    if (!raffle) {
      return { ok: false, httpStatus: 404, error: 'Raffle not found' }
    }

    const fromRequest =
      typeof depositTxFromRequest === 'string'
        ? normalizeDepositTxSignatureInput(depositTxFromRequest.trim()) || null
        : null
    const fromDb = normalizeDepositTxSignatureInput((raffle.prize_deposit_tx || '').trim()) || null
    const depositTx = fromRequest ?? fromDb

    if (raffle.prize_deposited_at) {
      return {
        ok: true,
        alreadyVerified: true,
        prizeDepositedAt: raffle.prize_deposited_at,
      }
    }

    // Partner SPL (fungible) prizes: require deposit_tx; sum incoming transfers to escrow for the mint.
    if (isPartnerSplPrizeRaffle(raffle)) {
      const partner = getPartnerPrizeTokenByCurrency(raffle.prize_currency)
      if (!partner) {
        return { ok: false, httpStatus: 400, error: 'Unsupported partner prize currency' }
      }
      const requiredRaw = humanPartnerPrizeToRawUnits(raffle.prize_currency, raffle.prize_amount)
      if (requiredRaw == null) {
        return { ok: false, httpStatus: 400, error: 'Invalid prize amount for partner token verify' }
      }
      const escrowAddress = getPrizeEscrowPublicKey()
      if (!escrowAddress) {
        return { ok: false, httpStatus: 503, error: 'Prize escrow is not configured' }
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
          return {
            ok: false,
            httpStatus: 400,
            error:
              txIncomingRaw == null
                ? 'Could not read this deposit transaction, or it does not transfer the prize amount to escrow.'
                : `Deposit transfer sum (${txIncomingRaw.toString()} raw units) is below the declared prize (${requiredRaw.toString()} raw units).`,
          }
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
          return {
            ok: false,
            httpStatus: 400,
            error:
              'Escrow balance for this prize token is still below the declared prize amount. If you just transferred, wait for confirmation and retry, or provide deposit_tx.',
          }
        }
      }
      try {
        const frozen = await assertEscrowSplPrizeNotFrozen(new PublicKey(partner.mint))
        if (frozen.blocked) {
          return {
            ok: false,
            httpStatus: 400,
            error: frozen.error,
            frozenEscrowDiagnostics: frozen.diagnostics as FrozenEscrowDiagnostics,
          }
        }
      } catch {
        // ignore invalid mint
      }
      const now = new Date().toISOString()
      await updateRaffle(raffleId, {
        prize_deposited_at: now,
        is_active: true,
        prize_deposit_tx: depositTx,
        prize_standard: partner.tokenProgram === 'token2022' ? ('token2022' as const) : ('spl' as const),
      } as any)
      return {
        ok: true,
        prizeDepositedAt: now,
        prizeDepositTx: depositTx,
      }
    }

    if (raffle.prize_type !== 'nft') {
      return {
        ok: false,
        httpStatus: 400,
        error: 'This raffle does not have a prize that uses escrow verification',
      }
    }

    // Mpl Core prizes: check asset owner first. If that fails, fall through — DB may say Core while
    // the asset is SPL (or RPC/Core fetch failed); SPL + compressed paths below still apply.
    if ((raffle as any).prize_standard === 'mpl_core') {
      if (!raffle.nft_mint_address) {
        return { ok: false, httpStatus: 400, error: 'Missing NFT mint address' }
      }
      let inCoreEscrow = false
      try {
        inCoreEscrow = await isMplCoreAssetInEscrow(raffle.nft_mint_address)
      } catch {
        inCoreEscrow = false
      }
      if (inCoreEscrow) {
        const now = new Date().toISOString()
        await updateRaffle(raffleId, {
          prize_deposited_at: now,
          is_active: true,
          nft_mint_address: raffle.nft_mint_address,
        })
        return {
          ok: true,
          prizeDepositedAt: now,
          nftMintAddress: raffle.nft_mint_address,
        }
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
          const mintPkFromTx = new PublicKey(mintFromTx)
          let ata: PublicKey | null = null
          for (let attempt = 0; attempt < 6; attempt++) {
            ata = await getEscrowTokenAccountForMint(mintPkFromTx, connection)
            if (ata) break
            await new Promise((r) => setTimeout(r, 400))
          }
          if (!ata) {
            ata = await getEscrowTokenAccountForMint(mintPkFromTx)
          }
          const inCoreEscrow = ata ? true : await isMplCoreAssetInEscrow(mintFromTx).catch(() => false)
          if (ata || inCoreEscrow) {
            if (ata) {
              const frozen = await assertEscrowSplPrizeNotFrozen(mintPkFromTx)
              if (frozen.blocked) {
                return {
                  ok: false,
                  httpStatus: 400,
                  error: frozen.error,
                  frozenEscrowDiagnostics: frozen.diagnostics as FrozenEscrowDiagnostics,
                }
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
            await updateRaffle(raffleId, update as any)
            return {
              ok: true,
              prizeDepositedAt: now,
              nftMintAddress: mintFromTx,
              prizeDepositTx: depositTx,
            }
          }
          return {
            ok: false,
            httpStatus: 400,
            error: `Your deposit transaction appears to credit mint ${mintFromTx}, but prize escrow custody is not visible yet (RPC lag or indexing). Wait a few seconds and tap Verify again.`,
          }
        }
        // mintFromTx null: deposit may be compressed NFT or non-SPL layout — fall through to ATA / Core / held checks.
      }
    }

    // Confirm escrow holds this raffle's mint via ATA lookup. Handles RPC flakiness where
    // getParsedTokenAccountsByOwner returns nothing even though the escrow token account exists.
    if (preferredMint) {
      try {
        const mintPk = new PublicKey(preferredMint)
        const primaryConn = getSolanaConnection()
        let ataForPreferred: PublicKey | null = null
        for (let attempt = 0; attempt < 4; attempt++) {
          ataForPreferred = await getEscrowTokenAccountForMint(mintPk, primaryConn)
          if (ataForPreferred) break
          await new Promise((r) => setTimeout(r, 300))
        }
        if (!ataForPreferred) {
          ataForPreferred = await getEscrowTokenAccountForMint(mintPk)
        }
        if (ataForPreferred) {
          const frozen = await assertEscrowSplPrizeNotFrozen(mintPk)
          if (frozen.blocked) {
            return {
              ok: false,
              httpStatus: 400,
              error: frozen.error,
              frozenEscrowDiagnostics: frozen.diagnostics as FrozenEscrowDiagnostics,
            }
          }
          const now = new Date().toISOString()
          const tokenId =
            typeof raffle.nft_token_id === 'string' && raffle.nft_token_id.trim()
              ? raffle.nft_token_id.trim()
              : preferredMint
          await updateRaffle(raffleId, {
            prize_deposited_at: now,
            is_active: true,
            nft_mint_address: preferredMint,
            nft_token_id: tokenId,
            ...(depositTx ? { prize_deposit_tx: depositTx } : {}),
          } as any)
          return {
            ok: true,
            prizeDepositedAt: now,
            nftMintAddress: preferredMint,
            ...(depositTx ? { prizeDepositTx: depositTx } : {}),
          }
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
                  await updateRaffle(raffleId, {
                    prize_deposited_at: now,
                    is_active: true,
                    nft_mint_address: assetId,
                    nft_token_id: assetId,
                    prize_standard: 'compressed' as any,
                  } as any)
                  return {
                    ok: true,
                    prizeDepositedAt: now,
                    nftMintAddress: assetId,
                    prizeStandard: 'compressed',
                  }
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
          await updateRaffle(raffleId, {
            prize_deposited_at: now,
            is_active: true,
            prize_standard: 'mpl_core' as any,
            // Keep the canonical on-chain id in nft_mint_address for existing winner-claim flow.
            nft_mint_address: assetId,
          })
          return {
            ok: true,
            prizeDepositedAt: now,
            nftMintAddress: assetId,
            prizeStandard: 'mpl_core',
          }
        } catch {
          // continue trying other candidates
        }
      }
      return {
        ok: false,
        httpStatus: 400,
        error:
          'NFT not found in prize escrow. Complete the transfer using the button above, wait for confirmation, then try Verify again.',
      }
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
            await updateRaffle(raffleId, {
              prize_deposited_at: now,
              is_active: true,
              prize_standard: 'mpl_core' as any,
              // Canonical on-chain id for Core prize
              nft_mint_address: preferredMint,
              nft_token_id: preferredMint,
            } as any)
            return {
              ok: true,
              prizeDepositedAt: now,
              nftMintAddress: preferredMint,
              prizeStandard: 'mpl_core',
            }
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
                  await updateRaffle(raffleId, {
                    prize_deposited_at: now,
                    is_active: true,
                    nft_mint_address: assetId,
                    nft_token_id: assetId,
                    prize_standard: 'compressed' as any,
                  } as any)
                  return {
                    ok: true,
                    prizeDepositedAt: now,
                    nftMintAddress: assetId,
                    prizeStandard: 'compressed',
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

        const expect = preferredMint || '(not set)'
        const error = depositTx
          ? `Escrow holds multiple NFTs and we could not confirm your deposit transaction attributed prize mint ${expect}. Wait and tap Verify again, or check the deposit transaction on-chain.`
          : `The prize wallet already holds multiple NFTs from other raffles. Mint ${expect} is not in escrow yet — open this raffle and complete the deposit, then tap Verify. (If you meant a different NFT, fix the prize mint or contact support — we cannot guess which on-chain NFT is yours until it matches this mint or you register the deposit tx.)`
        return {
          ok: false,
          httpStatus: 400,
          error,
        }
      }
    }

    const frozen = await assertEscrowSplPrizeNotFrozen(new PublicKey(mintToSet))
    if (frozen.blocked) {
      return {
        ok: false,
        httpStatus: 400,
        error: frozen.error,
        frozenEscrowDiagnostics: frozen.diagnostics as FrozenEscrowDiagnostics,
      }
    }

    const now = new Date().toISOString()
    const mintChanged = mintToSet !== preferredMint
    await updateRaffle(raffleId, {
      prize_deposited_at: now,
      is_active: true,
      ...(mintChanged ? { nft_mint_address: mintToSet, nft_token_id: mintToSet } : {}),
      ...(depositTx ? { prize_deposit_tx: depositTx } : {}),
    })
    return {
      ok: true,
      prizeDepositedAt: now,
      nftMintAddress: mintToSet,
    }
  } catch (error) {
    console.error('Verify prize deposit error:', error)
    return { ok: false, httpStatus: 500, error: safeErrorMessage(error) }
  }
}
