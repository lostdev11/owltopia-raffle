-- Extend theme_accent to support new accent options (ember, violet, coral)
ALTER TABLE raffles
  DROP CONSTRAINT IF EXISTS raffles_theme_accent_check;

ALTER TABLE raffles
  ADD CONSTRAINT raffles_theme_accent_check
  CHECK (theme_accent IN ('prime', 'midnight', 'dawn', 'ember', 'violet', 'coral'));
