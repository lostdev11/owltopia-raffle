-- Remove junior admin role (raffle_creator): all admins have full Owl Vision access.
UPDATE admins SET role = 'full' WHERE role = 'raffle_creator';

ALTER TABLE admins DROP CONSTRAINT IF EXISTS admins_role_check;

ALTER TABLE admins
  ADD CONSTRAINT admins_role_check CHECK (role IN ('full'));

COMMENT ON COLUMN admins.role IS 'full: full Owl Vision access';
