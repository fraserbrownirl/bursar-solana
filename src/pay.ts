import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  decodePaymentRequiredHeader,
  decodePaymentResponseHeader,
  encodePaymentSignatureHeader,
} from "@x402/core/http";
import { ask, printHit, type ToolHit } from "./model.js";
import { propose, requirementAmount, type SolanaRequirement } from "./propose.js";
import { decide } from "./decide.js";
import { atasForPay, payeeAddresses, readSession, writeSession } from "./store.js";
import { signerFromKeychain } from "./keychain.js";
import { PER_PAYMENT_UI, SESSION_UI, SOLANA_MAINNET, USDC_DECIMALS, USDC_MINT } from "./constants.js";

type RequiredDoc = {
  x402Version: number;
  resource?: { url?: string; description?: string; mimeType?: string };
  accepts?: SolanaRequirement[];
  extensions?: Record<string, unknown>;
};

export type Review = {
  line: string;
  verdict: "STOP" | "APPROVE";
  atomic: bigint | null;
  requirement: SolanaRequirement;
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

export async function review(url: string, tamper: { destinationAta?: string; extraLamports?: boolean } = {}): Promise<Review> {
  const first = await fetch(url);
  const body = await first.text();
  const encoded = first.headers.get("payment-required");
  if (first.status !== 402 || !encoded) {
    throw new Error(`expected 402 with PAYMENT-REQUIRED, got HTTP ${first.status}`);
  }
  if (body.trim()) process.stdout.write(`response body: ${body.slice(0, 500)}\n`);
  const doc = decodePaymentRequiredHeader(encoded) as RequiredDoc;
  const requirement = selectSolanaUsdc(doc);
  process.stdout.write(
    `402 asset: ${requirement.asset}\n402 payTo: ${requirement.payTo}\n402 amount: ${requirement.amount}\n`
    + `402 network: ${requirement.network}\n`
    + `402 feePayer: ${String(requirement.extra?.feePayer ?? "")} (named by the merchant)\n`,
  );

  const accounts = atasForPay(requirement.payTo, tamper.destinationAta);
  const signer = await signerFromKeychain();
  const proposal = await propose(signer, requirement, accounts, { extraLamports: tamper.extraLamports });
  process.stdout.write(
    `mint decimals: ${proposal.mintDecimals} (SPL mint account, @solana-program/token fetchMint)\n`,
  );
  if (proposal.declaredDecimals !== null) {
    process.stdout.write(`402 extra.decimals: ${proposal.declaredDecimals}\n`);
  }
  process.stdout.write(`unsigned transaction: ${proposal.unsignedHex.length / 2} bytes\n`);

  const checkCmd = `sol x402 check 0x${proposal.unsignedHex} ${requirement.payTo} ${requirement.asset} ${requirement.amount} ${proposal.checkDecimals}`;
  const check = await ask(checkCmd);
  printHit(check);
  const uiAmount = await ask(`sol ui ${requirement.amount} ${proposal.mintDecimals}`);
  printHit(uiAmount);
  const feeAtomic = await ask(proposal.feeCommand);
  printHit(feeAtomic);
  const uiFee = await ask(`sol ui ${feeAtomic.result.trim()} 9`);
  printHit(uiFee);

  const hits = [check, uiAmount, feeAtomic, uiFee];
  const checkText = check.result.trim();
  const known = payeeAddresses();
  const needsLimits = checkText === "ok" && known.includes(requirement.payTo);
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

  const decision = decide({
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
  process.stdout.write(`${decision.line}\n`);
  process.stdout.write("token: USDC because the 402 asset is the Circle USDC mint\n");
  process.stdout.write(`chain: Solana because the 402 network is ${requirement.network}\n`);

  return {
    line: decision.line,
    verdict: decision.verdict,
    atomic: decision.atomic,
    requirement,
    sign: proposal.sign,
    hits,
  };
}

export async function pay(url: string): Promise<number> {
  const reviewed = await review(url);
  if (reviewed.verdict !== "APPROVE") return 2;
  if (!(await confirm())) {
    process.stdout.write("not signed\n");
    return 3;
  }
  const transaction = await reviewed.sign();
  const first = await fetch(url);
  const encoded = first.headers.get("payment-required");
  if (!encoded) throw new Error("the paid retry's preview 402 disappeared");
  const doc = decodePaymentRequiredHeader(encoded) as RequiredDoc;
  const requirement = selectSolanaUsdc(doc);
  if (requirement.payTo !== reviewed.requirement.payTo || requirement.amount !== reviewed.requirement.amount) {
    process.stdout.write("STOP: the 402 changed between the check and the signature\n");
    return 2;
  }
  const payload = {
    x402Version: doc.x402Version,
    resource: doc.resource,
    accepted: requirement,
    payload: { transaction },
    extensions: doc.extensions,
  };
  // The merchant's facilitator settles. This client only returns the signature.
  const paid = await fetch(url, {
    headers: { "PAYMENT-SIGNATURE": encodePaymentSignatureHeader(payload as never) },
  });
  const paidBody = await paid.text();
  process.stdout.write(`HTTP ${paid.status}\n${paidBody.slice(0, 800)}\n`);
  const settledHeader = paid.headers.get("payment-response");
  if (!settledHeader) {
    process.stdout.write("no PAYMENT-RESPONSE header\n");
    return paid.ok ? 0 : 1;
  }
  const settled = decodePaymentResponseHeader(settledHeader) as { transaction?: string; success?: boolean };
  if (settled.transaction) {
    process.stdout.write(`https://explorer.solana.com/tx/${settled.transaction}\n`);
  } else {
    process.stdout.write(`PAYMENT-RESPONSE: ${JSON.stringify(settled)}\n`);
  }
  if (settled.success && reviewed.atomic !== null) {
    const spent = BigInt(readSession().spentAtomic) + reviewed.atomic;
    writeSession({ spentAtomic: spent.toString() });
  }
  return settled.success ? 0 : 1;
}
