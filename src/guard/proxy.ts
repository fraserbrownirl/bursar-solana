/**
 * The payment guard: a local HTTP endpoint that any agent on this machine
 * fetches paid resources through. Free responses pass straight through. A 402
 * goes through Bursar's review (injection scan, campaign memory, the computer's
 * checks, limits, evidence). An APPROVE is signed and paid without a prompt,
 * because the owner's rules already authorised it; a STOP never reaches the
 * signer. Payments are handled one at a time so the session limit holds.
 *
 *   GET  http://127.0.0.1:8402/health
 *   ANY  http://127.0.0.1:8402/fetch?url=<encoded target URL>
 *
 * Responses carry `x-bursar-verdict` (FREE | APPROVE | STOP), and for payments
 * `x-bursar-line`, `x-bursar-tx` and `x-bursar-ledger`.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { head } from "./ledger.js";
import type { Evidence } from "./evidence.js";

export type GuardRequest = { method?: string; headers?: Record<string, string>; body?: string };

export type GuardReview = {
  line: string;
  verdict: "STOP" | "APPROVE";
  reason: string | null;
  evidence: Evidence[];
};

export type GuardSettlement = {
  ok: boolean;
  status: number;
  body: string;
  contentType: string | null;
  transaction: string | null;
  stop: string | null;
};

/** A payment rail. Solana today; NEAR plugs in with the same two calls. */
export type Rail<R extends GuardReview = GuardReview> = {
  review(url: string, request: GuardRequest): Promise<R>;
  settle(url: string, reviewed: R, request: GuardRequest): Promise<GuardSettlement>;
};

/** Request headers forwarded to the merchant. Everything else, including the agent's auth to the guard, stays local. */
const FORWARD = ["accept", "content-type", "user-agent"];

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(value, null, 2) + "\n");
}

function headerSafe(text: string): string {
  return text.replace(/[^\x20-\x7e]/g, "?").slice(0, 900);
}

export function startGuard<R extends GuardReview>(options: {
  rail: Rail<R>;
  port?: number;
  host?: string;
  token?: string;
  log?: (line: string) => void;
}): Promise<Server> {
  const log = options.log ?? ((line: string) => process.stderr.write(`[guard] ${line}\n`));
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work);
    queue = next.catch(() => undefined);
    return next;
  };

  const server = createServer(async (req, res) => {
    try {
      const here = new URL(req.url ?? "/", "http://guard.local");
      if (options.token && req.headers.authorization !== `Bearer ${options.token}`) {
        json(res, 401, { error: "missing or wrong bearer token" });
        return;
      }
      if (here.pathname === "/health") {
        json(res, 200, { ok: true, ledger: head() });
        return;
      }
      if (here.pathname !== "/fetch") {
        json(res, 404, { error: "use /fetch?url=<target> or /health" });
        return;
      }
      const target = here.searchParams.get("url");
      if (!target) {
        json(res, 400, { error: "missing url" });
        return;
      }
      const parsed = new URL(target);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        json(res, 400, { error: "only http and https targets" });
        return;
      }

      const headers: Record<string, string> = {};
      for (const name of FORWARD) {
        const value = req.headers[name];
        if (typeof value === "string") headers[name] = value;
      }
      const method = (req.method ?? "GET").toUpperCase();
      const body = method === "GET" || method === "HEAD" ? undefined : await readBody(req);
      const request: GuardRequest = { method, headers, ...(body !== undefined ? { body } : {}) };

      const probe = await fetch(target, { method, headers, ...(body !== undefined ? { body } : {}) });
      if (probe.status !== 402) {
        const text = await probe.text();
        log(`FREE ${probe.status} ${target}`);
        res.writeHead(probe.status, {
          "content-type": probe.headers.get("content-type") ?? "application/octet-stream",
          "x-bursar-verdict": "FREE",
        });
        res.end(text);
        return;
      }

      await serial(async () => {
        const reviewed = await options.rail.review(target, request);
        if (reviewed.verdict !== "APPROVE") {
          log(`STOP ${target}: ${reviewed.reason ?? reviewed.line}`);
          json(res, 403, {
            verdict: "STOP",
            reason: reviewed.reason,
            line: reviewed.line,
            evidence: reviewed.evidence,
            ledger: head(),
          }, { "x-bursar-verdict": "STOP", "x-bursar-line": headerSafe(reviewed.line) });
          return;
        }
        const settled = await options.rail.settle(target, reviewed, request);
        if (settled.stop) {
          log(`STOP at settlement ${target}: ${settled.stop}`);
          json(res, 409, { verdict: "STOP", reason: settled.stop, ledger: head() }, { "x-bursar-verdict": "STOP" });
          return;
        }
        log(`APPROVE ${target} ${settled.transaction ?? ""}`);
        res.writeHead(settled.status, {
          "content-type": settled.contentType ?? "application/octet-stream",
          "x-bursar-verdict": "APPROVE",
          "x-bursar-line": headerSafe(reviewed.line),
          "x-bursar-tx": settled.transaction ?? "",
          "x-bursar-ledger": head().hash,
        });
        res.end(settled.body);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`error ${message}`);
      if (!res.headersSent) json(res, 502, { error: message, verdict: "STOP" }, { "x-bursar-verdict": "STOP" });
      else res.end();
    }
  });

  return new Promise((resolve) => {
    server.listen(options.port ?? 8402, options.host ?? "127.0.0.1", () => resolve(server));
  });
}
