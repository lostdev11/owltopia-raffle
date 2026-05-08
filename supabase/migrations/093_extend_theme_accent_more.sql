-- Align raffles.theme_accent CHECK with app THEME_ACCENT_VALUES (lib/types.ts): gold, sky, mint, indigo, fuchsia.
ALTER TABLE raffles
  DROP CONSTRAINT IF EXISTS raffles_theme_accent_check;

ALTER TABLE raffles
  ADD CONSTRAINT raffles_theme_accent_check
  CHECK (
    theme_accent IN (
      'prime',
      'midnight',
      'dawn',
      'ember',
      'violet',
      'coral',
      'gold',
      'sky',
      'mint',
      'indigo',
      'fuchsia'
    )
  );
