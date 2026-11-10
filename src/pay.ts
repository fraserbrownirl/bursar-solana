import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  decodePaymentRequiredHeader,
  decodePaymentResponseHeader,
  encodePaymentSignatureHeader,
} from "@x402/core/http";
import { DEFAULT_COMPUTE_UNIT_LIMIT, DEFAULT_COMPUTE_UNIT_PRICE_MICROLAMPORTS } from "@x402/svm";
import { ask, checkMark, printHit, type ToolHit } from "./model.js";
import { firmwareCheck } from "./emulator.js";
import { propose, requirementAmount, type SolanaRequirement } from "./propose.js";
import { decide } from "./decide.js";
import { boldRed, verdictLine } from "./color.js";
import { atasForPay, payeeAddresses, readPayees, readSession, writeSession } from "./store.js";
import { signerFromKeychain } from "./keychain.js";
import { PER_PAYMENT_UI, SESSION_UI, SOLANA_MAINNET, USDC_DECIMALS, USDC_MINT } from "./constants.js";
import { enforceEvidence, formatEvidence, type Evidence, type Verdict } from "./guard/evidence.js";
import { injectionReason, scanForInstructions, stringsOf, type TextSource } from "./guard/injection.js";
import { recordPayTo, remember, screen } from "./guard/memory.js";
import { append } from "./guard/ledger.js";

type RequiredDoc = {
  x402Version: number;
  error?: string;
  resource?: { url?: string; description?: string; mimeType?: string };
  accepts?: SolanaRequirement[];
  extensions?: Record<string, unknown>;
};

/** How the guarded request is made. The 402 probe and the paid retry use the same method, headers and body. */
export type Request = { method?: string; headers?: Record<string, string>; body?: string };

export type Review = {
  line: string;
  verdict: Verdict;
  reason: string | null;
  atomic: bigint | null;
  requirement: SolanaRequirement;
  evidence: Evidence[];
  sign: () => Promise<string>;
  hits: ToolHit[];
};

function selectSolanaUsdc(doc: RequiredDoc): SolanaRequirement {
  const chosen = (doc.accepts ?? []).find((item) =>
    item.scheme === "exact" && item.network === SOLANA_MAINNET && item.asset === USDC_MINT
  );
  if (!chosen) {
    throw new Error("the 402 has no exact Solana mainnet USDC requirement");
  }
  requirementAmount(chosen);
  return chosen;
}

async function confirm(): Promise<boolean> {
  if (process.env.BURSAR_YES === "1") return true;
  const rl = createInterface({ input, output });
  const answer = (await rl.question("sign this payment? [y/N] ")).trim().toLowerCase();
  rl.close();
  return answer === "y";
}

function send(url: string, request: Request, extra: Record<string, string> = {}): Promise<Response> {
  return fetch(url, {
    method: request.method ?? "GET",
    headers: { ...(request.headers ?? {}), ...extra },
    ...(request.body !== undefined && request.method && request.method !== "GET" ? { body: request.body } : {}),
  });
}

/** The check label without its timing, e.g. `live (model, Mac)`. */
function labelOf(hit: ToolHit): string {
  return checkMark(hit).replace(/^\d+ ms /, "");
}

function fromHit(field: Evidence["field"], hit: ToolHit, source: string): Evidence {
  return { field, value: hit.result.trim(), source, by: labelOf(hit), call: hit.cmd };
}

/** Evidence that does not come from the computer: exact comparisons against the 402 and local state. */
function comparisons(requirement: SolanaRequirement, payeeName: string | undefined): Evidence[] {
  const items: Evidence[] = [
    { field: "token", value: "USDC", source: `402 asset = ${requirement.asset} (Circle USDC mint)`, by: "exact comparison" },
    { field: "network", value: "Solana", source: `402 network = ${requirement.network}`, by: "exact comparison" },
  ];
  if (payeeName) {
    items.push({
      field: "recipient",
      value: requirement.payTo,
      source: `payees.json entry "${payeeName}"`,
      by: "exact comparison",
    });
  }
  return items;
}

/** Records the decision in the ledger and returns it. Every review ends here. */
function finish(
  url: string,
  review: Review,
  extra: Record<string, unknown> = {},
): Review {
  if (review.evidence.length > 0) process.stdout.write(`${formatEvidence(review.evidence)}\n`);
  const entry = append("decision", {
    url,
    host: new URL(url).host,
    verdict: review.verdict,
    reason: review.reason,
    line: review.line,
    payTo: review.requirement.payTo,
    amount: review.requirement.amount,
    network: review.requirement.network,
    evidence: review.evidence,
    checks: review.hits.map((hit) => ({ cmd: hit.cmd, result: hit.result.trim(), label: labelOf(hit) })),
    ...extra,
  });
  process.stdout.write(`ledger #${entry.seq} ${entry.hash.slice(0, 16)}…\n`);
  return review;
}

function stopEarly(url: string, requirement: SolanaRequirement, reason: string, extra: Record<string, unknown> = {}): Review {
  const line = `STOP: ${reason}`;
  process.stdout.write(`${verdictLine(line)}\n`);
  return finish(url, {
    line,
    verdict: "STOP",
    reason,
    atomic: null,
    requirement,
    evidence: [],
    sign: async () => { throw new Error("refused before signing"); },
    hits: [],
  }, extra);
}

export async function review(
  url: string,
  tamper: { destinationAta?: string; extraLamports?: boolean } = {},
  show: { knownPayee?: string } = {},
  request: Request = {},
): Promise<Review> {
  const first = await send(url, request);
  const body = await first.text();
  const encoded = first.headers.get("payment-required");
  if (first.status !== 402 || !encoded) {
    throw new Error(`expected 402 with PAYMENT-REQUIRED, got HTTP ${first.status}`);
  }
  if (body.trim()) process.stdout.write(`response body: ${body.slice(0, 500)}\n`);
  const doc = decodePaymentRequiredHeader(encoded) as RequiredDoc;
  const requirement = selectSolanaUsdc(doc);
  process.stdout.write(
    `402 asset: ${requirement.asset}\n`
    + (show.knownPayee ? `known payee: ${show.knownPayee}\n` : "")
    + `402 payTo: ${requirement.payTo}\n402 amount: ${requirement.amount}\n`
    + `402 network: ${requirement.network}\n`
    + `402 feePayer: ${String(requirement.extra?.feePayer ?? "")} (named by the merchant)\n`,
  );
  const host = new URL(url).host;

  // Guard 1: campaign memory, look-alikes and recipient switches, before any other work.
  const payees = Object.fromEntries(Object.entries(readPayees()).map(([name, payee]) => [name, payee.address]));
  const screened = screen({ host, payTo: requirement.payTo, payees });
  if (screened.stop) {
    for (const mark of screened.mark) remember(mark.kind, mark.value, screened.reason, url);
    return stopEarly(url, requirement, screened.reason);
  }
  // Guard 2: server text that tries to instruct the agent stops the payment and marks the server.
  const texts: TextSource[] = [
    ...(body.trim() ? [{ where: "response body", text: body }] : []),
    ...stringsOf(doc.error, "402.error"),
    ...stringsOf(doc.resource, "402.resource"),
    ...stringsOf(requirement.extra, "402.extra"),
    ...stringsOf(doc.extensions, "402.extensions"),
  ];
  const findings = scanForInstructions(texts);
  if (findings.length > 0) {
    const reason = injectionReason(findings);
    remember("host", host, "tried to instruct the agent", url);
    return stopEarly(url, requirement, reason, { findings });
  }

  const payeeName = Object.entries(payees).find(([, address]) => address === requirement.payTo)?.[0];
  if (payeeName) recordPayTo(host, requirement.payTo);

  const known = payeeAddresses();
  const feeCmd = `sol fee 2 ${DEFAULT_COMPUTE_UNIT_LIMIT} ${DEFAULT_COMPUTE_UNIT_PRICE_MICROLAMPORTS}`;
  if (!known.includes(requirement.payTo)) {
    const uiAmount = await ask(`sol ui ${requirement.amount} 6`);
    printHit(uiAmount);
    const feeAtomic = await ask(feeCmd);
    printHit(feeAtomic);
    const uiFee = await ask(`sol ui ${feeAtomic.result.trim()} 9`);
    printHit(uiFee);
    const decision = decide({
      check: { cmd: "payee", result: "ok", ms: 0 },
      uiAmount,
      uiFee,
      payTo: requirement.payTo,
      payees: known,
      token: "USDC",
      chain: "Solana",
    });
    process.stdout.write(`${verdictLine(decision.line)}\n`);
    process.stdout.write("token: USDC because the 402 asset is the Circle USDC mint\n");
    process.stdout.write(`chain: Solana because the 402 network is ${requirement.network}\n`);
    return finish(url, {
      line: decision.line,
      verdict: decision.verdict,
      reason: decision.reason,
      atomic: null,
      requirement,
      evidence: [
        fromHit("amount", uiAmount, `402 amount = ${requirement.amount}`),
        fromHit("fee", uiFee, `fee ${feeAtomic.result.trim()} lamports from \`${feeAtomic.cmd}\``),
        ...comparisons(requirement, undefined),
      ],
      sign: async () => { throw new Error("refused before signing"); },
      hits: [uiAmount, feeAtomic, uiFee],
    });
  }

  const accounts = atasForPay(requirement.payTo, tamper.destinationAta);
  const signer = await signerFromKeychain();
  const proposal = await propose(signer, requirement, accounts, { extraLamports: tamper.extraLamports });
  process.stdout.write(
    `mint decimals: ${proposal.mintDecimals} (SPL mint account, @solana-program/token fetchMint)\n`,
  );
  if (proposal.declaredDecimals !== null) {
    process.stdout.write(`402 extra.decimals: ${proposal.declaredDecimals}\n`);
  }
  const bytes = proposal.unsignedHex.length / 2;
  process.stdout.write(`unsigned transaction: ${bytes} bytes\n`);

  const check = firmwareCheck(
    proposal.unsignedHex,
    requirement.payTo,
    requirement.asset,
    requirement.amount,
    proposal.checkDecimals,
  );
  printHit(check);
  const uiAmount = await ask(`sol ui ${requirement.amount} ${proposal.mintDecimals}`);
  printHit(uiAmount);
  const feeAtomic = await ask(proposal.feeCommand);
  printHit(feeAtomic);
  const uiFee = await ask(`sol ui ${feeAtomic.result.trim()} 9`);
  printHit(uiFee);

  const hits = [check, uiAmount, feeAtomic, uiFee];
  const checkText = check.result.trim();
  const needsLimits = checkText === "ok";
  let amountAtomic: ToolHit | undefined;
  let capAtomic: ToolHit | undefined;
  let sessionCapAtomic: ToolHit | undefined;
  if (needsLimits) {
    amountAtomic = await ask(`sol amount ${uiAmount.result.trim()} ${USDC_DECIMALS}`);
    printHit(amountAtomic);
    capAtomic = await ask(`sol amount ${PER_PAYMENT_UI} ${USDC_DECIMALS}`);
    printHit(capAtomic);
    sessionCapAtomic = await ask(`sol amount ${SESSION_UI} ${USDC_DECIMALS}`);
    printHit(sessionCapAtomic);
    hits.push(amountAtomic, capAtomic, sessionCapAtomic);
  }

  const decided = decide({
    check,
    uiAmount,
    uiFee,
    payTo: requirement.payTo,
    payees: known,
    token: "USDC",
    chain: "Solana",
    amountAtomic,
    capAtomic,
    sessionCapAtomic,
    spentAtomic: BigInt(readSession().spentAtomic),
  });

  // Guard 3: an APPROVE must cite evidence for every field it rests on.
  const evidence: Evidence[] = [
    fromHit("transaction", check, `unsigned transaction (${bytes} bytes) against 402 payTo, asset and amount`),
    fromHit("amount", uiAmount, `402 amount = ${requirement.amount}`),
    fromHit("fee", uiFee, `fee ${feeAtomic.result.trim()} lamports from \`${feeAtomic.cmd}\``),
    ...comparisons(requirement, payeeName),
  ];
  const decision = enforceEvidence(decided, evidence);
  process.stdout.write(`${verdictLine(decision.line)}\n`);
  process.stdout.write("token: USDC because the 402 asset is the Circle USDC mint\n");
  process.stdout.write(`chain: Solana because the 402 network is ${requirement.network}\n`);

  return finish(url, {
    line: decision.line,
    verdict: decision.verdict,
    reason: decision.reason,
    atomic: decision.verdict === "APPROVE" ? decided.atomic : null,
    requirement,
    evidence,
    sign: proposal.sign,
    hits,
  });
}

export type Settlement = {
  ok: boolean;
  status: number;
  body: string;
  contentType: string | null;
  transaction: string | null;
  stop: string | null;
};

/**
 * Signs an approved review and retries the request with PAYMENT-SIGNATURE. The
 * merchant's facilitator settles. Stops if the 402 changed after the check.
 */
export async function settle(url: string, reviewed: Review, request: Request = {}): Promise<Settlement> {
  if (reviewed.verdict !== "APPROVE") throw new Error("settle needs an APPROVE review");
  const transaction = await reviewed.sign();
  const first = await send(url, request);
  const encoded = first.headers.get("payment-required");
  if (!encoded) throw new Error("the paid retry's preview 402 disappeared");
  const doc = decodePaymentRequiredHeader(encoded) as RequiredDoc;
  const requirement = selectSolanaUsdc(doc);
  if (requirement.payTo !== reviewed.requirement.payTo || requirement.amount !== reviewed.requirement.amount) {
    const stop = "the 402 changed between the check and the signature";
    remember("host", new URL(url).host, stop, url);
    append("decision", { url, host: new URL(url).host, verdict: "STOP", reason: stop, payTo: requirement.payTo, amount: requirement.amount });
    return { ok: false, status: 402, body: "", contentType: null, transaction: null, stop };
  }
  const payload = {
    x402Version: doc.x402Version,
    resource: doc.resource,
    accepted: requirement,
    payload: { transaction },
    extensions: doc.extensions,
  };
  // The merchant's facilitator settles. This client only returns the signature.
  const paid = await send(url, request, { "PAYMENT-SIGNATURE": encodePaymentSignatureHeader(payload as never) });
  const paidBody = await paid.text();
  const settledHeader = paid.headers.get("payment-response");
  const settled = settledHeader
    ? decodePaymentResponseHeader(settledHeader) as { transaction?: string; success?: boolean }
    : null;
  const ok = settled ? settled.success === true : paid.ok;
  if (settled?.success && reviewed.atomic !== null) {
    const spent = BigInt(readSession().spentAtomic) + reviewed.atomic;
    writeSession({ spentAtomic: spent.toString() });
  }
  append("settled", {
    url,
    host: new URL(url).host,
    status: paid.status,
    success: ok,
    transaction: settled?.transaction ?? null,
    payTo: requirement.payTo,
    amount: requirement.amount,
  });
  return {
    ok,
    status: paid.status,
    body: paidBody,
    contentType: paid.headers.get("content-type"),
    transaction: settled?.transaction ?? null,
    stop: null,
  };
}

export async function pay(url: string): Promise<number> {
  const reviewed = await review(url);
  if (reviewed.verdict !== "APPROVE") return 2;
  if (!(await confirm())) {
    process.stdout.write("not signed\n");
    return 3;
  }
  const result = await settle(url, reviewed);
  if (result.stop) {
    process.stdout.write(`${boldRed(`STOP: ${result.stop}`)}\n`);
    return 2;
  }
  process.stdout.write(`HTTP ${result.status}\n${result.body.slice(0, 800)}\n`);
  if (result.transaction) {
    process.stdout.write(`https://explorer.solana.com/tx/${result.transaction}\n`);
  } else {
    process.stdout.write("no PAYMENT-RESPONSE transaction\n");
  }
  return result.ok ? 0 : 1;
}
