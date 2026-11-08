import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MODEL_URL } from "./constants.js";

export type ToolHit = { cmd: string; result: string; ms: number; recorded?: boolean };

export type Recording = { cmd: string; result: string; ms: number; source?: string };

type Completion = {
  choices?: { message?: {
    content?: string | null;
    reasoning_content?: string | null;
    tool_calls?: { function?: { arguments?: string } }[];
  } }[];
  ethereus?: { tool_messages?: { content?: string }[] };
  error?: { message?: string };
  id?: string;
  status?: string;
};

/** ATA derivation and the x402 check take minutes on this Mac. */
export function isSlow(cmd: string): boolean {
  return cmd.startsWith("sol ata ") || cmd.startsWith("sol x402 check ");
}

/** Live slow calls wait until the dispatcher posts timings in one of these places. */
export function timingsPosted(): boolean {
  const paths = [
    process.env.BURSAR_TIMINGS,
    join(homedir(), ".bursar", "timings.json"),
    "/Users/fraserbrown/Dev/ethereus-internal/docs/bursar-timings.json",
  ].filter((path): path is string => Boolean(path));
  if (paths.some((path) => existsSync(path))) return true;
  const log = "/Users/fraserbrown/Dev/ethereus-internal/docs/dispatcher-log.md";
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
  return { cmd, result: found.result, ms: found.ms, recorded: true };
}
function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const key = process.env.BURSAR_MODEL_KEY ?? process.env.ETHEREUS_API_KEY;
  if (key) headers.authorization = `Bearer ${key}`;
  return headers;
}

function extract(body: Completion, cmd: string): string {
  const message = body.choices?.[0]?.message;
  const calls = message?.tool_calls ?? [];
  const tools = body.ethereus?.tool_messages ?? [];
  for (let i = 0; i < calls.length; i++) {
    let args: { cmd?: string } = {};
    try {
      args = JSON.parse(calls[i]?.function?.arguments ?? "{}") as { cmd?: string };
    } catch {
      args = {};
    }
    const got = (args.cmd ?? "").trim();
    const head = cmd.split(" ").slice(0, 3).join(" ");
    if (got === cmd || got.startsWith(head)) {
      const content = tools[i]?.content?.trim();
      if (content) return content;
    }
  }
  const blobs = [message?.content, message?.reasoning_content, tools[0]?.content]
    .filter((part): part is string => typeof part === "string");
  for (const text of blobs) {
    const matched = text.match(/<tool_response>\n?([\s\S]*?)\n?<\/tool_response>/);
    if (matched?.[1]?.trim()) return matched[1].trim();
  }
  if (tools.length === 1 && tools[0]?.content?.trim()) return tools[0].content.trim();
  const preview = blobs.join("\n").slice(0, 500);
  throw new Error(`no in-weights tool result for ${cmd}${preview ? `\n${preview}` : ""}`);
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
        + "Live calls start when the dispatcher posts timings to ~/.bursar/timings.json "
        + "or docs/bursar-timings.json.",
      );
    }
    return hit;
  }
  const started = Date.now();
  const payload = {
    model: "ethereus-9b",
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
  return { cmd, result: extract(body, cmd), ms: Date.now() - started };
}

export function printHit(hit: ToolHit): void {
  const timing = hit.recorded ? `${hit.ms} ms recorded` : `${hit.ms} ms`;
  process.stdout.write(`tool call: ${hit.cmd}\ncomputed in-weights: ${hit.result}\n${timing}\n`);
}
