/**
 * Unit tests for OwlSend CSV airdrop import.
 * Run: npx tsx scripts/test-owl-send-csv-import.ts
 */
import assert from 'node:assert/strict'
import { Keypair } from '@solana/web3.js'
import {
  canAccessOwlSendCsv,
  isOwlSendCsvPublic,
  isOwlSendCsvPublicClient,
} from '@/lib/owl-send/access'
import {
  isLikelyCsvFile,
  normalizeCsvText,
  owlSendCsvEntriesToNftPaste,
  owlSendCsvEntriesToTokenPaste,
  parseCsvLine,
  parseOwlSendCsv,
} from '@/lib/owl-send/csv-import'

const w1 = Keypair.generate().publicKey.toBase58()
const w2 = Keypair.generate().publicKey.toBase58()
const w3 = Keypair.generate().publicKey.toBase58()

assert.equal(canAccessOwlSendCsv({ isAdmin: true, publicOverride: false }), true)
assert.equal(canAccessOwlSendCsv({ isAdmin: false, publicOverride: false }), false)
assert.equal(canAccessOwlSendCsv({ isAdmin: false, publicOverride: true }), true)
assert.equal(typeof isOwlSendCsvPublic(), 'boolean')
assert.equal(typeof isOwlSendCsvPublicClient(), 'boolean')

assert.deepEqual(parseCsvLine('a,b,"c,d"'), ['a', 'b', 'c,d'])
assert.deepEqual(parseCsvLine('wallet;count'), ['wallet', 'count'])
assert.equal(normalizeCsvText('\uFEFFwallet\r\naddr\r'), 'wallet\naddr\n')

assert.equal(isLikelyCsvFile({ name: 'airdrop.csv', type: '' }), true)
assert.equal(isLikelyCsvFile({ name: 'list.TXT', type: 'text/plain' }), true)
assert.equal(isLikelyCsvFile({ name: 'photo.png', type: 'image/png' }), false)

{
  const empty = parseOwlSendCsv({ raw: '  \n  ', kind: 'nft' })
  assert.equal(empty.ok, false)
  assert.match(empty.error ?? '', /empty/i)
}

{
  const noWalletCol = parseOwlSendCsv({
    raw: 'name,email\nOwl,a@b.c\n',
    kind: 'nft',
  })
  assert.equal(noWalletCol.ok, false)
  assert.match(noWalletCol.error ?? '', /wallet column/i)
}

{
  const headerOnly = parseOwlSendCsv({ raw: 'wallet,count\n', kind: 'nft' })
  assert.equal(headerOnly.ok, false)
  assert.match(headerOnly.error ?? '', /no data/i)
}

{
  const nft = parseOwlSendCsv({
    raw: `wallet,count\n${w1},5\n${w2},1\nbadwallet,2\n${w3},3\n`,
    kind: 'nft',
  })
  assert.equal(nft.ok, true)
  assert.equal(nft.entries.length, 3)
  assert.equal(nft.entries[0]!.count, 5)
  assert.equal(nft.rowErrors.length, 1)
  assert.equal(nft.rowErrors[0]!.row, 4)
  const paste = owlSendCsvEntriesToNftPaste(nft.entries)
  assert.equal(paste, `${w1},5\n${w2},1\n${w3},3`)
}

{
  const walletsOnly = parseOwlSendCsv({
    raw: `${w1}\n${w2}\n${w3}`,
    kind: 'nft',
  })
  assert.equal(walletsOnly.ok, true)
  assert.equal(walletsOnly.entries.length, 3)
  assert.equal(owlSendCsvEntriesToNftPaste(walletsOnly.entries), `${w1}\n${w2}\n${w3}`)
}

{
  const headerlessCounts = parseOwlSendCsv({
    raw: `${w1},2\n${w2},3`,
    kind: 'nft',
  })
  assert.equal(headerlessCounts.ok, true)
  assert.equal(headerlessCounts.entries[0]!.count, 2)
  assert.equal(headerlessCounts.entries[1]!.count, 3)
}

{
  const token = parseOwlSendCsv({
    raw: `address,amount\n${w1},10\n${w2},2.5\n${w3},\n`,
    kind: 'token',
  })
  assert.equal(token.ok, true)
  assert.equal(token.entries.length, 3)
  assert.equal(token.entries[0]!.amountUi, '10')
  assert.equal(token.entries[1]!.amountUi, '2.5')
  assert.equal(token.entries[2]!.amountUi, null)
  assert.equal(
    owlSendCsvEntriesToTokenPaste(token.entries),
    `${w1},10\n${w2},2.5\n${w3}`
  )
}

{
  const quoted = parseOwlSendCsv({
    raw: `wallet\n"${w1}"\n`,
    kind: 'token',
  })
  assert.equal(quoted.ok, true)
  assert.equal(quoted.entries[0]!.recipient, w1)
}

{
  const many = Array.from({ length: 25 }, () => Keypair.generate().publicKey.toBase58())
  const capped = parseOwlSendCsv({
    raw: ['wallet', ...many].join('\n'),
    kind: 'nft',
    maxEntries: 20,
  })
  assert.equal(capped.ok, true)
  assert.equal(capped.entries.length, 20)
  assert.equal(capped.truncated, true)
  assert.ok(capped.warnings.some((w) => /20/.test(w)))
}

{
  const badCounts = parseOwlSendCsv({
    raw: `wallet,count\n${w1},0\n${w2},1.5\n`,
    kind: 'nft',
  })
  assert.equal(badCounts.ok, false)
  assert.equal(badCounts.rowErrors.length, 2)
}

console.log('test-owl-send-csv-import: ok')
