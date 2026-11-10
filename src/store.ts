import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type Payee = {
  address: string;
  ata?: string;
  ataCall?: string;
  ataResult?: string;
};

export type Wallet = {
  address: string;
  ata?: string;
  ataCall?: string;
  ataResult?: string;
};

export type Session = { spentAtomic: string };

/** State directory. `BURSAR_HOME` overrides it (tests use a temporary one). */
export const dir = () => {
  const path = process.env.BURSAR_HOME ?? join(homedir(), ".bursar");
  mkdirSync(path, { recursive: true });
  return path;
};

function payeePath(): string {
  return join(dir(), "payees.json");
}

function sessionPath(): string {
  return join(dir(), "session.json");
}

function walletPath(): string {
  return join(dir(), "wallet.json");
}

export function readPayees(): Record<string, Payee> {
  const path = payeePath();
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, Payee>;
}

export function writePayee(name: string, payee: Payee): void {
  const all = readPayees();
  all[name] = payee;
  writeFileSync(payeePath(), JSON.stringify(all, null, 2) + "\n");
}

export function payeeAddresses(): string[] {
  return Object.values(readPayees()).map((payee) => payee.address);
}

export function payeeByAddress(address: string): Payee | undefined {
  return Object.values(readPayees()).find((payee) => payee.address === address);
}

export function readWallet(): Wallet | null {
  const path = walletPath();
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as Wallet;
}

export function writeWallet(wallet: Wallet): void {
  const prev = readWallet();
  const next = prev && prev.address === wallet.address ? { ...prev, ...wallet } : wallet;
  writeFileSync(walletPath(), JSON.stringify(next, null, 2) + "\n");
}

export function atasFrom(
  self: Wallet | null,
  payee: Payee | undefined,
  payTo: string,
  destinationOverride?: string,
): { sourceAta: string; destinationAta: string } {
  if (!self?.ata) {
    throw new Error("this wallet's USDC ATA is not cached. Run bursar add with this wallet's address. pay does not derive an ATA.");
  }
  if (!payee?.ata || payee.address !== payTo) {
    throw new Error(`no cached ATA for ${payTo}. Run bursar add. pay does not derive an ATA.`);
  }
  return { sourceAta: self.ata, destinationAta: destinationOverride ?? payee.ata };
}

/** Source and destination token accounts for a payment. Both must already be cached. */
export function atasForPay(payTo: string, destinationOverride?: string): { sourceAta: string; destinationAta: string } {
  return atasFrom(readWallet(), payeeByAddress(payTo), payTo, destinationOverride);
}

export function readSession(): Session {
  const path = sessionPath();
  if (!existsSync(path)) return { spentAtomic: "0" };
  return JSON.parse(readFileSync(path, "utf8")) as Session;
}

export function writeSession(session: Session): void {
  writeFileSync(sessionPath(), JSON.stringify(session, null, 2) + "\n");
}

export function resetSession(): void {
  writeSession({ spentAtomic: "0" });
}
