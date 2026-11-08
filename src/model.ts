import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MODEL_URL } from "./constants.js";
import { markLine } from "./color.js";

export type ToolHit = {
  cmd: string;
  result: string;
  ms: number;
  kind: "live" | "replayed" | "firmware";
  recordedOn?: string;
};

export type Recording = { cmd: string; result: string; ms: number; source?: string; recorded: string };

/** The only labels a check may carry. */
export function checkMark(hit: ToolHit): string {
  if (hit.kind === "live") return `${hit.ms} ms live (model, Mac)`;
  if (hit.kind === "replayed") {
    if (!hit.recordedOn) throw new Error("replayed check is missing its recorded date");
    return `${hit.ms} ms replayed (model, recorded ${hit.recordedOn})`;
  }
  if (hit.kind === "firmware") return `${hit.ms} ms firmware check (emulator)`;
  throw new Error("check has no label");
}

type Completion = {
  choices?: { message?: {
    content?: string | null;
    reasoning_content?: string | null;
    tool_calls?: { function?: { arguments?: string } }[];
  } }[];
  error?: { message?: string };
  id?: string;
  status?: string;
};

/** ATA derivation and the x402 check take minutes on this Mac. */
export function isSlow(cmd: string): boolean {
  return cmd.startsWith("sol ata ") || cmd.startsWith("sol x402 check ");
}

/** Live slow calls wait until timings are posted to BURSAR_TIMINGS or noted in BURSAR_LOG (both default to ~/.bursar/). */
export function timingsPosted(): boolean {
  const timings = process.env.BURSAR_TIMINGS ?? join(homedir(), ".bursar", "timings.json");
  if (existsSync(timings)) return true;
  const log = process.env.BURSAR_LOG ?? join(homedir(), ".bursar", "dispatcher-log.md");
  if (!existsSync(log)) return false;
  return readFileSync(log, "utf8").split("\n").some((line) => line.includes("bursar timings"));
}

function recordingFiles(): string[] {
  const bundled = fileURLToPath(new URL("../fixtures/recorded.json", import.meta.url));
  return [process.env.BURSAR_RECORDINGS, bundled].flatMap((path) => {
    if (!path || !existsSync(path)) return [];
    return [path];
  });
}

export function recordings(): Recording[] {
  const out: Recording[] = [];
  for (const path of recordingFiles()) {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Recording[];
    out.push(...parsed);
  }
  return out;
}

export function recordedHit(cmd: string): ToolHit | null {
  const found = recordings().find((item) => item.cmd === cmd);
  if (!found) return null;
  if (!found.recorded) throw new Error(`recording for ${cmd} has no date`);
  return { cmd, result: found.result, ms: found.ms, kind: "replayed", recordedOn: found.recorded };
}
function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const key = process.env.BURSAR_MODEL_KEY;
  if (key) headers.authorization = `Bearer ${key}`;
  return headers;
}

/** The message field where the server returns the tool call and its <tool_response>. */
export const TOOL_FIELD = "reasoning_content";

function extract(body: Completion, cmd: string): string {
  const text = body.choices?.[0]?.message?.[TOOL_FIELD] ?? "";
  const matched = text.match(/<tool_response>\n?([\s\S]*?)\n?<\/tool_response>/);
  if (matched?.[1]?.trim()) return matched[1].trim();
  throw new Error(`no in-weights tool result for ${cmd}${text ? `\n${text.slice(0, 500)}` : ""}`);
}

async function post(body: unknown): Promise<Response> {
  return fetch(MODEL_URL, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
}

async function pollJob(id: string): Promise<Completion> {
  const jobUrl = new URL(MODEL_URL);
  jobUrl.pathname = `/v1/jobs/${id}`;
  const deadline = Date.now() + 15 * 60 * 1000;
  while (Date.now() < deadline) {
    const response = await fetch(jobUrl, { headers: authHeaders() });
    if (response.status === 202) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      continue;
    }
    if (!response.ok) {
      throw new Error(`model job ${id} HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
    return await response.json() as Completion;
  }
  throw new Error(`model job ${id} did not finish`);
}

/** One eth command. The result is the tool response, not the model's prose. */
export async function ask(cmd: string): Promise<ToolHit> {
  if (isSlow(cmd) && !timingsPosted()) {
    const hit = recordedHit(cmd);
    if (!hit) {
      throw new Error(
        "this call is slow (sol ata or sol x402 check) and has no recorded response. "
        + "Live calls start when timings are posted to BURSAR_TIMINGS (default ~/.bursar/timings.json) "
        + "or noted in BURSAR_LOG (default ~/.bursar/dispatcher-log.md).",
      );
    }
    return hit;
  }
  const started = Date.now();
  const payload = {
    model: "bursar-9b",
    max_tokens: 262144,
    messages: [{
      role: "user",
      content:
        "Call the eth tool once. Put this text in the cmd argument and do not change a character of it:\n"
        + cmd,
    }],
  };
  let response = await post(payload);
  if (response.status === 408) {
    response = await post({ ...payload, mode: "async" });
  }
  if (!response.ok && response.status !== 202) {
    throw new Error(`model HTTP ${response.status} at ${MODEL_URL}: ${(await response.text()).slice(0, 300)}`);
  }
  let body = await response.json() as Completion;
  if (response.status === 202 && body.id) body = await pollJob(body.id);
  if (body.error?.message) throw new Error(body.error.message);
  return { cmd, result: extract(body, cmd), ms: Date.now() - started, kind: "live" };
}

export function printHit(hit: ToolHit): void {
  process.stdout.write(`tool call: ${hit.cmd}\ncomputed in-weights: ${hit.result}\n${markLine(checkMark(hit))}\n`);
}
