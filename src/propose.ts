import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createSolanaRpc,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  partiallySignTransactionMessageWithSigners,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type KeyPairSigner,
} from "@solana/kit";
import { fetchMint, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import {
  getTransferCheckedInstruction,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "@solana-program/token-2022";
import { getTransferSolInstruction } from "@solana-program/system";
import {
  DEFAULT_COMPUTE_UNIT_LIMIT,
  DEFAULT_COMPUTE_UNIT_PRICE_MICROLAMPORTS,
  MAX_MEMO_BYTES,
  MEMO_PROGRAM_ADDRESS,
  computeBudgetInstructions,
} from "@x402/svm";

export type SolanaRequirement = {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
};
import { RPC_URL, SOLANA_MAINNET_GENESIS } from "./constants.js";

export type Proposal = {
  /** Serialized transaction before the keychain signs. The check covers these bytes. */
  unsignedHex: string;
  mintDecimals: number;
  /** Decimals the 402 declared, when it declared any. */
  declaredDecimals: number | null;
  /** Decimals passed to `sol x402 check`. */
  checkDecimals: number;
  feeCommand: string;
  sign: () => Promise<string>;
};

type Tamper = {
  extraLamports?: boolean;
};

export type CachedAccounts = {
  sourceAta: string;
  destinationAta: string;
};

function declaredDecimals(extra: Record<string, unknown> | undefined): number | null {
  const value = extra?.decimals;
  if (value === undefined || value === null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 255) {
    throw new Error(`402 extra.decimals is not a u8: ${JSON.stringify(value)}`);
  }
  return parsed;
}

export async function propose(
  signer: KeyPairSigner,
  requirements: SolanaRequirement,
  accounts: CachedAccounts,
  tamper: Tamper = {},
): Promise<Proposal> {
  const rpc = createSolanaRpc(RPC_URL);
  const genesis = await rpc.getGenesisHash().send();
  if (genesis !== SOLANA_MAINNET_GENESIS) {
    throw new Error(`RPC genesis is ${genesis}, not Solana mainnet`);
  }

  const mint = address(requirements.asset);
  const mintAccount = await fetchMint(rpc, mint);
  const program = mintAccount.programAddress;
  if (program !== TOKEN_PROGRAM_ADDRESS && program !== TOKEN_2022_PROGRAM_ADDRESS) {
    throw new Error(`mint ${requirements.asset} is not an SPL or Token-2022 mint`);
  }
  const mintDecimals = mintAccount.data.decimals;
  const claimed = declaredDecimals(requirements.extra);
  const feePayer = requirements.extra?.feePayer;
  if (typeof feePayer !== "string" || feePayer.length === 0) {
    throw new Error("402 extra.feePayer is missing");
  }
  const sourceAta = address(accounts.sourceAta);
  const destinationAta = address(accounts.destinationAta);

  const transfer = getTransferCheckedInstruction(
    {
      source: sourceAta,
      mint,
      destination: destinationAta,
      authority: signer,
      amount: BigInt(requirements.amount),
      decimals: mintDecimals,
    },
    { programAddress: program },
  );

  const sellerMemo = requirements.extra?.memo;
  let memoData: Uint8Array;
  if (typeof sellerMemo === "string") {
    memoData = new TextEncoder().encode(sellerMemo);
    if (memoData.byteLength > MAX_MEMO_BYTES) {
      throw new Error(`extra.memo exceeds ${MAX_MEMO_BYTES} bytes`);
    }
  } else {
    const nonce = crypto.getRandomValues(new Uint8Array(16));
    memoData = new TextEncoder().encode(Buffer.from(nonce).toString("hex"));
  }
  const memo = {
    programAddress: address(MEMO_PROGRAM_ADDRESS),
    accounts: [] as const,
    data: memoData,
  };

  const budget = {
    computeUnitLimit: DEFAULT_COMPUTE_UNIT_LIMIT,
    computeUnitPriceMicroLamports: DEFAULT_COMPUTE_UNIT_PRICE_MICROLAMPORTS,
  };
  const extra = tamper.extraLamports
    ? [getTransferSolInstruction({
      source: signer,
      destination: address(requirements.payTo),
      amount: 1n,
    })]
    : [];

  const latest = await rpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayer(address(feePayer), tx),
    (tx) => appendTransactionMessageInstructions(
      [...computeBudgetInstructions(0, budget), transfer, memo, ...extra],
      tx,
    ),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latest.value, tx),
  );

  const unsigned = compileTransaction(message);
  const wire = getBase64EncodedWireTransaction(unsigned);
  const unsignedHex = Buffer.from(wire, "base64").toString("hex");

  return {
    unsignedHex,
    mintDecimals,
    declaredDecimals: claimed,
    checkDecimals: claimed ?? mintDecimals,
    feeCommand: `sol fee 2 ${DEFAULT_COMPUTE_UNIT_LIMIT} ${DEFAULT_COMPUTE_UNIT_PRICE_MICROLAMPORTS}`,
    sign: async () => {
      const signed = await partiallySignTransactionMessageWithSigners(message);
      return getBase64EncodedWireTransaction(signed);
    },
  };
}

export function requirementAmount(requirements: SolanaRequirement): string {
  if (!/^\d+$/.test(requirements.amount)) {
    throw new Error(`402 amount is not an atomic integer: ${requirements.amount}`);
  }
  return requirements.amount;
}

export type { Address };
