import crypto from 'crypto'
import fs from 'fs'

const ixDisc = (n) => [...crypto.createHash('sha256').update(`global:${n}`).digest().subarray(0, 8)]
const accDisc = (n) => [...crypto.createHash('sha256').update(`account:${n}`).digest().subarray(0, 8)]
const evDisc = (n) => [...crypto.createHash('sha256').update(`event:${n}`).digest().subarray(0, 8)]

const globalSeed = [...Buffer.from('global')]
const vaultSeed = [...Buffer.from('vault')]
const stakeSeed = [...Buffer.from('stake')]
const proposalSeed = [...Buffer.from('proposal')]
const voteSeed = [...Buffer.from('vote')]

const idl = {
  address: 'FwEAjseYTP6vTp9g6SpBTgySWzm4yxCtBc3Ti7Rvcfyz',
  metadata: {
    name: 'owltopia_governance',
    version: '0.1.0',
    spec: '0.1.0',
  },
  instructions: [
    {
      name: 'initialize',
      discriminator: ixDisc('initialize'),
      accounts: [
        { name: 'authority', writable: true, signer: true },
        {
          name: 'global',
          writable: true,
          pda: { seeds: [{ kind: 'const', value: globalSeed }] },
        },
        { name: 'owl_mint' },
        {
          name: 'vault',
          writable: true,
          pda: {
            seeds: [
              { kind: 'const', value: vaultSeed },
              { kind: 'account', path: 'global' },
            ],
          },
        },
        { name: 'system_program', address: '11111111111111111111111111111111' },
        { name: 'token_program', address: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
        { name: 'rent', address: 'SysvarRent111111111111111111111111111111111' },
      ],
      args: [
        { name: 'min_stake_to_propose', type: 'u64' },
        { name: 'vote_stake_weight_bps', type: 'u64' },
      ],
    },
    {
      name: 'stake',
      discriminator: ixDisc('stake'),
      accounts: [
        { name: 'user', writable: true, signer: true },
        {
          name: 'global',
          writable: true,
          pda: { seeds: [{ kind: 'const', value: globalSeed }] },
        },
        { name: 'owl_mint' },
        {
          name: 'vault',
          writable: true,
          pda: {
            seeds: [
              { kind: 'const', value: vaultSeed },
              { kind: 'account', path: 'global' },
            ],
          },
        },
        { name: 'user_owl_ata', writable: true },
        {
          name: 'user_stake',
          writable: true,
          pda: {
            seeds: [
              { kind: 'const', value: stakeSeed },
              { kind: 'account', path: 'user' },
            ],
          },
        },
        { name: 'system_program', address: '11111111111111111111111111111111' },
        { name: 'token_program', address: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
      ],
      args: [{ name: 'amount', type: 'u64' }],
    },
    {
      name: 'unstake',
      discriminator: ixDisc('unstake'),
      accounts: [
        { name: 'user', writable: true, signer: true },
        {
          name: 'global',
          writable: true,
          pda: { seeds: [{ kind: 'const', value: globalSeed }] },
        },
        { name: 'owl_mint' },
        {
          name: 'vault',
          writable: true,
          pda: {
            seeds: [
              { kind: 'const', value: vaultSeed },
              { kind: 'account', path: 'global' },
            ],
          },
        },
        { name: 'user_owl_ata', writable: true },
        {
          name: 'user_stake',
          writable: true,
          pda: {
            seeds: [
              { kind: 'const', value: stakeSeed },
              { kind: 'account', path: 'user' },
            ],
          },
        },
        { name: 'token_program', address: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
      ],
      args: [{ name: 'amount', type: 'u64' }],
    },
    {
      name: 'create_proposal',
      discriminator: ixDisc('create_proposal'),
      accounts: [
        { name: 'proposer', writable: true, signer: true },
        {
          name: 'global',
          writable: true,
          pda: { seeds: [{ kind: 'const', value: globalSeed }] },
        },
        { name: 'owl_mint' },
        {
          name: 'user_stake',
          pda: {
            seeds: [
              { kind: 'const', value: stakeSeed },
              { kind: 'account', path: 'proposer' },
            ],
          },
        },
        { name: 'proposal', writable: true },
        { name: 'system_program', address: '11111111111111111111111111111111' },
      ],
      args: [
        { name: 'title', type: 'string' },
        { name: 'voting_duration_secs', type: 'i64' },
      ],
    },
    {
      name: 'cast_vote',
      discriminator: ixDisc('cast_vote'),
      accounts: [
        { name: 'voter', writable: true, signer: true },
        {
          name: 'global',
          pda: { seeds: [{ kind: 'const', value: globalSeed }] },
        },
        { name: 'owl_mint' },
        { name: 'proposal', writable: true },
        {
          name: 'user_stake',
          pda: {
            seeds: [
              { kind: 'const', value: stakeSeed },
              { kind: 'account', path: 'voter' },
            ],
          },
        },
        { name: 'vote_receipt', writable: true },
        { name: 'system_program', address: '11111111111111111111111111111111' },
      ],
      args: [{ name: 'side', type: 'u8' }],
    },
  ],
  accounts: [
    { name: 'GlobalConfig', discriminator: accDisc('GlobalConfig') },
    { name: 'UserStake', discriminator: accDisc('UserStake') },
    { name: 'Proposal', discriminator: accDisc('Proposal') },
    { name: 'VoteReceipt', discriminator: accDisc('VoteReceipt') },
  ],
  types: [
    {
      name: 'GlobalConfig',
      type: {
        kind: 'struct',
        fields: [
          { name: 'authority', type: 'pubkey' },
          { name: 'owl_mint', type: 'pubkey' },
          { name: 'vault', type: 'pubkey' },
          { name: 'bump', type: 'u8' },
          { name: 'proposal_count', type: 'u64' },
          { name: 'min_voting_secs', type: 'i64' },
          { name: 'max_voting_secs', type: 'i64' },
          { name: 'min_stake_to_propose', type: 'u64' },
          { name: 'vote_stake_weight_bps', type: 'u64' },
        ],
      },
    },
    {
      name: 'UserStake',
      type: {
        kind: 'struct',
        fields: [
          { name: 'bump', type: 'u8' },
          { name: 'owner', type: 'pubkey' },
          { name: 'amount', type: 'u64' },
        ],
      },
    },
    {
      name: 'Proposal',
      type: {
        kind: 'struct',
        fields: [
          { name: 'id', type: 'u64' },
          { name: 'proposer', type: 'pubkey' },
          { name: 'voting_start', type: 'i64' },
          { name: 'voting_end', type: 'i64' },
          { name: 'title', type: 'string' },
          { name: 'yes_weight', type: 'u128' },
          { name: 'no_weight', type: 'u128' },
          { name: 'bump', type: 'u8' },
        ],
      },
    },
    {
      name: 'VoteReceipt',
      type: {
        kind: 'struct',
        fields: [
          { name: 'bump', type: 'u8' },
          { name: 'proposal', type: 'pubkey' },
          { name: 'voter', type: 'pubkey' },
          { name: 'side', type: 'u8' },
          { name: 'weight', type: 'u128' },
        ],
      },
    },
  ],
  events: [
    { name: 'ProposalCreated', discriminator: evDisc('ProposalCreated') },
    { name: 'VoteCast', discriminator: evDisc('VoteCast') },
  ],
}

const out = new URL('../lib/governance/owltopia_governance.json', import.meta.url)
fs.mkdirSync(new URL('.', out), { recursive: true })
fs.writeFileSync(out, JSON.stringify(idl, null, 2))
console.log('Wrote', out.pathname)
