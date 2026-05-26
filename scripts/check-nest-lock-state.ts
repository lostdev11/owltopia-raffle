/**
 * Inspect MPL Core freeze state for Owl Nest mints (support / debugging).
 * Usage: npx --yes tsx scripts/check-nest-lock-state.ts <mint> [mint2...]
 */
import { loadEnvConfig } from '@next/env'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { publicKey } from '@metaplex-foundation/umi'
import { fetchAsset } from '@metaplex-foundation/mpl-core'
import {
  isMplCoreNestingLockHeld,
  mplCoreNestCanServerRefreeze,
  mplCoreNestNeedsWalletRelock,
  readMplCoreFreezeDelegate,
} from '@/lib/solana/mpl-core-nest-lock'
import { getNestingNftFreezeDelegateAddress } from '@/lib/nesting/nft-freeze'
import { resolveServerSolanaRpcUrl } from '@/lib/solana-rpc-url'

loadEnvConfig(process.cwd())

const ownerArg = process.argv.find((a) => a.startsWith('--owner='))
const owner = ownerArg?.slice('--owner='.length)
const mints = process.argv.slice(2).filter((a) => !a.startsWith('--owner='))

if (mints.length === 0) {
  console.error('Usage: npx --yes tsx scripts/check-nest-lock-state.ts <mint> ... [--owner=<wallet>]')
  process.exit(1)
}

async function main() {
  const delegate = getNestingNftFreezeDelegateAddress()
  const rpc = resolveServerSolanaRpcUrl()
  const umi = createUmi(rpc)
  console.log({ delegate: delegate || '(not configured)', rpc: rpc.slice(0, 48) + '…' })

  for (const id of mints) {
    const asset = await fetchAsset(umi, publicKey(id.trim()))
    const fd = readMplCoreFreezeDelegate(asset)
    const params = {
      asset,
      nestingDelegateAddress: delegate,
      ownerWallet: owner ?? String(asset.owner),
    }
    console.log(id, {
      owner: String(asset.owner),
      freezeDelegate: fd,
      lockHeld: isMplCoreNestingLockHeld(params),
      needsWalletRelock: mplCoreNestNeedsWalletRelock({
        asset,
        nestingDelegateAddress: delegate,
        ownerWallet: params.ownerWallet,
      }),
      canServerRefreeze: mplCoreNestCanServerRefreeze({
        asset,
        nestingDelegateAddress: delegate,
      }),
    })
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
