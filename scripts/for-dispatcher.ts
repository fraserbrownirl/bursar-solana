import { mkdirSync, writeFileSync } from "node:fs";
import { address } from "@solana/kit";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { findAssociatedTokenPda } from "@solana-program/token-2022";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { attackFeePayer } from "../src/facilitator.js";
import { signerFromKeychain } from "../src/keychain.js";
import { lookalikeAddress } from "../src/lookalike.js";
import { propose, type SolanaRequirement } from "../src/propose.js";
import { LIVE_GET, SOLANA_MAINNET, USDC_MINT } from "../src/constants.js";
import nacl from "tweetnacl";
import bs58 from "bs58";

type Built = {
  name: string;
  payTo: string;
  amount: string;
  destinationAta: string;
  hex: string;
  check: string;
};

async function ata(owner: string): Promise<string> {
  const [account] = await findAssociatedTokenPda({
    mint: address(USDC_MINT),
    owner: address(owner),
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  return account;
}

async function build(
  name: string,
  signer: Awaited<ReturnType<typeof signerFromKeychain>>,
  sourceAta: string,
  payTo: string,
  amount: string,
  feePayer: string,
): Promise<Built> {
  const destinationAta = await ata(payTo);
  const requirements: SolanaRequirement = {
    scheme: "exact",
    network: SOLANA_MAINNET,
    asset: USDC_MINT,
    amount,
    payTo,
    maxTimeoutSeconds: 300,
    extra: { feePayer, memo: name },
  };
  const proposal = await propose(signer, requirements, { sourceAta, destinationAta });
  const check = `sol x402 check 0x${proposal.unsignedHex} ${payTo} ${USDC_MINT} ${amount} ${proposal.checkDecimals}`;
  return { name, payTo, amount, destinationAta, hex: proposal.unsignedHex, check };
}

const signer = await signerFromKeychain();
const dexter = await attackFeePayer();
if (dexter.name !== "Dexter") throw new Error(`expected Dexter, got ${dexter.name}`);

const response = await fetch(LIVE_GET);
const encoded = response.headers.get("payment-required");
if (response.status !== 402 || !encoded) throw new Error(`citable HTTP ${response.status}`);
const doc = decodePaymentRequiredHeader(encoded);
const quoted = doc.accepts.find((item) =>
  item.scheme === "exact" && item.network === SOLANA_MAINNET && item.asset === USDC_MINT
);
if (!quoted) throw new Error("citable 402 has no exact Solana mainnet USDC requirement");

const merchant = bs58.encode(nacl.sign.keyPair().publicKey);
const swapped = bs58.encode(nacl.sign.keyPair().publicKey);
const lookalike = lookalikeAddress(merchant);
const sourceAta = await ata(signer.address);

const txs = [
  await build("citable.run", signer, sourceAta, quoted.payTo, quoted.amount, dexter.feePayer),
  await build("attack-1", signer, sourceAta, merchant, "10000000", dexter.feePayer),
  await build("attack-2", signer, sourceAta, swapped, "10000", dexter.feePayer),
  await build("attack-4", signer, sourceAta, lookalike, "10000", dexter.feePayer),
];

mkdirSync("docs", { recursive: true });
writeFileSync("docs/for-dispatcher.json", JSON.stringify({
  built: "2026-11-08",
  payer: signer.address,
  sourceAta,
  feePayer: dexter.feePayer,
  feePayerFrom: dexter.url,
  citableFeePayer: quoted.extra?.feePayer ?? null,
  citableUrl: LIVE_GET,
  note: "Token accounts in these transactions come from findAssociatedTokenPda. That is not a model check and not a firmware check. No check has been run on these bytes.",
  txs,
}, null, 2) + "\n");

for (const tx of txs) {
  process.stdout.write(`${tx.name} ${tx.hex.length / 2} bytes payTo ${tx.payTo} amount ${tx.amount}\n`);
}
process.stdout.write(`fee payer ${dexter.feePayer}\n`);
process.stdout.write(`citable 402 fee payer ${String(quoted.extra?.feePayer)}\n`);
