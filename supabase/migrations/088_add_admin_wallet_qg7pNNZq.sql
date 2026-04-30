-- Grant full admin to wallet (idempotent)
INSERT INTO admins (wallet_address, role, created_at)
VALUES ('qg7pNNZq7qDQuc6Xkd1x4NvS2VM3aHtCqHEzucZxRGA', 'full', NOW())
ON CONFLICT (wallet_address) DO UPDATE SET role = 'full';
