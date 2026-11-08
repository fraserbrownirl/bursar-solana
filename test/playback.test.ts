import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { attackFeePayer, feePayerFromKinds } from "../src/facilitator.js";
import { recordedHit } from "../src/model.js";
import { atasFrom } from "../src/store.js";
import { SOLANA_MAINNET } from "../src/constants.js";

test("the committed recording is the live sol ui call", () => {
  const hit = recordedHit("sol ui 5000 6");
  assert.ok(hit);
  assert.equal(hit.result, "0.005");
  assert.equal(hit.ms, 3775);
  assert.equal(hit.kind, "replayed");
  assert.equal(hit.recordedOn, "2026-11-08");
});

test("an unknown command has no recording to replay", () => {
  assert.equal(recordedHit("sol ata not-recorded usdc"), null);
});

test("a stored response is labelled replayed", () => {
  const dir = mkdtempSync(join(tmpdir(), "bursar-rec-"));
  const path = join(dir, "recorded.json");
  writeFileSync(path, JSON.stringify([{
    cmd: "sol ata WalletMint USDC",
    result: "CachedAta111",
    ms: 180000,
    recorded: "2026-11-08",
    source: "playback fixture for the test, not a model observation",
  }]));
  process.env.BURSAR_RECORDINGS = path;
  try {
    const hit = recordedHit("sol ata WalletMint USDC");
    assert.ok(hit);
    assert.equal(hit.result, "CachedAta111");
    assert.equal(hit.kind, "replayed");
    assert.equal(hit.recordedOn, "2026-11-08");
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
