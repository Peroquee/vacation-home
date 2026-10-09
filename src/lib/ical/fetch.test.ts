import { describe, expect, it, vi } from "vitest";

import { fetchFeed } from "./fetch";

const none = { etag: null, lastModified: null };
const answer = (response: Response) => vi.fn(async () => response) as unknown as typeof fetch;

describe("fetchFeed", () => {
  it("returns the feed with its validators", async () => {
    const fetcher = answer(
      new Response("BEGIN:VCALENDAR", { headers: { etag: '"v1"', "last-modified": "Fri" } }),
    );
    expect(await fetchFeed("https://x.test/a.ics", none, fetcher)).toEqual({
      kind: "fetched",
      text: "BEGIN:VCALENDAR",
      etag: '"v1"',
      lastModified: "Fri",
    });
  });

  it("asks conditionally, and takes a 304 as unchanged", async () => {
    const fetcher = answer(new Response(null, { status: 304 }));
    expect(
      await fetchFeed("https://x.test/a.ics", { etag: '"v1"', lastModified: "Fri" }, fetcher),
    ).toEqual({ kind: "unchanged" });
    const init = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit;
    expect(init.headers).toMatchObject({ "If-None-Match": '"v1"', "If-Modified-Since": "Fri" });
  });

  it("reports failures as codes", async () => {
    expect(
      await fetchFeed("https://x.test", none, answer(new Response("no", { status: 404 }))),
    ).toEqual({ kind: "failed", code: "http_404" });
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(await fetchFeed("https://x.test", none, down)).toEqual({
      kind: "failed",
      code: "unreachable",
    });
    const slow = vi.fn(async () => {
      throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
    }) as unknown as typeof fetch;
    expect(await fetchFeed("https://x.test", none, slow)).toEqual({
      kind: "failed",
      code: "timeout",
    });
  });

  it("refuses a feed over 5 MB", async () => {
    const big = new Response("x".repeat(5 * 1024 * 1024 + 1));
    expect(await fetchFeed("https://x.test", none, answer(big))).toEqual({
      kind: "failed",
      code: "too_large",
    });
  });
});
