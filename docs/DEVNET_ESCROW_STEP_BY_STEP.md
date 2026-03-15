# Devnet escrow testing – step-by-step (finish by tomorrow)

Do these steps in order. You need: Phantom wallet, devnet SOL, one devnet NFT, and the app running locally.

---

## Part 1: Get devnet SOL and one devnet NFT

### Step 1.1 – Switch Phantom to Devnet

1. Open **Phantom** (browser or app).
2. Click the **menu** (☰) or your profile icon.
3. Go to **Settings** → **Developer settings** (or **Change Network**).
4. Select **Devnet**.
5. Your wallet address is the same; only the network changes.

### Step 1.2 – Get free devnet SOL

1. Go to **https://faucet.solana.com**.
2. Make sure the dropdown says **Devnet**.
3. Paste your **Phantom wallet address** (copy from Phantom: click your address to copy).
4. Click **Confirm Airdrop** (or **Request Airdrop**).
5. Wait a few seconds. You should see a small amount of SOL (e.g. 1–2 SOL) in Phantom on Devnet.

### Step 1.3 – Export your Phantom key (for the mint script)

You’ll run a script that mints one NFT **into this same wallet**. The script needs your private key in a file (only on your machine, never commit or share it).

1. In Phantom: **Settings** → **Security & Privacy** → **Export Private Key**.
2. Enter your password if asked.
3. You’ll see a **long string of numbers in brackets**, e.g. `[1,2,3,4,...,64]`. **Copy the entire thing** (from `[` to `]`).
4. On your computer, open the project folder and go to the **scripts** folder.
5. Create a new file named **phantom-devnet-keypair.json** (exactly that name) inside **scripts**.
6. Paste **only** the copied array into that file. The file should look like:
   ```json
   [1,2,3,4,5,...,64]
   ```
   (no extra text, no variable names, just the array.)
7. Save the file.  
   This file is in `.gitignore`; do **not** commit it or share it.

### Step 1.4 – Mint one devnet NFT into your wallet

1. Open a terminal (PowerShell or Command Prompt).
2. Go to the project folder:
   ```powershell
   cd c:\Dev\OwlRaffleSite
   ```
3. Run:
   ```powershell
   node scripts/mint-devnet-nft.mjs
   ```
4. If you see “No keypair file found”, double-check that **phantom-devnet-keypair.json** is in the **scripts** folder and contains only the `[1,2,...,64]` array.
5. If you see “Insufficient funds” or similar, get more devnet SOL from the faucet (Step 1.2) and run the script again.
6. When it works, you’ll see: “Minted 1 NFT to your wallet” and a **mint address**. That NFT is now in your Phantom wallet on Devnet.

---

## Part 2: Run the app and test escrow

### Step 2.1 – Env and dev server

1. In the project folder, make sure **.env.local** has:
   - **SOLANA_RPC_URL** and **NEXT_PUBLIC_SOLANA_RPC_URL** = your **devnet** Helius RPC URL (e.g. `https://devnet.helius-rpc.com/?api-key=...`).
   - **PRIZE_ESCROW_SECRET_KEY** = your escrow key (from `npm run generate:escrow-key` or the one you added earlier).
2. Start the app:
   ```powershell
   cd c:\Dev\OwlRaffleSite
   npm run dev
   ```
3. Wait until you see “Ready” or the app is running. Leave this terminal open.

### Step 2.2 – Check escrow config

1. Open a **second** terminal.
2. Run:
   ```powershell
   cd c:\Dev\OwlRaffleSite
   npm run check:prize-escrow
   ```
3. You should see: **“OK – Prize escrow is configured”** and an address. If you see 503 or “not configured”, fix **PRIZE_ESCROW_SECRET_KEY** in .env.local and restart the dev server (Step 2.1).

### Step 2.3 – Create an NFT raffle

1. In the browser, go to **http://localhost:3000**.
2. Connect **Phantom** (it must be on **Devnet**).
3. Go to the **Create Raffle** page (from the nav or dashboard).
4. Fill in:
   - **Title** (e.g. “Devnet test raffle”).
   - **Description** (optional).
   - **Prize type**: choose **NFT**.
5. Click **“Load NFTs & tokens from wallet”**.
6. Your devnet NFT (from Step 1.4) should appear (it may show as “No image” with a mint address – that’s fine). **Click it** to select it.
7. Set **ticket price**, **start** and **end** times, and any other required fields.
8. Click **Create** (or **Submit**). You should be taken to the **raffle detail** page.

### Step 2.4 – Deposit NFT to escrow and verify

1. On the raffle detail page you should see a card: **“Prize in escrow required”**.
2. Click **“Transfer NFT to escrow”**. Phantom will ask you to sign. **Approve**.
3. Wait for the transaction to confirm (a few seconds).
4. Click **“Verify deposit”**.
5. The “Prize in escrow required” card should disappear and the raffle should become **active**. Escrow testing for **create → deposit → verify** is done.

### Step 2.5 – (Optional) Test winner and auto-transfer

If you want to test the full flow including “winner gets the NFT”:

1. Add at least one entry to the raffle (buy a ticket with another wallet or the same one, as your app allows).
2. Set the raffle **end time** in the past, or use admin “Select winner” if you have it.
3. Trigger **Select winner** (admin button or cron). After a winner is chosen, the app should automatically send the NFT from escrow to the winner and record the transaction.

---

## Quick checklist

- [ ] Phantom on **Devnet**
- [ ] Devnet SOL in Phantom (faucet.solana.com)
- [ ] **phantom-devnet-keypair.json** in **scripts** (only the `[1,...,64]` array)
- [ ] **node scripts/mint-devnet-nft.mjs** ran successfully
- [ ] .env.local has **devnet** RPC and **PRIZE_ESCROW_SECRET_KEY**
- [ ] **npm run dev** running; **npm run check:prize-escrow** shows “configured”
- [ ] Create raffle → **Load NFTs** → select NFT → submit
- [ ] On raffle page: **Transfer NFT to escrow** → **Verify deposit** → card gone, raffle active

If anything doesn’t match a step (e.g. “Load NFTs” shows nothing, or verify fails), stop at that step and check: Phantom on Devnet, same wallet that has the NFT, and that the app is using devnet RPC and the escrow key.
