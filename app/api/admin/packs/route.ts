import { NextRequest, NextResponse } from 'next/server'
import { PublicKey } from '@solana/web3.js'
import { requireFullAdminSession } from '@/lib/auth-server'
import {
  addPackInventoryNft,
  countAvailableNfts,
  getPackVaultConfig,
  listPackInventory,
  removePackInventoryNft,
  updatePackVaultConfig,
} from '@/lib/packs/db'
import { simulatePackEvFromInventory } from '@/lib/packs/ev-simulator'
import { isPackInventoryPrizeStandard } from '@/lib/packs/types'
import { getPacksVaultPublicKey, getPacksVaultSolBalance } from '@/lib/packs/vault'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const session = await requireFullAdminSession(request)
  if (session instanceof NextResponse) return session

  try {
    const config = await getPackVaultConfig()
    const inventory = await listPackInventory()
    const nftCount = await countAvailableNfts()
    const solBal = await getPacksVaultSolBalance()
    const ev = simulatePackEvFromInventory({
      owlSolPrice: config.owl_sol_price,
      inventory,
    })

    return NextResponse.json({
      vault: {
        configuredAddress: getPacksVaultPublicKey(),
        dbPubkey: config.vault_pubkey,
        paused: config.paused,
        pauseReason: config.pause_reason,
        minOwlBalance: config.min_owl_balance,
        minSolBalance: config.min_sol_balance,
        minNftCount: config.min_nft_count,
        owlSolPrice: config.owl_sol_price,
        solBalance: solBal,
        availableNfts: nftCount,
      },
      ev,
      inventory,
    })
  } catch (e) {
    console.error('[admin packs] GET', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to load packs admin' },
      { status: 500 }
    )
  }
}

export async function PATCH(request: NextRequest) {
  const session = await requireFullAdminSession(request)
  if (session instanceof NextResponse) return session

  try {
    const body = await request.json().catch(() => ({}))
    const patch: Parameters<typeof updatePackVaultConfig>[0] = {}

    if (typeof body.paused === 'boolean') patch.paused = body.paused
    if (typeof body.pause_reason === 'string' || body.pause_reason === null) {
      patch.pause_reason = body.pause_reason
    }
    if (typeof body.owl_sol_price === 'number' || body.owl_sol_price === null) {
      patch.owl_sol_price = body.owl_sol_price
    }
    if (typeof body.min_nft_count === 'number') patch.min_nft_count = body.min_nft_count
    if (typeof body.min_sol_balance === 'number') patch.min_sol_balance = body.min_sol_balance
    if (typeof body.min_owl_balance === 'number') patch.min_owl_balance = body.min_owl_balance

    const vault = getPacksVaultPublicKey()
    if (vault) patch.vault_pubkey = vault

    if (body.paused === false) {
      const nftCount = await countAvailableNfts()
      const minNft = typeof body.min_nft_count === 'number' ? body.min_nft_count : undefined
      const config = await getPackVaultConfig()
      const need = minNft ?? config.min_nft_count
      if (nftCount < need) {
        return NextResponse.json(
          { error: `Cannot unpause: need ${need} NFT(s), have ${nftCount}` },
          { status: 400 }
        )
      }
      if (!getPacksVaultPublicKey()) {
        return NextResponse.json(
          { error: 'Cannot unpause: PACKS_VAULT_SECRET_KEY / wallet not configured' },
          { status: 400 }
        )
      }
      patch.pause_reason = null
    } else if (body.paused === true && patch.pause_reason === undefined) {
      patch.pause_reason = 'Paused by admin'
    }

    const updated = await updatePackVaultConfig(patch)
    return NextResponse.json({ ok: true, vault: updated })
  } catch (e) {
    console.error('[admin packs] PATCH', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Update failed' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  const session = await requireFullAdminSession(request)
  if (session instanceof NextResponse) return session

  try {
    const body = await request.json().catch(() => ({}))
    const mint = typeof body.mint_address === 'string' ? body.mint_address.trim() : ''
    const fair = Number(body.fair_value_sol)
    if (!mint || !(fair >= 0.05 && fair <= 0.5)) {
      return NextResponse.json(
        { error: 'mint_address and fair_value_sol (0.05–0.5) required' },
        { status: 400 }
      )
    }
    try {
       
      new PublicKey(mint)
    } catch {
      return NextResponse.json({ error: 'Invalid mint address' }, { status: 400 })
    }

    const prizeStandardRaw = body.prize_standard
    const prize_standard = prizeStandardRaw == null || prizeStandardRaw === ''
      ? 'spl'
      : prizeStandardRaw
    if (!isPackInventoryPrizeStandard(prize_standard)) {
      return NextResponse.json(
        { error: 'prize_standard must be spl, mpl_core, or compressed' },
        { status: 400 }
      )
    }

    const row = await addPackInventoryNft({
      mint_address: mint,
      name: typeof body.name === 'string' ? body.name : null,
      image_url: typeof body.image_url === 'string' ? body.image_url : null,
      fair_value_sol: fair,
      prize_standard,
    })
    return NextResponse.json({ ok: true, item: row })
  } catch (e) {
    console.error('[admin packs] POST inventory', e)
    const msg = e instanceof Error ? e.message : 'Failed to add NFT'
    if (/pack_inventory_mint_available|duplicate key/i.test(msg)) {
      return NextResponse.json(
        { error: 'That mint is already available or reserved in inventory' },
        { status: 400 }
      )
    }
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}

export async function DELETE(request: NextRequest) {
  const session = await requireFullAdminSession(request)
  if (session instanceof NextResponse) return session

  try {
    const id = request.nextUrl.searchParams.get('id')?.trim()
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    await removePackInventoryNft(id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[admin packs] DELETE', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Delete failed' },
      { status: 400 }
    )
  }
}
