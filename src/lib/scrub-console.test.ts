import { describe, expect, it, vi } from "vitest";

import { scrubConsole } from "@/lib/scrub-console";

function fakeConsole() {
  const calls: unknown[][] = [];
  const record = (...args: unknown[]) => void calls.push(args);
  const target = {
    log: record,
    info: record,
    warn: record,
    error: record,
    debug: record,
    trace: record,
  } as unknown as Console;
  scrubConsole(target);
  return { target, calls };
}

describe("scrubConsole", () => {
  it("scrubs strings and objects passed to any method", () => {
    const { target, calls } = fakeConsole();
    target.log("signed in as ada@example.com");
    target.warn({ email: "ada@example.com", id: 1 });

    expect(calls).toEqual([["signed in as [email]"], [{ email: "[redacted]", id: 1 }]]);
  });

  it("keeps errors as errors - like Next's own '⨯' output - with message and stack scrubbed", () => {
    const { target, calls } = fakeConsole();
    const error = Object.assign(new Error("No guest ada@example.com"), { digest: "123" });
    target.error(" ⨯", error);

    const [, printed] = calls[0] as [string, Error & { digest: string }];
    expect(printed).toBeInstanceOf(Error);
    expect(printed.message).toBe("No guest [email]");
    expect(printed.stack).not.toContain("ada@example.com");
    expect(printed.digest).toBe("123");
    // The original is left alone.
    expect(error.message).toBe("No guest ada@example.com");
  });

  it("passes non-sensitive values through unchanged", () => {
    const { target, calls } = fakeConsole();
    const spy = vi.fn();
    target.info("ready in", 342, "ms", spy);
    expect(calls[0]).toEqual(["ready in", 342, "ms", spy]);
  });
});
