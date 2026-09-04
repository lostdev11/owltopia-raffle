-- Optional Discord invite or project site on Partner Pro / white-label applications.

ALTER TABLE partner_program_applications
  ADD COLUMN IF NOT EXISTS community_url TEXT;

COMMENT ON COLUMN partner_program_applications.community_url IS
  'Optional HTTPS Discord invite or project URL submitted with Partner Pro / white-label applications.';
