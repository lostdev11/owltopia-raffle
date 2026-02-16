-- ============================================================================
-- Migration 027: Unique transaction signature on entries (replay protection)
-- ============================================================================
-- Ensures each on-chain transaction can only confirm one entry.
-- NULL signatures are allowed (multiple pending entries have no signature yet).
--
-- If duplicate signatures already exist, we keep one row per signature
-- (earliest by id) and clear transaction_signature on the others so the
-- unique index can be created. Those entries remain confirmed; only the
-- stored signature is cleared to resolve the duplicate.

-- Step 1: Clear transaction_signature on duplicate rows (keep one per signature, by earliest id)
UPDATE public.entries
SET transaction_signature = NULL
WHERE transaction_signature IS NOT NULL
  AND id NOT IN (
    SELECT id FROM (
      SELECT id,
             ROW_NUMBER() OVER (PARTITION BY transaction_signature ORDER BY id) AS rn
      FROM public.entries
      WHERE transaction_signature IS NOT NULL
    ) sub
    WHERE rn = 1
  );

-- Step 2: Create unique index so no future duplicate signatures can be stored
CREATE UNIQUE INDEX IF NOT EXISTS idx_entries_transaction_signature_unique
  ON public.entries(transaction_signature)
  WHERE transaction_signature IS NOT NULL;
