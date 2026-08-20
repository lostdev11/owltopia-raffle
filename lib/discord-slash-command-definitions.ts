/**
 * Global application commands for Discord (PUT …/applications/{app.id}/commands).
 * @see https://discord.com/developers/docs/interactions/application-commands
 */
export const OWLTOPIA_PARTNER_SLASH_COMMAND = {
  name: 'owltopia-partner',
  description: 'Owltopia paid Discord giveaway bridge (Solana USDC + webhooks)',
  type: 1,
  dm_permission: false,
  options: [
    {
      name: 'subscribe',
      description: 'Get Solana USDC payment instructions for this server',
      type: 1,
    },
    {
      name: 'verify',
      description: 'Verify USDC payment using the Solana transaction signature',
      type: 1,
      options: [
        {
          name: 'signature',
          description: 'Solana transaction signature (base58)',
          type: 3,
          required: true,
        },
      ],
    },
    {
      name: 'webhook',
      description: 'Set the channel incoming webhook URL for giveaway pings',
      type: 1,
      options: [
        {
          name: 'url',
          description: 'https://discord.com/api/webhooks/…',
          type: 3,
          required: true,
        },
      ],
    },
    {
      name: 'webhook-raffle-created',
      description: 'Set incoming webhook for new ticket raffles (partner creator announcements)',
      type: 1,
      options: [
        {
          name: 'url',
          description: 'https://discord.com/api/webhooks/…',
          type: 3,
          required: true,
        },
      ],
    },
    {
      name: 'webhook-raffle-winner',
      description: 'Set incoming webhook for ticket raffle winner draws (claim on owltopia dashboard)',
      type: 1,
      options: [
        {
          name: 'url',
          description: 'https://discord.com/api/webhooks/…',
          type: 3,
          required: true,
        },
      ],
    },
    {
      name: 'status',
      description: 'Show subscription, webhook, and API status for this server',
      type: 1,
    },
  ],
} as const

export const OWLTOPIA_SHOP_SLASH_COMMAND = {
  name: 'owltopia-shop',
  description: 'Owltopia shop — points, NFTs (SOL/OWL), wallet linking, auto-delivery',
  type: 1,
  dm_permission: false,
  options: [
    {
      name: 'browse',
      description: 'List points items and NFT listings in this server shop',
      type: 1,
    },
    {
      name: 'browse-owl',
      description: 'List OWL token bundles for sale (pay with points)',
      type: 1,
    },
    {
      name: 'browse-nfts',
      description: 'List NFTs for sale (priced in SOL or OWL)',
      type: 1,
    },
    {
      name: 'buy',
      description: 'Purchase a points shop item (OWL bundles, tickets, etc.)',
      type: 1,
      options: [
        {
          name: 'product',
          description: 'Product slug from browse or browse-owl',
          type: 3,
          required: true,
        },
      ],
    },
    {
      name: 'buy-nft',
      description: 'Get payment instructions for an NFT listing (SOL or OWL)',
      type: 1,
      options: [
        {
          name: 'listing',
          description: 'Listing slug from browse-nfts',
          type: 3,
          required: true,
        },
      ],
    },
    {
      name: 'verify-nft',
      description: 'Verify SOL/OWL payment and receive your NFT automatically',
      type: 1,
      options: [
        {
          name: 'signature',
          description: 'Solana transaction signature (base58)',
          type: 3,
          required: true,
        },
      ],
    },
    {
      name: 'wallet',
      description: 'Check your linked Solana wallet or get a connect link',
      type: 1,
    },
    {
      name: 'connect-wallet',
      description: 'Get a link to connect your Solana wallet for auto-delivery',
      type: 1,
    },
    {
      name: 'balance',
      description: 'Show your points balance in this server',
      type: 1,
    },
    {
      name: 'purchases',
      description: 'Show your recent shop purchases',
      type: 1,
    },
    {
      name: 'grant-points',
      description: 'Admin: add or remove shop points for a member',
      type: 1,
      options: [
        {
          name: 'member',
          description: 'Discord member to credit or debit',
          type: 6,
          required: true,
        },
        {
          name: 'amount',
          description: 'Points to add (use a negative number to deduct)',
          type: 4,
          required: true,
        },
      ],
    },
    {
      // Must be SUB_COMMAND_GROUP (2). Discord rejects SUB_COMMAND nesting (type 1 → type 1).
      name: 'admin',
      description: 'Manage shop products, NFT listings, and points (admin/founder)',
      type: 2,
      options: [
        {
          name: 'add-product',
          description: 'Add or update a points shop product',
          type: 1,
          options: [
            { name: 'name', description: 'Display name', type: 3, required: true },
            { name: 'points', description: 'Points cost', type: 4, required: true },
            { name: 'owl', description: 'OWL amount to auto-send on purchase', type: 10, required: false },
            { name: 'slug', description: 'URL slug (defaults from name)', type: 3, required: false },
            { name: 'description', description: 'Optional description', type: 3, required: false },
          ],
        },
        {
          name: 'list-owl',
          description: 'List OWL tokens for sale (users pay with points, auto-delivered on buy)',
          type: 1,
          options: [
            { name: 'owl', description: 'OWL amount delivered per purchase', type: 10, required: true },
            { name: 'points', description: 'Points cost', type: 4, required: true },
            { name: 'name', description: 'Display name (optional)', type: 3, required: false },
            { name: 'slug', description: 'Listing slug (optional)', type: 3, required: false },
          ],
        },
        {
          name: 'list-nft',
          description: 'List an NFT for sale in SOL or OWL (deposit to escrow after)',
          type: 1,
          options: [
            { name: 'mint', description: 'NFT mint / asset address', type: 3, required: true },
            { name: 'price', description: 'Price in SOL or OWL', type: 10, required: true },
            {
              name: 'currency',
              description: 'Payment currency',
              type: 3,
              required: true,
              choices: [
                { name: 'SOL', value: 'SOL' },
                { name: 'OWL', value: 'OWL' },
              ],
            },
            { name: 'name', description: 'Display name (optional)', type: 3, required: false },
            { name: 'slug', description: 'Listing slug (optional)', type: 3, required: false },
          ],
        },
        {
          name: 'verify-nft-deposit',
          description: 'Confirm NFT arrived in escrow and publish listing',
          type: 1,
          options: [
            { name: 'listing', description: 'Listing slug', type: 3, required: true },
            {
              name: 'signature',
              description: 'Deposit transaction signature (optional if already in escrow)',
              type: 3,
              required: false,
            },
          ],
        },
        {
          name: 'list-nfts',
          description: 'List all NFT marketplace listings',
          type: 1,
        },
        {
          name: 'remove-nft',
          description: 'Remove a listing (does not return NFT on-chain)',
          type: 1,
          options: [{ name: 'listing', description: 'Listing slug', type: 3, required: true }],
        },
        {
          name: 'grant-points',
          description: 'Add or remove points for a Discord user',
          type: 1,
          options: [
            { name: 'member', description: 'Discord member to credit or debit', type: 6, required: true },
            { name: 'amount', description: 'Points to add (negative to deduct)', type: 4, required: true },
          ],
        },
        {
          name: 'list-products',
          description: 'List all points products including inactive',
          type: 1,
        },
      ],
    },
  ],
} as const

/**
 * Free platform raffle feed: any server that adds the bot can opt a channel into new public raffle posts.
 */
export const OWLTOPIA_ALERTS_SLASH_COMMAND = {
  name: 'owltopia-alerts',
  description: 'Get free updates when new public Owltopia raffles go live',
  type: 1,
  dm_permission: false,
  options: [
    {
      name: 'enable',
      description: 'Post new public live raffles to a channel in this server',
      type: 1,
      options: [
        {
          name: 'channel',
          description: 'Text channel where raffle alerts should be posted',
          type: 7,
          required: true,
          channel_types: [0, 5],
        },
      ],
    },
    {
      name: 'disable',
      description: 'Stop raffle alert posts in this server',
      type: 1,
    },
    {
      name: 'status',
      description: 'Show whether raffle alerts are enabled and which channel',
      type: 1,
    },
  ],
} as const

export const OWLTOPIA_WL_SLASH_COMMAND = {
  name: 'owltopia-wl',
  description: 'Collect Solana whitelist wallets in this server (Partner Pro)',
  type: 1,
  dm_permission: false,
  options: [
    {
      name: 'setup',
      description: 'Step-by-step checklist for your first whitelist spot',
      type: 1,
    },
    {
      name: 'create',
      description: 'Open a new whitelist collection spot in a channel',
      type: 1,
      options: [
        { name: 'name', description: 'Shown on the embed (e.g. OG Whitelist)', type: 3, required: true },
        {
          name: 'phase',
          description: 'Allowlist phase (default: Whitelist)',
          type: 3,
          required: false,
          choices: [
            { name: 'Team', value: 'team' },
            { name: 'OG', value: 'og' },
            { name: 'Whitelist', value: 'wl' },
            { name: 'WL 2', value: 'wl2' },
            { name: 'WL 3', value: 'wl3' },
          ],
        },
        {
          name: 'channel',
          description: 'Channel for the Submit wallet button (defaults to here)',
          type: 7,
          required: false,
          channel_types: [0, 5],
        },
        {
          name: 'max',
          description: 'Optional cap (auto-closes when full)',
          type: 4,
          required: false,
          min_value: 1,
        },
        {
          name: 'spots',
          description: 'Mint spots per wallet when pushed to Owl Center (default 1)',
          type: 4,
          required: false,
          min_value: 1,
          max_value: 50,
        },
        {
          name: 'role',
          description: 'Optional Discord role required to submit',
          type: 8,
          required: false,
        },
        {
          name: 'launch',
          description: 'Owl Center collection slug or id (optional)',
          type: 3,
          required: false,
        },
      ],
    },
    {
      name: 'open',
      description: 'Post or turn the Submit wallet button back on',
      type: 1,
      options: [{ name: 'spot', description: 'Spot name or id (defaults to this channel)', type: 3, required: false }],
    },
    {
      name: 'close',
      description: 'Stop new submissions (you can reopen later)',
      type: 1,
      options: [{ name: 'spot', description: 'Spot name or id (defaults to this channel)', type: 3, required: false }],
    },
    {
      name: 'status',
      description: 'How many wallets registered and whether it’s open',
      type: 1,
      options: [{ name: 'spot', description: 'Spot name or id (defaults to this channel)', type: 3, required: false }],
    },
    {
      name: 'list',
      description: 'All whitelist spots in this server',
      type: 1,
    },
    {
      name: 'export',
      description: 'Download wallet list (link to dashboard CSV)',
      type: 1,
      options: [{ name: 'spot', description: 'Spot name or id (defaults to this channel)', type: 3, required: false }],
    },
    {
      name: 'push',
      description: 'Send wallets to your Owl Center mint list',
      type: 1,
      options: [
        { name: 'spot', description: 'Spot name or id (defaults to this channel)', type: 3, required: false },
        { name: 'launch', description: 'Owl Center collection slug or id', type: 3, required: false },
      ],
    },
    {
      name: 'remove',
      description: 'Remove a wallet or Discord member from a spot',
      type: 1,
      options: [
        { name: 'spot', description: 'Spot name or id (defaults to this channel)', type: 3, required: false },
        { name: 'wallet', description: 'Solana wallet to remove', type: 3, required: false },
        { name: 'member', description: 'Discord member to remove', type: 6, required: false },
      ],
    },
  ],
} as const

export const ALL_DISCORD_SLASH_COMMANDS = [
  OWLTOPIA_PARTNER_SLASH_COMMAND,
  OWLTOPIA_SHOP_SLASH_COMMAND,
  OWLTOPIA_ALERTS_SLASH_COMMAND,
  OWLTOPIA_WL_SLASH_COMMAND,
] as const
