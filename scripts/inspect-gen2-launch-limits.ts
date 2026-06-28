/** Read-only: print the gen2 launch DB limit/price fields relevant to public minting. */
import { getOwlCenterLaunchBySlug } from '@/lib/db/owl-center-launch'

async function main() {
  const l = await getOwlCenterLaunchBySlug('gen2')
  if (!l) throw new Error('gen2 launch not found')
  console.log({
    active_phase: l.active_phase,
    is_paused: l.is_paused,
    wallet_mint_limit: l.wallet_mint_limit,
    public_price_usdc: l.public_price_usdc,
    wl_price_usdc: l.wl_price_usdc,
    public_supply: l.public_supply,
    wl_supply: l.wl_supply,
    total_supply: l.total_supply,
    minted_count: l.minted_count,
  })
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('failed:', e)
    process.exit(1)
  })
