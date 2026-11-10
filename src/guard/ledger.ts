/**
 * Tamper-evident ledger of every decision and settlement. Each entry carries
 * the hash of the one before it, so editing, removing or reordering any past
 * entry breaks every hash after it. `bursar log head` prints the latest hash,
 * which can be timestamped externally (for example with OpenTimestamps) to
 * prove the ledger existed in that state at that time.
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { dir } from "../store.js";

export const GENESIS = "0".repeat(64);

export type LedgerEntry = {
  seq: number;
  ts: string;
  prev: string;
  kind: "decision" | "settled" | "hostile";
  data: Record<string, unknown>;
  hash: string;
};

export function ledgerPath(): string {
  return join(dir(), "ledger.jsonl");
}

/** JSON with object keys sorted at every level, so the same entry always hashes the same. */
export function canonical(value: unknown): string {
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
}

export function entryHash(entry: Omit<LedgerEntry, "hash">): string {
  return createHash("sha256").update(canonical(entry)).digest("hex");
}

export function readLedger(path = ledgerPath()): LedgerEntry[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as LedgerEntry);
}

export function head(path = ledgerPath()): { seq: number; hash: string } {
  const entries = readLedger(path);
  const last = entries[entries.length - 1];
  return last ? { seq: last.seq, hash: last.hash } : { seq: -1, hash: GENESIS };
}

/** Appends an entry chained to the current head and returns it. */
export function append(kind: LedgerEntry["kind"], data: Record<string, unknown>, path = ledgerPath()): LedgerEntry {
  const top = head(path);
  const body = {
    seq: top.seq + 1,
    ts: new Date().toISOString(),
    prev: top.hash,
    kind,
    data: JSON.parse(canonical(data)) as Record<string, unknown>,
  };
  const entry: LedgerEntry = { ...body, hash: entryHash(body) };
  appendFileSync(path, JSON.stringify(entry) + "\n");
  return entry;
}

export type Verification = { ok: true; entries: number; head: string } | { ok: false; entries: number; badAt: number; problem: string };

/** Recomputes every hash and link. Reports the first entry that does not match. */
export function verify(path = ledgerPath()): Verification {
  const entries = readLedger(path);
  let prev = GENESIS;
  for (const [index, entry] of entries.entries()) {
    if (entry.seq !== index) return { ok: false, entries: entries.length, badAt: index, problem: `seq is ${entry.seq}, expected ${index}` };
    if (entry.prev !== prev) return { ok: false, entries: entries.length, badAt: index, problem: "prev does not match the previous entry's hash" };
    const { hash, ...body } = entry;
    if (entryHash(body) !== hash) return { ok: false, entries: entries.length, badAt: index, problem: "hash does not match the entry's contents" };
    prev = hash;
  }
  return { ok: true, entries: entries.length, head: prev };
}
