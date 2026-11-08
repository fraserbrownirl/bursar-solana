import { spawnSync } from "node:child_process";
import bs58 from "bs58";
import type { ToolHit } from "./model.js";

const PYTHON = process.env.BURSAR_PYTHON
  ?? "/Users/fraserbrown/Dev/ethereus/experimental/riscv/.venv/bin/python";
const RISC = "/Users/fraserbrown/Dev/ethereus/experimental/riscv";

const PROGRAM = `
import json, sys, time
sys.path.insert(0, ${JSON.stringify(RISC)})
from chipformer.rv import eth, bridge as BR
req = json.load(sys.stdin)
files = {"tx": "0x" + req["tx"], "to": req["toHex"], "mint": req["mintHex"]}
started = time.time()
machine = eth.machine_with_files("", files, path=eth.BRIDGE_ELF)
BR.park(machine)
text = BR.Text(BR.default_tokenizer())
session = BR.Session(text, machine)
session.history(text.encode("<|im_start|>user\\nDo it.<|im_end|>\\n<|im_start|>assistant\\n"))
cmd = "sol x402 check @tx @to @mint %s %s" % (req["amount"], req["decimals"])
session.qwen(text.encode(
    "<tool_call>\\n<function=eth>\\n<parameter=cmd>\\n%s\\n</parameter>\\n</function>\\n</tool_call>" % cmd
))
out = text.decode_bytes(session.runs[-1]).decode()
result = out.split("<tool_response>")[1].split("</tool_response>")[0].strip()
json.dump({"cmd": cmd, "result": result, "ms": int((time.time() - started) * 1000)}, sys.stdout)
`;

/** The full transaction does not fit a model call. The bridge emulator reads it from files. */
export function firmwareCheck(txHex: string, payTo: string, mint: string, amount: string, decimals: number): ToolHit {
  const started = Date.now();
  const run = spawnSync(PYTHON, ["-c", PROGRAM], {
    input: JSON.stringify({
      tx: txHex,
      toHex: Buffer.from(bs58.decode(payTo)).toString("hex"),
      mintHex: Buffer.from(bs58.decode(mint)).toString("hex"),
      amount,
      decimals: String(decimals),
    }),
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  if (run.status !== 0) {
    throw new Error(`firmware check failed: ${(run.stderr || run.stdout || "").slice(0, 500)}`);
  }
  const parsed = JSON.parse(run.stdout) as { cmd: string; result: string; ms: number };
  return {
    cmd: parsed.cmd,
    result: parsed.result,
    ms: parsed.ms || Date.now() - started,
    kind: "firmware",
  };
}
