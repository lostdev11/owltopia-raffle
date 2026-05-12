-- Open Owl Nesting publicly by default while keeping the admin switch authoritative.
UPDATE public.nesting_public_settings
SET landing_public = TRUE
WHERE id = 'default';
