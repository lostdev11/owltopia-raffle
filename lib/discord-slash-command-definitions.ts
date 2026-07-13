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
      name: 'browse-nfts',
      description: 'List NFTs for sale (priced in SOL or OWL)',
      type: 1,
    },
    {
      name: 'buy',
      description: 'Purchase a points shop item (requires linked wallet)',
      type: 1,
      options: [
        {
          name: 'product',
          description: 'Product slug from /owltopia-shop browse',
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
      name: 'admin',
      description: 'Manage shop products, NFT listings, and points (admin/founder)',
      type: 1,
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
            { name: 'user', description: 'Discord user id (snowflake)', type: 3, required: true },
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

export const ALL_DISCORD_SLASH_COMMANDS = [
  OWLTOPIA_PARTNER_SLASH_COMMAND,
  OWLTOPIA_SHOP_SLASH_COMMAND,
] as const
