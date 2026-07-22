-- Let applicants attach their community logo when applying to the partner program.

ALTER TABLE partner_program_applications
  ADD COLUMN IF NOT EXISTS logo_url TEXT;

COMMENT ON COLUMN partner_program_applications.logo_url IS
  'Public URL of the partner-supplied logo (uploaded via /api/partner-program/logo); reviewed by admins before use in the Partner Spotlight.';
