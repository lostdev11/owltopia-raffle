import bs58 from 'bs58'

type WlProofResponse = {
  merkle_root?: string
  proof?: string[]
  error?: string
}

export async function fetchPartnerAllowListProofResponse(
  wallet: string,
  slug: string,
  phaseKey: string
): Promise<{ ok: true; body: WlProofResponse } | { ok: false; error: string }> {
  try {
    const res = await fetch(
      `/api/owl-center/collections/${encodeURIComponent(slug)}/wl-proof?wallet=${encodeURIComponent(wallet)}&phase_key=${encodeURIComponent(phaseKey)}`
    )
    const body = (await res.json()) as WlProofResponse
    if (!res.ok) {
      return { ok: false, error: body.error || 'Allowlist proof lookup failed' }
    }
    return { ok: true, body }
  } catch {
    return { ok: false, error: 'Allowlist proof lookup failed — check your connection and retry.' }
  }
}

export function validatePartnerAllowListProofBody(
  body: WlProofResponse,
  merkleRoot: Uint8Array
): { ok: true; merkleProof: Uint8Array[] } | { ok: false; error: string } {
  if (!body.merkle_root || !Array.isArray(body.proof)) {
    return { ok: false, error: 'Allowlist proof response malformed' }
  }
  if (body.merkle_root !== bs58.encode(merkleRoot)) {
    return {
      ok: false,
      error: 'Allowlist out of sync — on-chain merkle root does not match the server list. Contact the team.',
    }
  }
  return { ok: true, merkleProof: body.proof.map((p) => bs58.decode(p)) }
}
