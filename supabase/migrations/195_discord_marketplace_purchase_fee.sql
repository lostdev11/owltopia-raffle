-- Freeze ~$1 SOL platform fee (lamports) on Discord marketplace purchase intents at quote time.
ALTER TABLE discord_marketplace_nft_purchase_intents
  ADD COLUMN IF NOT EXISTS platform_fee_lamports BIGINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN discord_marketplace_nft_purchase_intents.platform_fee_lamports IS
  'Owltopia marketplace purchase fee in lamports (~$1 USD via Jupiter), paid to OWL_PLATFORM_FEE_TREASURY_WALLET in the same payment tx as the listing price.';
