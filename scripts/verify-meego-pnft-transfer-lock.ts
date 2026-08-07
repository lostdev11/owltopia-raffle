/**
 * Live check: Meego #6896 looks frozen on-chain but has no lock delegate (pNFT).
 * Run: npx tsx scripts/verify-meego-pnft-transfer-lock.ts
 */
import { Connection, PublicKey } from '@solana/web3.js'
import { isNftHolderTransferLocked, tokenRecordAccountExists } from '@/lib/solana/nft-transfer-lock'

async function main() {
  const connection = new Connection('https://solana-rpc.publicnode.com', 'confirmed')
  const mint = new PublicKey('5ukof3zxAhBKqjicw7GtCzVLbWFXa4gJBNg8Y1MznGzL')
  const ata = new PublicKey('6He41hegCGmfq4NYYdTYXaebrDaBiyMMh4y1u949mjrK')
  const exists = await tokenRecordAccountExists(connection, mint, ata)
  const locked = await isNftHolderTransferLocked({
    connection,
    mint,
    holder: { isFrozen: true, hasDelegate: false, tokenAccount: ata },
  })
  console.log(JSON.stringify({ tokenRecordExists: exists, transferLocked: locked }, null, 2))
  if (!exists) throw new Error('expected token record for Meego pNFT')
  if (locked) throw new Error('Meego should not be transfer-locked')
  console.log('verify-meego-pnft-transfer-lock: ok')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
