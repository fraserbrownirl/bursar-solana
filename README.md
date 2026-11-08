# Bursar

**The wallet killer. A payment agent that handles blockchain payments and it can't be talked into paying the wrong person, because it checks every payment with a computer compiled into its own weights. Signing things we didn't understand was always the barrier that wallets would never overcome.**

Bursar pays x402 services on Solana mainnet from its own prepaid wallet. Before anything is signed, the model calls a RISC-V computer that lives inside its weights to decode the exact amount, token, recipient and fee. Bursar's rules then decide **APPROVE** or **STOP**. A hostile server can lie in its 402, swap the recipient, or change one character of an address, and Bursar still pays the right amount to the right party or refuses.

▶ **Demo video:** `[https://youtu.be/z3yoF6aJjp4]`  ·  ✅ **Real mainnet payment:** [2MSFP4Bi…aXtecxaMuQ3hiCGo](https://explorer.solana.com/tx/2MSFP4BiqvhsxmwJUE9S2iqB8k2sZFAV7fK7rPCDKnxbPeSwfkFFQPp7QYuTHDtbiUNuBmT4aXtecxaMuQ3hiCGo)  ·  🧠 **Model:** [huggingface.co/frsrcom/bursar-9b](https://huggingface.co/frsrcom/bursar-9b)

---

## Why this matters

Agents are starting to pay for things themselves, through x402 and agent wallets. Today that leaves two bad options:

- **A wallet asks you to sign everything.** That defeats the point of an agent, and people sign blind anyway.
- **The agent signs on its own.** Language models guess at numbers. A guessed amount or address is lost money, and a prompt injection in a server's response can steer the payment.

Bursar takes a third path. **Exact checks happen inside the model, on your machine.** A small computer is compiled into the model's layers, so the check can't be swapped, downloaded or poisoned at runtime; it changes only with a new release of the weights. The model never sees the key, and a prepaid balance plus hard limits cap any mistake.

## What we proved today

| | Result |
|---|---|
| **Real payment on Solana mainnet** | Paid 0.005 USDC to `citable.run`, a live x402 service. Wallet USDC 0.178198 → 0.173198. [Transaction](https://explorer.solana.com/tx/2MSFP4BiqvhsxmwJUE9S2iqB8k2sZFAV7fK7rPCDKnxbPeSwfkFFQPp7QYuTHDtbiUNuBmT4aXtecxaMuQ3hiCGo) |
| **Attack 1: price × 1000** | **STOP:** amount exceeds the per-payment limit |
| **Attack 2: recipient swapped after the first request** | **STOP:** recipient differs from the known payee |
| **Attack 4: one character of the address changed** | **STOP:** recipient differs from the known payee |
| **Exact values computed in the model's weights, live on a Mac** | USDC token accounts, amounts, fees, in 2–5 s each (token accounts about 55 s) |

## How it works

```
 x402 server ──402──▶ bursar CLI ──tool call──▶ Bursar-9B (on your Mac, localhost:8000)
                          │                         │  Qwen3.5-9B + a RISC-V computer
                          │                         │  compiled into its layers
                          │◀── exact result ────────┘
                          │
                rules: known payee? under limit?
                          │
                 APPROVE ─┴─ STOP
                    │
         sign with keychain key (model never sees it)
                    │
          PAYMENT-SIGNATURE ──▶ merchant's facilitator settles on mainnet
```

1. **`bursar pay <url>`** requests the resource and gets an x402 `402 Payment Required`.
2. **The transaction check.** The firmware verifies the unsigned transaction: exactly one `TransferChecked` of the right mint and amount, to the payee's token account.
3. **The model computes the values.** It calls its in-weights computer to turn atomic units into amounts (`sol ui 5000 6` → `0.005`) and to compute the fee. The CLI never computes these itself; it prints each tool call and its result.
4. **Bursar's rules decide.** The payee must be one you added with `bursar add`. Limits are 0.05 USDC per payment and 1 USDC per session.
5. **One plain line.** For example: `PAY 0.005 USDC on Solana to 6nWr…MWzK. From 0.005 USDC. Fee 0.000010001 SOL. APPROVE`
6. **Sign and pay.** The key lives in the macOS keychain. Bursar returns the `PAYMENT-SIGNATURE`, and the merchant's facilitator (named in the 402's `feePayer`) settles.

### What's live and what isn't

Every check on screen is labelled, so you can see what ran where:

- **`live (model, Mac)`**: Bursar-9B ran the call on a MacBook, inside its weights.
- **`firmware check (emulator)`**: the same firmware, run in its reference emulator. A whole transaction is longer than one model call can take today; passing it in as a file is the next runtime feature.
- **`replayed (model, recorded <date>)`**: a stored model result.

## The run, verbatim

### Paying citable.run on mainnet

```
$ bursar pay "https://citable.run/v1/keyword-suggest?seed=solana&limit=3"
402 payTo: 6nWrWRTqrqpqbu5MsMW8mPDpZjKLwPb9Wf8BdMwNMWzK
402 amount: 5000
402 network: solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp
402 feePayer: CjNFTjvBhbJJd2B5ePPMHRLx1ELZpa8dwQgGL727eKww (named by the merchant)
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

Full transcript: [`docs/runs/pay-citable.txt`](docs/runs/pay-citable.txt).

### Adding a payee: the model computes its token account

```
tool call: sol ata 6nWrWRTqrqpqbu5MsMW8mPDpZjKLwPb9Wf8BdMwNMWzK usdc
computed in-weights: 7uQVdgRUNggcsJSbKA5oCRkiCrxLErUoQxueyV9PM48f
55155 ms live (model, Mac)
```

It's computed once and cached; `pay` reads the cached account.

### Three attacks from a hostile server

`bursar demo --attack N` starts a local x402 merchant that tampers with its own 402. Full transcript: [`docs/runs/attacks.txt`](docs/runs/attacks.txt).

**Attack 1: price inflated 1,000×.** The transaction is well formed and matches the inflated 402, so the transaction check alone passes it. The exact amount is 10 USDC, so the limit stops it.

```
tool call: sol x402 check @tx @to @mint 10000000 6
computed in-weights: ok
1062 ms firmware check (emulator)
tool call: sol ui 10000000 6
computed in-weights: 10
2566 ms live (model, Mac)
PAY 10 USDC on Solana to EeBmvKUq8yJJYawMaZtma8kF4apAkwmgpPVKtf8j73hW. From 10 USDC. Fee 0.000010001 SOL. STOP: amount exceeds the per-payment limit
```

**Attack 2: recipient swapped after the first request.**

```
PAY 0.01 USDC on Solana to 6Dw9wiuYMCYSTNCMjhFWjbNhPa3QiaCLFXSWch9tqn6V. From 0.01 USDC. Fee 0.000010001 SOL. STOP: recipient differs from the known payee
```

**Attack 4: one character of the payee address changed.** A person skimming the address would miss it; an exact comparison doesn't.

```
PAY 0.01 USDC on Solana to 2GipSsuSzrp5rWbWW7FQzpvT3K54iG3ovXwWJPuUyjUQ. From 0.01 USDC. Fee 0.000010001 SOL. STOP: recipient differs from the known payee
```

## Try it

Requirements: Node 20+, macOS (for the keychain), and Bursar-9B served at `http://localhost:8000/v1/chat/completions`.

```
npm install
npm run bursar -- init                 # create the wallet; key goes to the macOS keychain
npm run bursar -- add citable 6nWrWRTqrqpqbu5MsMW8mPDpZjKLwPb9Wf8BdMwNMWzK
npm run bursar -- pay "https://citable.run/v1/keyword-suggest?seed=solana&limit=3"
npm run bursar -- demo --attack 1      # also 2 and 4
npm test
```

Fund the wallet with a little USDC and about 0.05 SOL first. Bursar-9B needs its runtime, a decoding loop that runs the computer inside the model on Apple Silicon. That runtime isn't public yet.

## The model: Bursar-9B

- **Base:** Qwen3.5-9B (Alibaba), stock 4-bit weights.
- **Computer:** an RV32IM CPU compiled into Gated DeltaNet layers in front of Qwen's own. Its memory is the layers' recurrent state; it runs firmware token by token and returns exact results.
- **Firmware:**
  - **Solana:** base58, associated token accounts, amounts and fees, the x402 SVM transaction check.
  - **EVM:** keccak-256, ABI, EIP-712.
  - **NEAR Intents and Stellar:** pieces also built, in firmware. Every operation is checked against independent reference libraries.
- **On exact computation** (eth-evals tools track, 33 tasks): stock Qwen3.5-9B scores 0/33; Bursar-9B with its computer and prompting scores 10/33. This build is untrained; fine-tuning it to use the computer across multi-step payments comes next.

## What's next

- **A Mac app**, with the key in the Secure Enclave and Touch ID only for new payees, top-ups and limit changes.
- **More chains:** Base, NEAR Intents (cross-chain) and Stellar, with firmware already in the model.
- **Transactions passed to the model as files**, so the full transaction check also runs in the weights live.
- **Fine-tuning**, so the model calls its computer before every payment, recovers from errors and ignores injected instructions.

## Credits

- [Qwen3.5](https://huggingface.co/Qwen) by Alibaba's Qwen team (Apache-2.0)
- Qwenputer, the computer-in-the-weights technique, by Divyansh Agrawal
- Locals by Generated Computers, the Mac runtime it builds on (Apache-2.0)
- [x402](https://github.com/coinbase/x402) by Coinbase

## Licence

Apache-2.0.
