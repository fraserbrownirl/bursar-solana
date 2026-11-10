/**
 * Campaign memory. Hosts and recipient addresses that attacked this wallet
 * are remembered, and any later payment to them stops before anything else
 * runs. Memory also records the recipient each host last asked to be paid,
 * so a host that switches recipient is caught even when the new address
 * looks plausible.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dir } from "../store.js";

export type HostileKind = "host" | "address";

export type Hostile = {
  kind: HostileKind;
  value: string;
  reason: string;
  firstSeen: string;
  url?: string;
};

type MemoryFile = {
  hostile: Hostile[];
  /** host → the payTo it last asked for, when that payTo was a known payee. */
  lastPayTo: Record<string, string>;
};

function memoryPath(): string {
  return join(dir(), "memory.json");
}

function read(): MemoryFile {
  const path = memoryPath();
  if (!existsSync(path)) return { hostile: [], lastPayTo: {} };
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<MemoryFile>;
  return { hostile: parsed.hostile ?? [], lastPayTo: parsed.lastPayTo ?? {} };
}

function write(memory: MemoryFile): void {
  writeFileSync(memoryPath(), JSON.stringify(memory, null, 2) + "\n");
}

export function hostileList(): Hostile[] {
  return read().hostile;
}

/** Records a hostile host or address. Repeat records keep the first sighting. */
export function remember(kind: HostileKind, value: string, reason: string, url?: string): void {
  if (!value) return;
  const memory = read();
  if (memory.hostile.some((item) => item.kind === kind && item.value === value)) return;
  memory.hostile.push({ kind, value, reason, firstSeen: new Date().toISOString(), ...(url ? { url } : {}) });
  write(memory);
}

/** Removes a remembered host or address. Returns whether anything was removed. */
export function forget(value: string): boolean {
  const memory = read();
  const before = memory.hostile.length;
  memory.hostile = memory.hostile.filter((item) => item.value !== value);
  if (memory.hostile.length === before) return false;
  write(memory);
  return true;
}

/** The remembered entry that blocks a payment to this host or recipient, if any. */
export function knownHostile(host: string, payTo: string): Hostile | undefined {
  return read().hostile.find((item) =>
    (item.kind === "host" && item.value === host) || (item.kind === "address" && item.value === payTo)
  );
}

export function lastPayTo(host: string): string | undefined {
  return read().lastPayTo[host];
}

export function recordPayTo(host: string, payTo: string): void {
  const memory = read();
  memory.lastPayTo[host] = payTo;
  write(memory);
}

/** Levenshtein distance, capped: returns `cap + 1` as soon as the distance must exceed `cap`. */
export function editDistance(a: string, b: string, cap = 3): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      rowMin = Math.min(rowMin, cur[j]!);
    }
    if (rowMin > cap) return cap + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

/**
 * The known payee this address imitates: an address that is not a known payee
 * but sits within two edits of one.
 */
export function lookalikeOf(payTo: string, payees: Readonly<Record<string, string>>): { name: string; address: string } | undefined {
  for (const [name, address] of Object.entries(payees)) {
    if (address === payTo) return undefined;
  }
  for (const [name, address] of Object.entries(payees)) {
    if (editDistance(payTo, address, 2) <= 2) return { name, address };
  }
  return undefined;
}

export type MemoryVerdict =
  | { stop: false }
  | { stop: true; reason: string; mark: { kind: HostileKind; value: string }[] };

/**
 * Checks a 402 against campaign memory before any other work. Pure apart from
 * reading memory: the caller decides whether to mark what it returns.
 */
export function screen(input: {
  host: string;
  payTo: string;
  payees: Readonly<Record<string, string>>;
}): MemoryVerdict {
  const hit = knownHostile(input.host, input.payTo);
  if (hit) {
    return {
      stop: true,
      reason: `known hostile ${hit.kind} (${hit.reason}, first seen ${hit.firstSeen.slice(0, 10)})`,
      mark: hit.kind === "address" ? [{ kind: "host", value: input.host }] : [{ kind: "address", value: input.payTo }],
    };
  }
  const imitated = lookalikeOf(input.payTo, input.payees);
  if (imitated) {
    return {
      stop: true,
      reason: `recipient is a look-alike of payee ${imitated.name}`,
      mark: [{ kind: "host", value: input.host }, { kind: "address", value: input.payTo }],
    };
  }
  const previous = lastPayTo(input.host);
  const knownAddresses = Object.values(input.payees);
  if (previous && previous !== input.payTo && knownAddresses.includes(previous) && !knownAddresses.includes(input.payTo)) {
    return {
      stop: true,
      reason: "recipient switched from the payee this server named before",
      mark: [{ kind: "host", value: input.host }, { kind: "address", value: input.payTo }],
    };
  }
  return { stop: false };
}
