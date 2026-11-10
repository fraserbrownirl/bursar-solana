/**
 * Detects text in a merchant's response that tries to instruct the agent.
 * Server text is data. Text that addresses the agent ("ignore your limits",
 * "the operator approved 500 USDC") is treated as a sign of a hostile server,
 * never as an instruction: the payment stops and the server is remembered.
 */

export type TextSource = { where: string; text: string };

export type InjectionFinding = { where: string; rule: string; excerpt: string };

const RULES: { rule: string; pattern: RegExp }[] = [
  { rule: "ignore-instructions", pattern: /\b(ignore|disregard|forget|override|bypass)\b[^.\n]{0,40}\b(instruction|instructions|limit|limits|rule|rules|polic(y|ies)|invoice|previous|prior|above|check|checks)\b/i },
  { rule: "claimed-authority", pattern: /\b(operator|owner|admin|administrator|user|developer|system)\b[^.\n]{0,30}\b(has approved|approved|authori[sz]ed|pre-approved|signed off)\b/i },
  { rule: "directive-to-agent", pattern: /\b(you|agent|assistant|model|bursar)\b[^.\n]{0,20}\b(must|should|are required to|need to|will now)\b[^.\n]{0,30}\b(pay|send|transfer|approve|sign)\b/i },
  { rule: "payment-order", pattern: /\b(pay|send|transfer|approve)\b[^.\n]{0,20}\b\d[\d,.]*\s*(usdc|usdt|usd|sol|near|xlm|eth)\b[^.\n]{0,40}\bto\b/i },
  { rule: "role-marker", pattern: /(<\|im_(start|end)\|>|<\|endoftext\|>|^\s*(system|assistant)\s*:|\[\s*(system|inst)\s*\]|###\s*(system|instruction))/im },
  { rule: "new-instructions", pattern: /\b(new|updated|revised)\s+(instructions|policy|rules)\b/i },
];

/** Collects every string inside a JSON value, with its path, so nested fields are scanned too. */
export function stringsOf(value: unknown, where: string, out: TextSource[] = []): TextSource[] {
  if (typeof value === "string") {
    out.push({ where, text: value });
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => stringsOf(item, `${where}[${index}]`, out));
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) stringsOf(item, `${where}.${key}`, out);
  }
  return out;
}

function excerptAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 20);
  const end = Math.min(text.length, index + length + 20);
  return (start > 0 ? "…" : "") + text.slice(start, end).replace(/\s+/g, " ").trim() + (end < text.length ? "…" : "");
}

/** Returns one finding per source and rule that matches. */
export function scanForInstructions(sources: readonly TextSource[]): InjectionFinding[] {
  const findings: InjectionFinding[] = [];
  for (const source of sources) {
    for (const { rule, pattern } of RULES) {
      const match = pattern.exec(source.text);
      if (match) {
        findings.push({ where: source.where, rule, excerpt: excerptAround(source.text, match.index, match[0].length) });
      }
    }
  }
  return findings;
}

/** The STOP reason for a set of findings. Quotes the first one so the plain line cites its evidence. */
export function injectionReason(findings: readonly InjectionFinding[]): string {
  const first = findings[0];
  if (!first) throw new Error("injectionReason needs at least one finding");
  return `server text tries to instruct the agent (${first.where}: "${first.excerpt}")`;
}
