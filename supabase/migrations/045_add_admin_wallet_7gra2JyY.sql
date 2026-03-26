-- Grant full admin to wallet (idempotent)
INSERT INTO admins (wallet_address, role, created_at)
VALUES ('7gra2JyY969Lt3BXLb6FMx9DxouXcEpRzpiKnc6wFgrq', 'full', NOW())
ON CONFLICT (wallet_address) DO UPDATE SET role = 'full';
