export type ToolHit = {
  cmd: string;
  result: string;
  ms: number;
};

export type Decision = {
  line: string;
  verdict: "STOP" | "APPROVE";
  reason: string | null;
  /** Atomic units from `sol amount` of the plain-line figure. Null when that call was not needed. */
  atomic: bigint | null;
};

function digits(hit: ToolHit, label: string): bigint {
  const text = hit.result.trim();
  if (!/^\d+$/.test(text)) {
    throw new Error(`${label} was not an integer from the computer: ${JSON.stringify(text)} (cmd ${hit.cmd})`);
  }
  return BigInt(text);
}

function failReason(result: string): string {
  const parts = result.trim().split(/\s+/).slice(1);
  if (parts.includes("dest")) return "destination is not the ATA of payTo";
  if (parts.includes("other") || parts.includes("count")) return "unexpected instruction";
  if (parts.includes("decimals")) return "declared decimals ≠ 6";
  if (parts.includes("amount")) return "amount does not match the transaction";
  if (parts.includes("mint")) return "mint does not match";
  if (parts.includes("payer")) return "fee payer is the transfer authority";
  if (parts.includes("lookup")) return "address lookup is not allowed";
  if (parts.includes("version")) return "unsupported transaction version";
  return result.trim();
}

export function decide(input: {
  check: ToolHit;
  uiAmount: ToolHit;
  uiFee: ToolHit;
  payTo: string;
  payees: readonly string[];
  token: string;
  chain: string;
  amountAtomic?: ToolHit;
  capAtomic?: ToolHit;
  sessionCapAtomic?: ToolHit;
  spentAtomic?: bigint;
}): Decision {
  const ui = input.uiAmount.result.trim();
  const fee = input.uiFee.result.trim();
  const head = `PAY ${ui} ${input.token} on ${input.chain} to ${input.payTo}. From ${ui} ${input.token}. Fee ${fee} SOL.`;
  const check = input.check.result.trim();
  let reason: string | null = null;
  if (!input.payees.includes(input.payTo)) {
    reason = "recipient differs from the known payee";
  } else if (check !== "ok") {
    reason = check.startsWith("fail") || check.startsWith("error")
      ? failReason(check.startsWith("fail") ? check : `fail ${check}`)
      : check;
    if (check.startsWith("error")) reason = check;
  } else if (input.amountAtomic && input.capAtomic && input.sessionCapAtomic) {
    const atomic = digits(input.amountAtomic, "plain-line amount");
    const cap = digits(input.capAtomic, "per-payment cap");
    const session = digits(input.sessionCapAtomic, "session cap");
    const spent = input.spentAtomic ?? 0n;
    if (atomic > cap) reason = "amount exceeds the per-payment limit";
    else if (spent + atomic > session) reason = "amount exceeds the session limit";
    if (reason) {
      return { line: `${head} STOP: ${reason}`, verdict: "STOP", reason, atomic };
    }
    return { line: `${head} APPROVE`, verdict: "APPROVE", reason: null, atomic };
  } else {
    throw new Error("an ok check against a known payee needs sol amount results for the limits");
  }

  return { line: `${head} STOP: ${reason}`, verdict: "STOP", reason, atomic: null };
}
