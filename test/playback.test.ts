import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { attackFeePayer, feePayerFromKinds } from "../src/facilitator.js";
import { ask, isSlow, recordedHit, timingsPosted } from "../src/model.js";
import { atasFrom } from "../src/store.js";
import { SOLANA_MAINNET } from "../src/constants.js";

test("the committed recording is the live sol ui call", () => {
  const hit = recordedHit("sol ui 5000 6");
  assert.ok(hit);
  assert.equal(hit.result, "0.005");
  assert.equal(hit.ms, 3775);
  assert.equal(hit.recorded, true);
});

test("a slow call with no recording does not start a live request", async () => {
  assert.equal(timingsPosted(), false);
  assert.equal(isSlow("sol ata SomeWallet EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"), true);
  await assert.rejects(
    () => ask("sol ata SomeWallet EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
    /no recorded response/,
  );
});

test("a slow call replays an exact recorded response", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bursar-rec-"));
  const path = join(dir, "recorded.json");
  writeFileSync(path, JSON.stringify([{
    cmd: "sol ata WalletMint USDC",
    result: "CachedAta111",
    ms: 180000,
    source: "playback fixture for the test, not a model observation",
  }]));
  process.env.BURSAR_RECORDINGS = path;
  try {
    const hit = await ask("sol ata WalletMint USDC");
    assert.equal(hit.result, "CachedAta111");
    assert.equal(hit.recorded, true);
    assert.equal(hit.ms, 180000);
  } finally {
    delete process.env.BURSAR_RECORDINGS;
  }
});

test("pay uses cached ATAs and does not derive one", () => {
  const accounts = atasFrom(
    { address: "payer", ata: "payer-ata" },
    { address: "merchant", ata: "merchant-ata" },
    "merchant",
  );
  assert.deepEqual(accounts, { sourceAta: "payer-ata", destinationAta: "merchant-ata" });
  assert.throws(() => atasFrom({ address: "payer" }, { address: "merchant", ata: "merchant-ata" }, "merchant"), /does not derive an ATA/);
  assert.throws(() => atasFrom({ address: "payer", ata: "payer-ata" }, undefined, "merchant"), /does not derive an ATA/);
});

test("fee payer selection requires exact Solana mainnet", () => {
  assert.equal(feePayerFromKinds([]), null);
  assert.equal(feePayerFromKinds([{
    x402Version: 2,
    scheme: "exact",
    network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    extra: { feePayer: "devnet" },
  }]), null);
  assert.equal(feePayerFromKinds([{
    x402Version: 2,
    scheme: "exact",
    network: SOLANA_MAINNET,
    extra: { feePayer: "MainnetPayer" },
  }]), "MainnetPayer");
});

test("Corbits is the backup only when its /supported lists mainnet", async () => {
  const fetchImpl = (async (url: string) => {
    if (String(url).includes("dexter")) return new Response("missing", { status: 404 });
    return Response.json({
      kinds: [{ x402Version: 2, scheme: "exact", network: SOLANA_MAINNET, extra: { feePayer: "CorbitsPayer" } }],
    });
  }) as typeof fetch;
  const picked = await attackFeePayer(fetchImpl);
  assert.equal(picked.name, "Corbits");
  assert.equal(picked.feePayer, "CorbitsPayer");
});

test("Dexter /supported lists exact Solana mainnet", async () => {
  const picked = await attackFeePayer();
  assert.equal(picked.name, "Dexter");
  assert.equal(picked.url, "https://x402.dexter.cash/supported");
  assert.match(picked.feePayer, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
});
