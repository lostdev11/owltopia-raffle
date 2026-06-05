-- Owl Center: curated collection hub pages (marketing copy + CTAs; public read when published).

CREATE TABLE IF NOT EXISTS owl_center_collection_launches (
  slug text PRIMARY KEY,
  title text NOT NULL,
  tagline text,
  description text,
  features jsonb NOT NULL DEFAULT '[]'::jsonb,
  hero_video_path text,
  hero_poster_path text,
  hero_image_path text,
  primary_cta_label text NOT NULL DEFAULT 'Learn more',
  primary_cta_href text NOT NULL DEFAULT '/',
  secondary_cta_label text,
  secondary_cta_href text,
  published boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT owl_center_collection_launches_features_is_array CHECK (jsonb_typeof(features) = 'array')
);

COMMENT ON TABLE owl_center_collection_launches IS 'Owl Center collection launches; anon SELECT only when published=true.';

CREATE INDEX IF NOT EXISTS idx_owl_center_collection_launches_published ON owl_center_collection_launches (published)
  WHERE published = true;

ALTER TABLE owl_center_collection_launches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read published owl center launches" ON owl_center_collection_launches;
CREATE POLICY "Public read published owl center launches"
  ON owl_center_collection_launches
  FOR SELECT
  USING (published = true);

-- Gen2 seed launch (edit copy in SQL or future admin UI).
INSERT INTO owl_center_collection_launches (
  slug,
  title,
  tagline,
  description,
  features,
  hero_video_path,
  hero_poster_path,
  hero_image_path,
  primary_cta_label,
  primary_cta_href,
  secondary_cta_label,
  secondary_cta_href,
  published,
  updated_at
)
VALUES (
  'gen2',
  'Owltopia Gen2',
  'The next evolution of the parliament — secure your mint allocation early.',
  E'Owltopia Gen2 expands the world with a new avatar generation. Start with the presale: each spot you buy is recorded as one mint credit on your wallet for redemption when the public mint opens.\n\nPay in SOL at a live USDC-equivalent rate in a single transaction. Connect on mobile with Phantom or Solflare — same flow as the rest of Owltopia.',
  '[
    {"title": "Presale → mint credits", "body": "One confirmed presale spot equals one Gen2 mint when redemption goes live — tracked per wallet, no separate SPL token."},
    {"title": "Pay in SOL", "body": "Pricing is quoted in USDC; the site calculates the SOL amount from a live rate so your transaction matches what you approved."},
    {"title": "Built for mobile", "body": "Most collectors connect from their phone — wallet connect stays front and center, with touch-friendly targets."},
    {"title": "Transparency", "body": "Live allocation progress and remaining supply update as purchases confirm on-chain."}
  ]'::jsonb,
  '/videos/owltopia-gen2-presale-bg.mp4',
  '/images/owltopia-gen2-presale-poster.jpg',
  '/images/gen2-logo-mark.png',
  'Open Gen2 presale',
  '/gen2-presale',
  'How it works',
  '/gen2-presale#gen2-how',
  true,
  now()
)
ON CONFLICT (slug) DO NOTHING;
