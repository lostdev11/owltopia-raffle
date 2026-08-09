/**
 * Shared client flow: send selected wallet NFT to prize escrow (same paths as raffle creation).
 */
import { PublicKey, Transaction } from '@solana/web3.js'
import type { Connection } from '@solana/web3.js'
import type { WalletAdapter } from '@solana/wallet-adapter-base'
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token'
import { confirmSignatureSuccessOnChain } from '@/lib/solana/confirm-signature-success'
import {
  logEscrowDepositAbort,
  logEscrowDepositPath,
  logEscrowDepositSigned,
  logEscrowDepositStart,
  type EscrowDepositLogBase,
} from '@/lib/solana/escrow-deposit-log'
import type { WalletSendTransactionFn } from '@/lib/solana/send-umi-builder-via-wallet'
import { tryEscrowDepositFallbacks } from '@/lib/solana/escrow-deposit-fallbacks'
import {
  isMplCoreNoApprovalsError,
  mplCoreNoApprovalsEscrowMessage,
} from '@/lib/solana/mpl-core-transfer-errors'
import { transferTokenMetadataNftToEscrow } from '@/lib/solana/token-metadata-transfer'
import { HOLDER_LOOKUP_MAX_ATTEMPTS } from '@/lib/solana/holder-lookup-retries'
import {
  getNftHolderInWalletWithRpcFallback,
  type NftHolderInWallet,
  type WalletNft,
} from '@/lib/solana/wallet-tokens'
import {
  isNftHolderTransferLocked,
  isProgrammableNftInterface,
} from '@/lib/solana/nft-transfer-lock'

export type SendTxFn = WalletSendTransactionFn

export type DepositPrizeNftToEscrowWalletParams = {
  connection: Connection
  publicKey: PublicKey
  sendTransaction: SendTxFn | undefined
  walletAdapter: WalletAdapter | null
  selectedNft: WalletNft
  /** Mint stored on giveaway/raffle (usually same as selectedNft.mint) */
  prizeMintAddress: string
  escrowAddress: string
  logCtx: EscrowDepositLogBase
}

export type DepositPrizeNftToEscrowWalletResult =
  | { ok: true; signature: string }
  | { ok: false; error: string; mplCoreNoApprovalsMintShort?: string; fullAssetId?: string }

export async function depositPrizeNftToEscrowFromWallet(
  params: DepositPrizeNftToEscrowWalletParams
): Promise<DepositPrizeNftToEscrowWalletResult> {
  const {
    connection,
    publicKey,
    sendTransaction,
    walletAdapter,
    selectedNft,
    prizeMintAddress,
    escrowAddress,
    logCtx,
  } = params

  const mintPk = new PublicKey(prizeMintAddress.trim())
  const escrowPubkey = new PublicKey(escrowAddress)

  logEscrowDepositStart({
    ...logCtx,
    dbPrizeStandard: null,
    displayLabel: selectedNft.name,
  })

  let resolvedHolder: NftHolderInWallet | null = null
  if (
    selectedNft?.tokenAccount &&
    selectedNft.tokenAccount !== selectedNft.mint
  ) {
    try {
      const selectedTokenAccount = new PublicKey(selectedNft.tokenAccount)
      const selectedInfo = await connection.getParsedAccountInfo(selectedTokenAccount, 'processed')
      const ownerProgram = selectedInfo.value?.owner
      const isSplProgram = ownerProgram?.equals(TOKEN_PROGRAM_ID) ?? false
      const isToken2022 = ownerProgram?.equals(TOKEN_2022_PROGRAM_ID) ?? false
      const info = (selectedInfo.value?.data as { parsed?: { info?: Record<string, unknown> } } | undefined)?.parsed
        ?.info
      const selectedMint = typeof info?.mint === 'string' ? info.mint : null
      const amountRaw =
        typeof info?.tokenAmount === 'object' && info?.tokenAmount
          ? (info.tokenAmount as { amount?: unknown }).amount
          : undefined
      const amount =
        typeof amountRaw === 'string' ? Number(amountRaw) : typeof amountRaw === 'number' ? amountRaw : 0
      // Gen2 CM thaw often leaves a leftover delegate — still owner-transferable when not frozen.
      // pNFTs often show state=frozen without a lock delegate — still transferable via Token Metadata.
      const state =
        typeof info?.state === 'string' ? String(info.state).toLowerCase() : ''
      const delegate = typeof info?.delegate === 'string' ? info.delegate : null
      const hasDelegate = Boolean(delegate)
      const isFrozen = state === 'frozen'
      const programmableHint = isProgrammableNftInterface(selectedNft.interface)
      const locked =
        isFrozen &&
        (programmableHint ? hasDelegate : true)
      if (selectedMint === mintPk.toBase58() && amount >= 1 && !locked) {
        if (isSplProgram) {
          resolvedHolder = {
            tokenProgram: TOKEN_PROGRAM_ID,
            tokenAccount: selectedTokenAccount,
            hasDelegate,
            isFrozen,
          }
        } else if (isToken2022) {
          resolvedHolder = {
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            tokenAccount: selectedTokenAccount,
            hasDelegate,
            isFrozen,
          }
        }
      }
    } catch {
      // Fall through to holder lookup retries.
    }
  }

  for (let attempt = 0; attempt < HOLDER_LOOKUP_MAX_ATTEMPTS; attempt++) {
    if (resolvedHolder) break
    const h = await getNftHolderInWalletWithRpcFallback(connection, mintPk, publicKey, 'processed')
    if (h && 'tokenProgram' in h && 'tokenAccount' in h) {
      if (
        await isNftHolderTransferLocked({
          connection,
          mint: mintPk,
          holder: h,
          programmableNftHint: isProgrammableNftInterface(selectedNft.interface) ? true : null,
          commitment: 'processed',
        })
      ) {
        return {
          ok: false,
          error:
            'This NFT is frozen on-chain (nested or mint-locked). Unnest/thaw it before sending to escrow. A leftover Gen2 stake delegate alone is fine. Programmable NFTs (pNFTs) that only show frozen without a lock delegate are transferable.',
        }
      }
      resolvedHolder = h
      break
    }
    if (attempt < HOLDER_LOOKUP_MAX_ATTEMPTS - 1) {
      await new Promise((r) => setTimeout(r, 700))
    }
  }

  let depositSig: string | null = null

  if (resolvedHolder) {
    const { tokenProgram, tokenAccount: sourceTokenAccount } = resolvedHolder
    if (walletAdapter && tokenProgram.equals(TOKEN_PROGRAM_ID)) {
      try {
        logEscrowDepositPath(logCtx, 'token_metadata')
        depositSig = await transferTokenMetadataNftToEscrow({
          connection,
          wallet: walletAdapter,
          mintAddress: prizeMintAddress.trim(),
          escrowAddress,
          sendTransaction,
        })
        logEscrowDepositSigned(logCtx, 'token_metadata', depositSig)
      } catch (tmErr) {
        logEscrowDepositAbort(logCtx, 'token_metadata_failed_trying_spl', {
          detail: tmErr instanceof Error ? tmErr.message : String(tmErr),
        })
        depositSig = null
      }
    }
    if (!depositSig) {
      if (!sendTransaction) {
        logEscrowDepositAbort(logCtx, 'no_send_transaction_after_token_metadata')
        return {
          ok: false,
          error:
            'Your wallet did not expose a transaction sender. Try another wallet or send the NFT manually and verify.',
        }
      }
      const escrowAta = await getAssociatedTokenAddress(
        mintPk,
        escrowPubkey,
        false,
        tokenProgram,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
      const tx = new Transaction()
      try {
        await getAccount(connection, escrowAta, 'confirmed', tokenProgram)
      } catch {
        tx.add(
          createAssociatedTokenAccountInstruction(
            publicKey,
            escrowAta,
            escrowPubkey,
            mintPk,
            tokenProgram,
            ASSOCIATED_TOKEN_PROGRAM_ID
          )
        )
      }
      tx.add(
        createTransferInstruction(sourceTokenAccount, escrowAta, publicKey, 1n, [], tokenProgram)
      )
      logEscrowDepositPath(logCtx, 'spl_transfer', {
        tokenProgram: tokenProgram.toBase58(),
        sourceTokenAccount: sourceTokenAccount.toBase58(),
        escrowAta: escrowAta.toBase58(),
      })
      depositSig = await sendTransaction(tx, connection, {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
        maxRetries: 3,
      })
      await confirmSignatureSuccessOnChain(connection, depositSig)
      logEscrowDepositSigned(logCtx, 'spl_transfer', depositSig)
    }
  } else if (walletAdapter) {
    const fallback = await tryEscrowDepositFallbacks({
      connection,
      wallet: walletAdapter,
      assetId: selectedNft.mint,
      escrowAddress,
      sendTransaction,
      logCtx,
      dasInterface: selectedNft.interface,
      compressedHint: selectedNft.compressed,
      skipTokenMetadata: false,
    })
    if (fallback.ok) {
      depositSig = fallback.signature
    } else {
      const mintShort =
        selectedNft.mint.length > 16
          ? `${selectedNft.mint.slice(0, 4)}…${selectedNft.mint.slice(-4)}`
          : selectedNft.mint
      if (
        fallback.mplCoreNoApprovals ||
        (fallback.lastError && isMplCoreNoApprovalsError(fallback.lastError))
      ) {
        return {
          ok: false,
          error: mplCoreNoApprovalsEscrowMessage(mintShort, { fullAssetId: selectedNft.mint }),
          mplCoreNoApprovalsMintShort: mintShort,
          fullAssetId: selectedNft.mint,
        }
      }
      logEscrowDepositAbort(logCtx, 'no_path_deposit_prize_nft')
      return {
        ok: false,
        error:
          fallback.displayError ||
          'Could not send this NFT to escrow (tried Metaplex token metadata, SPL, compressed, and Core). Check Wi‑Fi / RPC or deposit manually.',
      }
    }
  } else {
    logEscrowDepositAbort(logCtx, 'no_wallet_adapter_for_core_compressed')
    return {
      ok: false,
      error:
        'Could not confirm this NFT as SPL in your wallet yet, and the wallet adapter is not ready for Core/compressed transfers.',
    }
  }

  return { ok: true, signature: depositSig }
}
