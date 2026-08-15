/**
 * Canonical serialisation + hashing.
 *
 * Determinism requires that "the same input" is a byte-exact concept, so every
 * object is serialised with sorted keys before hashing. The digest of a
 * decision's input set is persisted, which is what lets a replay prove it fed
 * the engine identical data.
 */

export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
}

/** SHA-256 over the canonical form. Available in both the worker and the browser. */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function digestOf(value: unknown): Promise<string> {
  return sha256Hex(canonicalize(value));
}
