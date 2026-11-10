/**
 * Evidence for a payment decision. Every field a decision rests on must cite
 * where its value came from: a field of the merchant's 402, a computer result,
 * or an exact comparison with local state. A decision that cannot cite a
 * required field is not allowed to APPROVE.
 */

export type EvidenceField = "transaction" | "amount" | "recipient" | "token" | "network" | "fee";

export type Evidence = {
  field: EvidenceField;
  /** The value the decision used, exactly as it appears in the plain line or the comparison. */
  value: string;
  /** Where the raw value came from, e.g. `402.accepts[0].amount = 5000`. */
  source: string;
  /** Who produced the value: a check label such as `live (model, Mac)`, or `exact comparison`. */
  by: string;
  /** The computer call, when the value came from one. */
  call?: string;
};

/** Fields an APPROVE must cite. */
export const REQUIRED_FOR_APPROVE: readonly EvidenceField[] = [
  "transaction", "amount", "recipient", "token", "network", "fee",
];

export type Verdict = "STOP" | "APPROVE";

/**
 * Returns the fields an APPROVE is missing evidence for. An item counts only
 * when it has a non-empty value and source.
 */
export function missingEvidence(
  evidence: readonly Evidence[],
  required: readonly EvidenceField[] = REQUIRED_FOR_APPROVE,
): EvidenceField[] {
  const cited = new Set(
    evidence.filter((item) => item.value.trim() !== "" && item.source.trim() !== "").map((item) => item.field),
  );
  return required.filter((field) => !cited.has(field));
}

/**
 * Applies the evidence rule to a decision line. An APPROVE with missing
 * evidence becomes a STOP naming the missing fields. A STOP is returned unchanged.
 */
export function enforceEvidence(
  decision: { line: string; verdict: Verdict; reason: string | null },
  evidence: readonly Evidence[],
  required: readonly EvidenceField[] = REQUIRED_FOR_APPROVE,
): { line: string; verdict: Verdict; reason: string | null } {
  if (decision.verdict !== "APPROVE") return decision;
  const missing = missingEvidence(evidence, required);
  if (missing.length === 0) return decision;
  const reason = `no evidence for ${missing.join(", ")}`;
  const head = decision.line.endsWith(" APPROVE") ? decision.line.slice(0, -" APPROVE".length) : decision.line;
  return { line: `${head} STOP: ${reason}`, verdict: "STOP", reason };
}

export function formatEvidence(evidence: readonly Evidence[]): string {
  return evidence
    .map((item) => {
      const call = item.call ? ` via \`${item.call}\`` : "";
      return `evidence ${item.field}: ${item.value} ← ${item.source} [${item.by}${call}]`;
    })
    .join("\n");
}
