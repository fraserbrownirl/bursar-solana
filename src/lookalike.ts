import bs58 from "bs58";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** A base58 address of 32 bytes whose text differs in exactly one character. */
export function lookalikeAddress(known: string): string {
  for (let i = 0; i < known.length; i++) {
    for (const c of ALPHABET) {
      if (c === known[i]) continue;
      const next = known.slice(0, i) + c + known.slice(i + 1);
      try {
        if (bs58.decode(next).length === 32) return next;
      } catch {
        /* not valid base58 */
      }
    }
  }
  throw new Error(`no one-character lookalike of ${known}`);
}
