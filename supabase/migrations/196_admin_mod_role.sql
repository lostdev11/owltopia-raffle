-- Junior admin (mod) role for Owl Vision support tools.
-- mod: stuck tickets, inbox triage, announcements/Discord/council, read-only monitoring.
-- full: refunds, winners, prize moves, nesting heal, treasury, irreversible ops.

ALTER TABLE public.admins DROP CONSTRAINT IF EXISTS admins_role_check;

ALTER TABLE public.admins
  ADD CONSTRAINT admins_role_check CHECK (role IN ('full', 'mod'));

COMMENT ON COLUMN public.admins.role IS
  'full: full Owl Vision; mod: junior support tools (no refunds/winners/treasury)';

-- ARC junior mod (vanity wallet for Owl Vision support access)
INSERT INTO public.admins (wallet_address, role, created_at)
VALUES ('ArcingMA84xzmA1BQbmhHhKdWRGDyRQSN8uccWkh2rD4', 'mod', NOW())
ON CONFLICT (wallet_address) DO UPDATE SET role = EXCLUDED.role;
