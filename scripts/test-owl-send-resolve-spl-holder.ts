/**
 * Unit tests for OwlSend SPL / Token-2022 holder resolution.
 * Run: npx tsx scripts/test-owl-send-resolve-spl-holder.ts
 */
import assert from 'node:assert/strict'
import { Keypair, PublicKey, type AccountInfo, type Connection } from '@solana/web3.js'
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  AccountLayout,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token'
import {
  owlSendTokenAccountHint,
  resolveMintTokenProgram,
  resolveOwlSendSplHolder,
} from '@/lib/owl-send/resolve-spl-holder'

function encodeTokenAccount(params: {
  mint: PublicKey
  owner: PublicKey
  amount: bigint
}): Buffer {
  const data = Buffer.alloc(AccountLayout.span)
  AccountLayout.encode(
    {
      mint: params.mint,
      owner: params.owner,
      amount: params.amount,
      delegateOption: 0,
      delegate: PublicKey.default,
      state: 1,
      isNativeOption: 0,
      isNative: 0n,
      delegatedAmount: 0n,
      closeAuthorityOption: 0,
      closeAuthority: PublicKey.default,
    },
    data
  )
  return data
}

function mockConnection(accounts: Map<string, { owner: PublicKey; data: Buffer }>): Connection {
  return {
    getAccountInfo: async (pubkey: PublicKey) => {
      const hit = accounts.get(pubkey.toBase58())
      if (!hit) return null
      return {
        executable: false,
        owner: hit.owner,
        lamports: 1_000_000,
        data: hit.data,
        rentEpoch: 0,
      } satisfies AccountInfo<Buffer>
    },
    getParsedTokenAccountsByOwner: async () => ({ value: [] }),
  } as unknown as Connection
}

async function main() {
  {
    const mint = Keypair.generate().publicKey
    const accounts = new Map<string, { owner: PublicKey; data: Buffer }>()
    accounts.set(mint.toBase58(), {
      owner: TOKEN_2022_PROGRAM_ID,
      // Mint layout not needed — resolveMintTokenProgram only checks owner.
      data: Buffer.alloc(82),
    })
    const connection = mockConnection(accounts)
    const program = await resolveMintTokenProgram(connection, mint)
    assert.ok(program)
    assert.equal(program!.equals(TOKEN_2022_PROGRAM_ID), true)
  }

  {
    // Viking bug: DAS left tokenAccount=mint → old hint invented classic ATA →
    // createAssociatedTokenAccount(TOKEN_PROGRAM) against Token-2022 mint → IncorrectProgramId.
    const mint = Keypair.generate().publicKey
    const owner = Keypair.generate().publicKey
    const recipient = Keypair.generate().publicKey
    const t22Ata = getAssociatedTokenAddressSync(
      mint,
      owner,
      false,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    )
    const classicAta = getAssociatedTokenAddressSync(
      mint,
      owner,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    )
    assert.notEqual(t22Ata.toBase58(), classicAta.toBase58())

    const hint = owlSendTokenAccountHint({
      mint: mint.toBase58(),
      owner,
      tokenAccount: mint.toBase58(),
    })
    assert.equal(hint, mint.toBase58())

    const accounts = new Map<string, { owner: PublicKey; data: Buffer }>()
    accounts.set(mint.toBase58(), {
      owner: TOKEN_2022_PROGRAM_ID,
      data: Buffer.alloc(82),
    })
    accounts.set(t22Ata.toBase58(), {
      owner: TOKEN_2022_PROGRAM_ID,
      data: encodeTokenAccount({ mint, owner, amount: 1n }),
    })

    const connection = mockConnection(accounts)
    const holder = await resolveOwlSendSplHolder({
      connection,
      mint,
      owner,
      hintTokenAccount: hint,
    })
    assert.ok(holder)
    assert.equal(holder!.tokenProgram.equals(TOKEN_2022_PROGRAM_ID), true)
    assert.equal(holder!.tokenAccount.equals(t22Ata), true)

    // Destination ATA must also be Token-2022 (what send-spl-nft-batch builds).
    const destAta = getAssociatedTokenAddressSync(
      mint,
      recipient,
      false,
      holder!.tokenProgram,
      ASSOCIATED_TOKEN_PROGRAM_ID
    )
    const wrongDest = getAssociatedTokenAddressSync(
      mint,
      recipient,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    )
    assert.notEqual(destAta.toBase58(), wrongDest.toBase58())
  }

  {
    // Classic SPL Gen2 still resolves when hint is mint-as-tokenAccount.
    const mint = Keypair.generate().publicKey
    const owner = Keypair.generate().publicKey
    const classicAta = getAssociatedTokenAddressSync(
      mint,
      owner,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    )
    const accounts = new Map<string, { owner: PublicKey; data: Buffer }>()
    accounts.set(mint.toBase58(), {
      owner: TOKEN_PROGRAM_ID,
      data: Buffer.alloc(82),
    })
    accounts.set(classicAta.toBase58(), {
      owner: TOKEN_PROGRAM_ID,
      data: encodeTokenAccount({ mint, owner, amount: 1n }),
    })
    const connection = mockConnection(accounts)
    const holder = await resolveOwlSendSplHolder({
      connection,
      mint,
      owner,
      hintTokenAccount: mint.toBase58(),
    })
    assert.ok(holder)
    assert.equal(holder!.tokenProgram.equals(TOKEN_PROGRAM_ID), true)
    assert.equal(holder!.tokenAccount.equals(classicAta), true)
  }

  {
    // RPC flake on getAccount: mint is Token-2022 + hint equals T22 ATA → trust T22, not classic.
    const mint = Keypair.generate().publicKey
    const owner = Keypair.generate().publicKey
    const t22Ata = getAssociatedTokenAddressSync(
      mint,
      owner,
      false,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    )
    const accounts = new Map<string, { owner: PublicKey; data: Buffer }>()
    accounts.set(mint.toBase58(), {
      owner: TOKEN_2022_PROGRAM_ID,
      data: Buffer.alloc(82),
    })
    // No token account data — forces the mint-program trust path.
    const connection = mockConnection(accounts)
    const holder = await resolveOwlSendSplHolder({
      connection,
      mint,
      owner,
      hintTokenAccount: t22Ata.toBase58(),
    })
    assert.ok(holder)
    assert.equal(holder!.tokenProgram.equals(TOKEN_2022_PROGRAM_ID), true)
    assert.equal(holder!.tokenAccount.equals(t22Ata), true)
  }

  {
    // cNFT asset id: no SPL/Token-2022 mint account → null (special path), not invented classic ATA.
    const mint = Keypair.generate().publicKey
    const owner = Keypair.generate().publicKey
    const connection = mockConnection(new Map())
    const holder = await resolveOwlSendSplHolder({
      connection,
      mint,
      owner,
      hintTokenAccount: mint.toBase58(),
    })
    assert.equal(holder, null)
  }

  console.log('test-owl-send-resolve-spl-holder: ok')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
