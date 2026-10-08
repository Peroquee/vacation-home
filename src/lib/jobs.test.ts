import * as Sentry from "@sentry/nextjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const output = vi.hoisted(() => [] as string[]);

vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/logger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/logger")>();
  return {
    ...actual,
    logger: actual.createLogger({ write: (line: string) => void output.push(line) }),
  };
});

import { runJob } from "@/lib/jobs";

const lines = () => output.map((line) => JSON.parse(line));

beforeEach(() => {
  output.length = 0;
  vi.mocked(Sentry.captureException).mockClear();
});

describe("runJob", () => {
  it("tags every line with the job and the request that enqueued it", async () => {
    const result = await runJob(
      "gcal.outbound-sync",
      { requestId: "req-12345678" },
      async (log) => {
        log.info({ bookingId: "b1" }, "pushing booking");
        return 42;
      },
    );

    expect(result).toBe(42);
    const logged = lines();
    expect(logged.map((l) => l.msg)).toEqual(["job started", "pushing booking", "job finished"]);
    for (const line of logged) {
      expect(line).toMatchObject({ job: "gcal.outbound-sync", requestId: "req-12345678" });
      expect(line.jobId).toBe(logged[0].jobId);
    }
    expect(logged[2].durationMs).toBeTypeOf("number");
  });

  it("logs and reports a failure with the same ids, then rethrows", async () => {
    const failure = new Error("Google API returned 503 for ada@example.com");

    await expect(
      runJob("gcal.outbound-sync", { requestId: "req-12345678" }, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);

    const failed = lines().at(-1);
    expect(failed).toMatchObject({ level: "error", msg: "job failed" });
    expect(failed.err.message).toBe("Google API returned 503 for [email]");

    expect(Sentry.captureException).toHaveBeenCalledWith(failure, {
      tags: { job: "gcal.outbound-sync", job_id: failed.jobId, request_id: "req-12345678" },
    });
  });
});
