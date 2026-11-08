# bursar-solana

A command-line agent that pays an x402 service on Solana mainnet from its own wallet. Before it signs, a computer compiled into Ethereus decodes the exact amount, token, recipient and fee. Bursar's own rules then decide STOP or APPROVE: 0.05 USDC per payment, 1 USDC per session, and the recipient must be a payee that was added. The server cannot swap that computer, and text in the response body is not an input to the decision.

The fee payer is whoever the 402 names in `extra.feePayer`. This program does not settle. It returns a `PAYMENT-SIGNATURE`. Dexter's fee payer is used only by the local attack server.

Every check is labelled one of three ways:

- `live (model, Mac)` — Ethereus-9B at `localhost:8000` ran the call
- `replayed (model, recorded <date>)` — a stored model result
- `firmware check (emulator)` — `sol x402 check @tx @to @mint` on the all-chains bridge ELF, because the raw transaction does not fit a model call

## init

```
12V1TSPu8MzdByT7EDanmLt8i9xCMwWpciUFppGhr5ps
fund with USDC and 0.05 SOL
```

The key is in the macOS keychain. The model never sees it.

## add

`bursar add` asks for `sol ata <owner> usdc`. The full mint overflows the model's window.

```
tool call: sol ata 12V1TSPu8MzdByT7EDanmLt8i9xCMwWpciUFppGhr5ps usdc
computed in-weights: 5cmpQ1yYJXh3uoKEPZoNJ9CEU2x6bYVFQaUk9yuJRhpU
53403 ms live (model, Mac)
```

```
tool call: sol ata 6nWrWRTqrqpqbu5MsMW8mPDpZjKLwPb9Wf8BdMwNMWzK usdc
computed in-weights: 7uQVdgRUNggcsJSbKA5oCRkiCrxLErUoQxueyV9PM48f
55155 ms live (model, Mac)
```

`pay` reads those cached accounts. It does not derive one.

One earlier call is a replay, not a live run:

```
tool call: sol ui 5000 6
computed in-weights: 0.005
3775 ms replayed (model, recorded 2026-11-08)
```

## pay

`GET https://citable.run/v1/keyword-suggest?seed=solana&limit=3` returned 402 for 5000 units of USDC. The 402 names fee payer `CjNFTjvBhbJJd2B5ePPMHRLx1ELZpa8dwQgGL727eKww`. The computer said the amount is 0.005 USDC and the fee is 0.000010001 SOL. That is under the 0.05 limit, and the recipient was added, so Bursar approved. The wallet's USDC balance went from 0.178198 to 0.173198.

```
tool call: sol x402 check @tx @to @mint 5000 6
computed in-weights: ok
794 ms firmware check (emulator)
tool call: sol ui 5000 6
computed in-weights: 0.005
2881 ms live (model, Mac)
tool call: sol fee 2 20000 1
computed in-weights: 10001
3057 ms live (model, Mac)
tool call: sol ui 10001 9
computed in-weights: 0.000010001
4556 ms live (model, Mac)
PAY 0.005 USDC on Solana to 6nWrWRTqrqpqbu5MsMW8mPDpZjKLwPb9Wf8BdMwNMWzK. From 0.005 USDC. Fee 0.000010001 SOL. APPROVE
HTTP 200
https://explorer.solana.com/tx/2MSFP4BiqvhsxmwJUE9S2iqB8k2sZFAV7fK7rPCDKnxbPeSwfkFFQPp7QYuTHDtbiUNuBmT4aXtecxaMuQ3hiCGo
```

The full transcript is `docs/runs/pay-citable.txt`.

## Attacks

The local server is the merchant, so its 402 names Dexter (`DeXterR2kQm8AvRHnNPatWkE46TfAcMeBDjb6FySoAb8`), read from `https://x402.dexter.cash/supported`. Full transcript: `docs/runs/attacks.txt`.

Attack 1 multiplies a 0.01 price by 1000. The emulator says the transaction matches that inflated amount. The limit rule stops it.

```
tool call: sol x402 check @tx @to @mint 10000000 6
computed in-weights: ok
1062 ms firmware check (emulator)
tool call: sol ui 10000000 6
computed in-weights: 10
2566 ms live (model, Mac)
PAY 10 USDC on Solana to EeBmvKUq8yJJYawMaZtma8kF4apAkwmgpPVKtf8j73hW. From 10 USDC. Fee 0.000010001 SOL. STOP: amount exceeds the per-payment limit
```

Attack 2 swaps the recipient after the first response. Attack 4 changes one character. Neither address was added, so the payee rule stops both before any token-account lookup.

```
PAY 0.01 USDC on Solana to 6Dw9wiuYMCYSTNCMjhFWjbNhPa3QiaCLFXSWch9tqn6V. From 0.01 USDC. Fee 0.000010001 SOL. STOP: recipient differs from the known payee
```

```
PAY 0.01 USDC on Solana to 2GipSsuSzrp5rWbWW7FQzpvT3K54iG3ovXwWJPuUyjUQ. From 0.01 USDC. Fee 0.000010001 SOL. STOP: recipient differs from the known payee
```

The 0.01 and the fee in those lines are from live model calls in `docs/runs/attacks.txt`.

## What is wired

Solana mainnet USDC `exact` payments. Base, NEAR and Stellar are not.

## Model

[frsrcom/ethereus-9b](https://huggingface.co/frsrcom/ethereus-9b). An unauthenticated fetch of the model card returned HTTP 401, so the eval table is not copied here.

## Credits

Qwen3.5 (Alibaba), Qwenputer (Divyansh Agrawal), Locals (Generated Computers), x402 (Coinbase).

Apache-2.0.
