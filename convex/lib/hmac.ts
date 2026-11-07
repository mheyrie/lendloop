/**
 * HMAC-SHA256 helpers (Web Crypto, works in the default Convex runtime).
 *
 * Signature scheme, same in both directions:
 *   header  X-LendLoop-Timestamp: <unix seconds>
 *   header  X-LendLoop-Signature: v1=<hex hmac>
 *   signed string = `${timestamp}.${METHOD}.${path}.${rawBody}`
 *
 * Binding the method, path and timestamp means a captured signature can't be replayed
 * against another endpoint or after the tolerance window.
 */

export const SIGNATURE_TOLERANCE_SECONDS = 300;

const encoder = new TextEncoder();

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function signingString(timestamp: string, method: string, path: string, body: string): string {
  return `${timestamp}.${method.toUpperCase()}.${path}.${body}`;
}

/** Constant-time comparison so response timing doesn't leak how many characters matched. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signRequest(secret: string, method: string, path: string, body: string, nowMs = Date.now()) {
  const timestamp = Math.floor(nowMs / 1000).toString();
  const hex = await hmacSha256Hex(secret, signingString(timestamp, method, path, body));
  return { timestamp, signature: `v1=${hex}` };
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

export async function verifySignature(opts: {
  secret: string;
  method: string;
  path: string;
  body: string;
  timestamp: string | null;
  signature: string | null;
  nowMs?: number;
}): Promise<VerifyResult> {
  const { secret, method, path, body, timestamp, signature } = opts;
  if (!timestamp || !signature) return { ok: false, reason: "missing signature headers" };
  if (!/^\d+$/.test(timestamp)) return { ok: false, reason: "bad timestamp" };
  const now = Math.floor((opts.nowMs ?? Date.now()) / 1000);
  if (Math.abs(now - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) {
    return { ok: false, reason: "timestamp outside tolerance" };
  }
  const expected = `v1=${await hmacSha256Hex(secret, signingString(timestamp, method, path, body))}`;
  return timingSafeEqual(expected, signature) ? { ok: true } : { ok: false, reason: "signature mismatch" };
}
