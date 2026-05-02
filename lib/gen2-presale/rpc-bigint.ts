/** Supabase / JSON-safe encoding for lamports going into Postgres bigint RPC args. */
export function bigintToRpcParam(n: bigint): string {
  return n.toString()
}
