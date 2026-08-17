# Apply migration 224 in Supabase SQL Editor

The full migration can get truncated in the dashboard and fail with
`unterminated dollar-quoted string`. Run these **four files one at a time**:

1. `01_column.sql`
2. `02_confirm_entry_with_tx.sql`
3. `03_confirm_cart_batch_with_tx.sql`
4. `04_confirm_complimentary_referral_entry.sql`

If the editor warns about RLS on a variable name, choose **Run without RLS**.

Verify:

```sql
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'raffles'
  AND column_name = 'max_tickets_per_wallet';
```
