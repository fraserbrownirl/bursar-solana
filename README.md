# bursar-solana

A command-line agent that pays an x402 service on Solana mainnet from its own prepaid wallet. Before anything is signed, Ethereus-9B checks the transaction with the computer compiled into its weights. That check is part of the model. A server cannot swap it for a different one, and text in the response body is not an input to it.

The facilitator is the merchant's, named by `extra.feePayer` in the 402. For a merchant such as citable.run this program only builds a `PAYMENT-SIGNATURE`. It does not settle. The attack server, where this program is the merchant, reads a public facilitator's live `/supported` and uses the first one that lists `exact` on `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`. Checked 2026-11-08: Dexter at `https://x402.dexter.cash/supported` lists that network. Corbits at `https://facilitator.corbits.dev/supported` did not resolve, so it is only tried if Dexter's list is missing the network. `https://x402.org/facilitator` is not used (Solana testnet only). GoPlausible is not used.

## Do this, see this

`bursar init` writes a new key to the macOS keychain and prints the address, then `fund with USDC and 0.05 SOL`. Run once on this machine it printed `12V1TSPu8MzdByT7EDanmLt8i9xCMwWpciUFppGhr5ps`. The model never sees the key. The signature is produced only after you answer `y`.

`bursar add <name> <address>` asks the model for `sol ata <address> <USDC mint>` and caches the tool response. An ATA derivation takes several minutes on this Mac, so it is done once. `bursar pay` reads that cache and does not derive an ATA. Add this wallet's own address too; pay also needs that cached account.

`bursar pay <url>` GETs the URL, builds the transfer to the cached accounts using the 402's amount, mint, payTo and fee payer, and asks the model to check those bytes. Fast calls (`sol ui`, `sol fee`, `sol amount`) go to `localhost:8000`, model id `ethereus-9b`. Slow calls (`sol ata`, `sol x402 check`) replay `fixtures/recorded.json` until the dispatcher posts timings at `~/.bursar/timings.json` or `ethereus-internal/docs/bursar-timings.json`. A slow call with no recording stops instead of starting a live one.

One recording is in the tree, from a live call on 2026-11-08:

```
tool call: sol ui 5000 6
computed in-weights: 0.005
3775 ms recorded
```

The server reported `usage.locals.wall_s` 3.775. No ATA or x402-check recording exists yet, so `add` and the in-weights check inside `pay` and `demo` are not live.

The endpoint probed the same day, because `~/Dev/bursar-solana-notes.md` was not on disk:

`GET https://citable.run/v1/keyword-suggest?seed=solana&limit=3` returned 402, amount `5000`, USDC, Solana mainnet. Building the unsigned transaction from that 402 took about 2 seconds of RPC and produced 496 bytes (command 1106 characters). It was not signed and not submitted. The wallet above has not been funded.

`bursar demo --attack N` serves a local 402 that names Dexter's current fee payer, then runs the same review as `pay`. The STOP and APPROVE lines for attacks 1, 2, 3, 4, 5, 7 and 8 are checked in `test/decide.test.ts` against tool results. They have not been run through the model. Attacks 5 and 7 put a non-cached destination, or a second instruction, on the transaction the check sees. A 402 cannot insert an instruction into a transaction this client builds.

## What is live

Solana mainnet USDC `exact` payments, as a signature over the merchant's 402. Base, NEAR and Stellar are not wired.

## Model

[frsrcom/ethereus-9b](https://huggingface.co/frsrcom/ethereus-9b). An unauthenticated fetch of the model card returned HTTP 401, so the eval table is not copied here.

## Credits

Qwen3.5 (Alibaba), Qwenputer (Divyansh Agrawal), Locals (Generated Computers), x402 (Coinbase).

Apache-2.0.
