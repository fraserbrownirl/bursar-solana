#!/usr/bin/env node
import { createKeyPairSignerFromBytes } from "@solana/kit";
import bs58 from "bs58";
import { generateSecret, keychainHasWallet, saveWallet, loadWalletSecret } from "./keychain.js";
import { ask, printHit } from "./model.js";
import { pay, review, settle, type Review } from "./pay.js";
import { startGuard } from "./guard/proxy.js";
import { head, readLedger, verify } from "./guard/ledger.js";
import { forget, hostileList } from "./guard/memory.js";
import { resetSession, writePayee, writeWallet } from "./store.js";
import { demo } from "./demo.js";

function usage(): never {
  process.stderr.write(
    "bursar init\n"
    + "bursar add <name> <address>\n"
    + "bursar pay <url>\n"
    + "bursar demo --attack <1|2|3|4|5|7|8>\n"
    + "bursar guard [--port 8402]          local payment guard for agents (BURSAR_GUARD_TOKEN optional)\n"
    + "bursar log [n] | log verify | log head\n"
    + "bursar hostile | hostile forget <host-or-address>\n",
  );
  process.exit(2);
}

async function init(): Promise<void> {
  if (keychainHasWallet()) {
    const signer = await createKeyPairSignerFromBytes(bs58.decode(loadWalletSecret()));
    writeWallet({ address: signer.address });
    process.stdout.write(`${signer.address}\n`);
    process.stdout.write("a key is already in the keychain. fund with USDC and 0.05 SOL\n");
    return;
  }
  const created = generateSecret();
  saveWallet(created.secretBase58);
  const signer = await createKeyPairSignerFromBytes(bs58.decode(created.secretBase58));
  writeWallet({ address: signer.address });
  resetSession();
  process.stdout.write(`${signer.address}\n`);
  process.stdout.write("fund with USDC and 0.05 SOL\n");
}

async function add(name: string, wallet: string): Promise<void> {
  const cmd = `sol ata ${wallet} usdc`;
  const hit = await ask(cmd);
  printHit(hit);
  if (hit.result.startsWith("error")) process.exit(1);
  writePayee(name, { address: wallet, ata: hit.result.trim(), ataCall: cmd, ataResult: hit.result.trim() });
  if (keychainHasWallet()) {
    const signer = await createKeyPairSignerFromBytes(bs58.decode(loadWalletSecret()));
    if (signer.address === wallet) {
      writeWallet({
        address: wallet,
        ata: hit.result.trim(),
        ataCall: cmd,
        ataResult: hit.result.trim(),
      });
    }
  }
}

async function main(): Promise<void> {
  const [command, arg, extra] = process.argv.slice(2);
  if (command === "init") {
    await init();
    return;
  }
  if (command === "add") {
    if (!arg || !extra) usage();
    await add(arg, extra);
    return;
  }
  if (command === "pay") {
    if (!arg) usage();
    process.exit(await pay(arg));
  }
  if (command === "guard") {
    const port = arg === "--port" && extra ? Number(extra) : 8402;
    const token = process.env.BURSAR_GUARD_TOKEN;
    await startGuard<Review>({
      rail: { review: (url, request) => review(url, {}, {}, request), settle },
      port,
      ...(token ? { token } : {}),
    });
    process.stderr.write(
      `bursar guard on http://127.0.0.1:${port}/fetch?url=<target>`
      + (token ? " (bearer token required)" : "") + "\n",
    );
    return;
  }
  if (command === "log") {
    if (arg === "verify") {
      const result = verify();
      process.stdout.write(result.ok
        ? `ok: ${result.entries} entries, head ${result.head}\n`
        : `BROKEN at entry ${result.badAt} of ${result.entries}: ${result.problem}\n`);
      process.exit(result.ok ? 0 : 1);
    }
    if (arg === "head") {
      const top = head();
      process.stdout.write(`${top.hash}  (entry ${top.seq}) timestamp this hash, e.g. echo it to a file and run: ots stamp <file>\n`);
      return;
    }
    const n = arg ? Number(arg) : 20;
    for (const entry of readLedger().slice(-n)) {
      const d = entry.data as Record<string, unknown>;
      const what = entry.kind === "settled"
        ? `settled ${String(d.success)} ${String(d.transaction ?? "")}`
        : `${String(d.verdict ?? "")} ${String(d.reason ?? "")}`;
      process.stdout.write(`#${entry.seq} ${entry.ts} ${entry.kind} ${String(d.host ?? "")} ${what} ${entry.hash.slice(0, 12)}\n`);
    }
    return;
  }
  if (command === "hostile") {
    if (arg === "forget") {
      if (!extra) usage();
      process.stdout.write(forget(extra) ? `forgot ${extra}\n` : `not remembered: ${extra}\n`);
      return;
    }
    for (const item of hostileList()) {
      process.stdout.write(`${item.kind} ${item.value}  ${item.reason}  first seen ${item.firstSeen}\n`);
    }
    return;
  }
  if (command === "demo") {
    if (arg !== "--attack" || !extra) usage();
    const attack = Number(extra);
    if (![1, 2, 3, 4, 5, 7, 8].includes(attack)) usage();
    process.exit(await demo(attack as 1 | 2 | 3 | 4 | 5 | 7 | 8));
  }
  usage();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
