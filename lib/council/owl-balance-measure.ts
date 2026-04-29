/**
 * Single RPC read: total OWL (SPL) raw amount for a wallet (all token accounts for OWL mint).
 */

import { Connection, PublicKey } from '@solana/web3.js'
import { getTokenInfo, isOwlEnabled } from '@/lib/tokens'
import { resolveServerSolanaReadRpcUrl } from '@/lib/solana-rpc-url'

export async function measureOwlBalanceRaw(walletAddress: string): Promise<
  | { ok: true; totalRaw: bigint; decimals: number }
  | { ok: false; code: 'owl_disabled' | 'invalid_wallet' | 'rpc_error'; message: string }
> {
  const trimmed = walletAddress.trim()
  if (!trimmed) {
    return { ok: false, code: 'invalid_wallet', message: 'Wallet address required.' }
  }

  if (!isOwlEnabled()) {
    return {
      ok: false,
      code: 'owl_disabled',
      message:
        'OWL token is not configured (NEXT_PUBLIC_OWL_MINT_ADDRESS).',
    }
  }

  const owl = getTokenInfo('OWL')
  const mintStr = owl.mintAddress
  if (!mintStr) {
    return { ok: false, code: 'owl_disabled', message: 'OWL mint address missing.' }
  }

  let owner: PublicKey
  try {
    owner = new PublicKey(trimmed)
  } catch {
    return { ok: false, code: 'invalid_wallet', message: 'Invalid wallet address.' }
  }

  const connection = new Connection(resolveServerSolanaReadRpcUrl(), 'confirmed')
  const mintPk = new PublicKey(mintStr)

  let totalRaw = 0n

  try {
    const res = await connection.getParsedTokenAccountsByOwner(owner, { mint: mintPk })
    for (const { account } of res.value) {
      const parsed = account.data as { parsed?: { info?: { tokenAmount?: { amount?: string } } } }
      const info = parsed?.parsed?.info
      const amtStr = info?.tokenAmount?.amount
      if (typeof amtStr === 'string' && /^[0-9]+$/.test(amtStr)) {
        totalRaw += BigInt(amtStr)
      }
    }
  } catch (e) {
    console.error('[owl-balance-measure]', e instanceof Error ? e.message : e)
    return {
      ok: false,
      code: 'rpc_error',
      message: 'Could not read OWL balance from RPC.',
    }
  }

  return { ok: true, totalRaw, decimals: owl.decimals }
}
