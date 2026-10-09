import { describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({ up: true }));
vi.mock("@/lib/db", () => ({
  db: {
    $queryRaw: async () => {
      if (!database.up) throw new Error("connection refused");
      return [{ "?column?": 1 }];
    },
  },
}));

import { GET as health } from "../health/route";
import { GET as ready } from "./route";

describe("health checks", () => {
  it("reports the process alive regardless of the database", async () => {
    database.up = false;
    const response = health();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("reports ready only while the database answers", async () => {
    database.up = true;
    expect((await ready()).status).toBe(200);
    database.up = false;
    const down = await ready();
    expect(down.status).toBe(503);
    expect(await down.json()).toEqual({ status: "unavailable" });
    expect(down.headers.get("cache-control")).toBe("no-store");
  });
});
