-- Partner program intake submissions for scaling onboarding.

CREATE TABLE IF NOT EXISTS partner_program_applications (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_name TEXT NOT NULL,
  contact_name TEXT,
  contact_handle TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  interested_tier TEXT NOT NULL,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS partner_program_applications_status_created_idx
  ON partner_program_applications (status, created_at DESC);

DROP TRIGGER IF EXISTS update_partner_program_applications_updated_at ON partner_program_applications;
CREATE TRIGGER update_partner_program_applications_updated_at
  BEFORE UPDATE ON partner_program_applications
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE partner_program_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "No direct reads for partner applications" ON partner_program_applications;
CREATE POLICY "No direct reads for partner applications"
  ON partner_program_applications
  FOR SELECT
  USING (false);

DROP POLICY IF EXISTS "No direct inserts for partner applications" ON partner_program_applications;
CREATE POLICY "No direct inserts for partner applications"
  ON partner_program_applications
  FOR INSERT
  WITH CHECK (false);

DROP POLICY IF EXISTS "No direct updates for partner applications" ON partner_program_applications;
CREATE POLICY "No direct updates for partner applications"
  ON partner_program_applications
  FOR UPDATE
  USING (false);

COMMENT ON TABLE partner_program_applications IS 'Inbound partner applications submitted via /partner-program form.';
