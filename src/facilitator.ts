import { SOLANA_MAINNET } from "./constants.js";

/** Attack-server facilitators. The paying client does not call these; the merchant's 402 names its own fee payer. */
export const ATTACK_FACILITATORS = [
  { name: "Dexter", supported: "https://x402.dexter.cash/supported" },
  { name: "Corbits", supported: "https://facilitator.corbits.dev/supported" },
] as const;

export type SupportedKind = {
  x402Version?: number;
  scheme?: string;
  network?: string;
  extra?: { feePayer?: string };
};

export function feePayerFromKinds(kinds: readonly SupportedKind[]): string | null {
  const kind = kinds.find((item) =>
    item.x402Version === 2
    && item.scheme === "exact"
    && item.network === SOLANA_MAINNET
    && typeof item.extra?.feePayer === "string"
    && item.extra.feePayer.length > 0
  );
  return kind?.extra?.feePayer ?? null;
}

export type PickedFacilitator = { name: string; url: string; feePayer: string };

/** First candidate whose live /supported lists exact Solana mainnet. */
export async function attackFeePayer(fetchImpl: typeof fetch = fetch): Promise<PickedFacilitator> {
  const errors: string[] = [];
  for (const candidate of ATTACK_FACILITATORS) {
    try {
      const response = await fetchImpl(candidate.supported);
      if (!response.ok) {
        errors.push(`${candidate.name} HTTP ${response.status}`);
        continue;
      }
      const body = await response.json() as { kinds?: SupportedKind[] };
      const feePayer = feePayerFromKinds(body.kinds ?? []);
      if (!feePayer) {
        errors.push(`${candidate.name} does not list exact ${SOLANA_MAINNET}`);
        continue;
      }
      return { name: candidate.name, url: candidate.supported, feePayer };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${candidate.name} ${message}`);
    }
  }
  throw new Error(`no attack-server facilitator lists Solana mainnet exact\n${errors.join("\n")}`);
}
