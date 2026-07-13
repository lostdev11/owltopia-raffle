-- OWL token bundles in the points shop (admins list OWL for points; auto-deliver on purchase).

ALTER TABLE discord_marketplace_products
  ADD COLUMN IF NOT EXISTS product_kind TEXT NOT NULL DEFAULT 'generic'
    CHECK (product_kind IN ('generic', 'owl_tokens'));

COMMENT ON COLUMN discord_marketplace_products.product_kind IS
  'owl_tokens = points-priced OWL bundle with on-chain SPL delivery; generic = other points items.';

CREATE INDEX IF NOT EXISTS idx_discord_marketplace_products_kind
  ON discord_marketplace_products (discord_guild_id, product_kind, active)
  WHERE active = true;
