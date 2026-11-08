import { spawnSync } from "node:child_process";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { createKeyPairSignerFromBytes, type KeyPairSigner } from "@solana/kit";

const SERVICE = "bursar-solana";
const ACCOUNT = "wallet";

function security(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("security", args, { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

export function keychainHasWallet(): boolean {
  const result = security(["find-generic-password", "-s", SERVICE, "-a", ACCOUNT]);
  return result.status === 0;
}

export function saveWallet(secretBase58: string): void {
  const result = security([
    "add-generic-password",
    "-U",
    "-s", SERVICE,
    "-a", ACCOUNT,
    "-w", secretBase58,
  ]);
  if (result.status !== 0) {
    throw new Error(`security add-generic-password failed: ${result.stderr.trim()}`);
  }
}

export function loadWalletSecret(): string {
  const result = security(["find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w"]);
  if (result.status !== 0) {
    throw new Error("no bursar key in the keychain. Run bursar init.");
  }
  return result.stdout.trim();
}

export async function signerFromKeychain(): Promise<KeyPairSigner> {
  const secret = loadWalletSecret();
  const bytes = bs58.decode(secret);
  return createKeyPairSignerFromBytes(bytes);
}

export function generateSecret(): { secretBase58: string; publicKey: Uint8Array } {
  const pair = nacl.sign.keyPair();
  return { secretBase58: bs58.encode(pair.secretKey), publicKey: pair.publicKey };
}
