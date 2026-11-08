#!/usr/bin/env node
import { createKeyPairSignerFromBytes } from "@solana/kit";
import bs58 from "bs58";
import { generateSecret, keychainHasWallet, saveWallet, loadWalletSecret } from "./keychain.js";
import { ask, printHit } from "./model.js";
import { pay } from "./pay.js";
import { resetSession, writePayee, writeWallet } from "./store.js";
import { demo } from "./demo.js";
import { USDC_MINT } from "./constants.js";

function usage(): never {
  process.stderr.write(
    "bursar init\n"
    + "bursar add <name> <address>\n"
    + "bursar pay <url>\n"
    + "bursar demo --attack <1|2|3|4|5|7|8>\n",
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
  const cmd = `sol ata ${wallet} ${USDC_MINT}`;
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
