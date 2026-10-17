/**
 * The client's address, for the rate limits (src/lib/rate-limit.ts), when a
 * proxy in front of the app reports it - and only one we trust, since any
 * client can send these headers itself. Pure, so it is testable.
 *
 * - "none": the app is reached directly; no header is believed.
 * - "forwarded": a reverse proxy (Caddy) sets X-Forwarded-For; its first
 *   entry is the client.
 * - "cloudflare": requests come through a Cloudflare Tunnel (GitLab #113),
 *   and Cloudflare puts the client in CF-Connecting-IP, one address,
 *   overwriting whatever the client sent. X-Forwarded-For is not used then:
 *   cloudflared appends to it, so its first entry is the client's to choose.
 */
export type ProxyTrust = "none" | "forwarded" | "cloudflare";

// An IPv4 or IPv6 address as text: digits, hex, dots and colons. Anything
// else is not an address Cloudflare would send, and is not believed.
const ADDRESS = /^[0-9A-Fa-f:.]{2,45}$/;

export function clientAddress(headers: Headers, trust: ProxyTrust): string | null {
  const value =
    trust === "cloudflare"
      ? headers.get("cf-connecting-ip")
      : trust === "forwarded"
        ? headers.get("x-forwarded-for")?.split(",")[0]
        : null;
  const address = value?.trim();
  return address && ADDRESS.test(address) ? address : null;
}
