# Owl Raffle Site

A Next.js 14 raffle platform with transparency features, trust scoring, and theme customization.

## Features

### 1. Owl Vision Trust Layer
Transparency and anti-spam scoring system that calculates a trust score (0-100) for each raffle based on:

- **Verified Payments Ratio** (0-60 points): Percentage of entries that have been confirmed via blockchain verification
- **Wallet Diversity Ratio** (0-30 points): Ratio of unique wallets to confirmed entries
- **Time Integrity** (5-10 points): Whether the raffle was edited after entries were confirmed

The score is displayed as a badge on each raffle card with a detailed tooltip showing the breakdown.

### 2. Hoot Boost Entry Multiplier
A cosmetic animation that displays when users select ticket quantities. The meter animates based on the number of tickets selected, but **does not affect winner odds** - each ticket equals one entry. This is purely for visual engagement.

### 3. Night Mode Scheduling Presets
Quick preset buttons in the Create Raffle form that set both the end time and theme accent:

- **Midnight Drop**: Ends at 12:00 AM local, cool teal glow
- **Dawn Run**: Ends at 6:00 AM local, soft lime glow  
- **Prime Time**: Ends at 9:00 PM local, electric green glow (default)

Theme accents customize the border glows and highlights throughout the raffle UI (cards, modals, buttons).

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS + shadcn/ui components
- **Database**: Supabase (PostgreSQL + RLS)
- **Blockchain**: Solana (wallet adapter for payments)
- **UI Components**: Radix UI primitives

## Getting Started

### Prerequisites

- Node.js 18+
- Supabase account and project
- (Optional) Solana RPC endpoint for payment verification

### Installation

1. Install dependencies:
```bash
npm install
```

2. Set up environment variables:
```bash
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
NEXT_PUBLIC_SOLANA_RPC_URL=your_solana_rpc_url  # REQUIRED: Use a private RPC endpoint (Helius, QuickNode, or Alchemy). Public endpoints are rate-limited and will cause 403 errors.
NEXT_PUBLIC_RAFFLE_RECIPIENT_WALLET=your_wallet_address  # Required: Wallet address that receives ticket payments
```

3. Run database migrations:
   - **Quick Setup**: Apply all migrations at once using `supabase/migrations/apply_missing_migrations.sql`
     - Go to your Supabase dashboard → SQL Editor
     - Copy and paste the contents of `apply_missing_migrations.sql`
     - Run the SQL script
     - This applies migrations 006-015 (migrations 001-005 should already be applied)
   
   - **Manual Setup**: Apply migrations individually in order:
     - `001_initial_schema.sql` - Creates `raffles` and `entries` tables
     - `002_restrict_entry_currencies.sql` - Adds currency restrictions
     - `003_add_admins_table.sql` - Creates admins table
     - `004_add_initial_admin.sql` - Sets up initial admin policies
     - `005_fix_admins_rls_policy.sql` - Fixes admin RLS policies
     - `006_add_nft_support.sql` - **REQUIRED**: Adds NFT prize support
     - `007_add_max_tickets.sql` - Adds max tickets limit
     - `008_add_raffles_write_policies.sql` - Adds write policies
     - `009_add_entries_update_policy.sql` - Adds entry update policy
     - `010_add_raffles_delete_policy.sql` - Adds delete policy
     - `011_ensure_entries_global_view.sql` - Ensures global entry view
     - `012_add_min_tickets_and_status.sql` - Adds min tickets and status
     - `013_add_entries_delete_policy.sql` - Adds entry delete policy
     - `014_add_nft_transfer_transaction.sql` - Adds NFT transfer tracking
     - `015_add_original_end_time.sql` - Adds original end time tracking
   
   **Note**: If you get an error about missing NFT columns when creating raffles, make sure migration `006_add_nft_support.sql` has been applied.

4. Set up Supabase Storage:
   - Go to your Supabase dashboard → Storage
   - Create a new bucket named `raffle-images`
   - Set it to **Public** (so images can be accessed via public URLs)
   - Optionally, add a storage policy to allow authenticated uploads:
     ```sql
     -- Allow authenticated users to upload
     CREATE POLICY "Allow authenticated uploads" ON storage.objects
       FOR INSERT WITH CHECK (
         bucket_id = 'raffle-images' AND
         auth.role() = 'authenticated'
       );
     
     -- Allow public read access
     CREATE POLICY "Allow public read access" ON storage.objects
       FOR SELECT USING (bucket_id = 'raffle-images');
     ```
   - **Note**: For server-side uploads via API routes, you may need to use the service role key. Add `SUPABASE_SERVICE_ROLE_KEY` to your `.env.local` file (keep this secret!)

5. Start the development server:
```bash
npm run dev
```

5. Open [http://localhost:3000](http://localhost:3000)

## How Owl Vision Works

The Owl Vision trust score is calculated server-side using the following formula:

```
Score = Verified + Diversity + Integrity

Where:
- Verified = (confirmed_entries / total_entries) * 60 (clamped 0-60)
- Diversity = (unique_wallets / confirmed_entries) * 30 (clamped 0-30)
- Integrity = 10 if not edited after entries, else 5

Final score is rounded and clamped to 0-100
```

The score appears on raffle cards and detail pages. Admins can view a detailed breakdown on the edit page showing:
- Exact ratios and percentages
- Entry counts
- Wallet counts
- Integrity status

## Night Mode Presets

Night Mode presets are quick configuration options that:
1. Set the raffle end time to a specific hour (midnight, dawn, or prime time)
2. Apply a matching theme accent (teal, lime, or green)
3. Customize the visual styling throughout the raffle UI

Theme accents are stored in the database and applied to:
- Raffle card borders and glows
- Detail page borders
- Modal borders
- Button hover states

## Payment Verification Flow

1. User connects wallet and selects ticket quantity
2. User clicks "Buy Tickets" button
3. System creates a pending entry in the database
4. A blockchain transaction is generated (SOL or USDC based on raffle currency)
5. User signs the transaction in their wallet
6. Transaction is sent to the Solana network
7. After confirmation, transaction signature is sent to `/api/entries/verify`
8. Server-side verification (currently placeholder):
   - Verifies transaction on Solana RPC
   - Checks amount, recipient, confirmation status
   - Updates entry status to `confirmed` or `rejected`
9. UI updates to show confirmed entries
10. Only confirmed entries count toward:
    - Participant lists
    - Owl Vision score calculations
    - Winner selection

**Note**: The current implementation includes a placeholder verification function. In production, implement actual Solana transaction verification using `@solana/web3.js`.

### Supported Payment Methods
- **SOL**: Native Solana transfers
- **USDC**: SPL Token transfers (USDC mint: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v)

## Database Schema

### Raffles Table
- `id` (UUID, primary key)
- `slug` (text, unique)
- `title`, `description`, `image_url`
- `prize_amount`, `prize_currency`
- `ticket_price`, `currency`
- `start_time`, `end_time` (timestamptz)
- `theme_accent` (enum: prime|midnight|dawn)
- `edited_after_entries` (boolean)
- `is_active`, `winner_wallet`, `winner_selected_at`
- `created_at`, `updated_at`

### Entries Table
- `id` (UUID, primary key)
- `raffle_id` (UUID, foreign key)
- `wallet_address` (text)
- `ticket_quantity` (integer)
- `transaction_signature` (text)
- `status` (enum: pending|confirmed|rejected)
- `amount_paid`, `currency`
- `created_at`, `verified_at`

## Project Structure

```
├── app/
│   ├── api/
│   │   ├── entries/verify/    # Payment verification endpoint
│   │   └── raffles/           # Raffle CRUD endpoints
│   ├── admin/raffles/         # Admin pages (create, edit)
│   ├── raffles/               # Public pages (list, detail)
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   ├── ui/                    # shadcn/ui components
│   ├── OwlVisionBadge.tsx
│   ├── HootBoostMeter.tsx
│   ├── RaffleCard.tsx
│   ├── ParticipantsModal.tsx
│   └── WinnerModal.tsx
├── lib/
│   ├── db/                    # Database utilities
│   ├── owl-vision.ts          # Score calculation
│   ├── theme-accent.ts        # Theme utilities
│   ├── night-mode-presets.ts  # Preset configurations
│   └── types.ts               # TypeScript types
└── supabase/
    └── migrations/            # Database migrations
```

## Development

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint

## Troubleshooting

### RPC 403 "Access forbidden" Error

If you encounter a `403: Access forbidden` error when trying to purchase tickets, this is because the public Solana RPC endpoint is rate-limited.

**Solution**: Set up a private RPC endpoint:

1. **Get a free RPC endpoint** from one of these providers:
   - [Helius](https://www.helius.dev/) - Free tier available
   - [QuickNode](https://www.quicknode.com/) - Free tier available
   - [Alchemy](https://www.alchemy.com/) - Free tier available

2. **Add the RPC URL to your `.env.local` file**:
   ```bash
   NEXT_PUBLIC_SOLANA_RPC_URL=https://your-rpc-endpoint-url
   ```

3. **Restart your development server** after adding the environment variable.

The application will automatically use your private RPC endpoint, which has higher rate limits and won't return 403 errors.

**Note**: The code includes retry logic for transient RPC errors, but a private endpoint is still recommended for production use.

## License

MIT
