import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: vi.fn() }));

import { withLogContext } from "@/lib/log-context";
import { createLogger } from "@/lib/logger";

const EMAIL = "ada.lovelace@example.com";
const ACCESS_TOKEN = "ya29.a0AfB_byC1x2Y3z4-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
const REFRESH_TOKEN = "1//0gAbCdEfGhIjKlMnOpQrStUvWxYz-0123456789";

/** A logger writing into an array, one parsed JSON object per line. */
function capture() {
  const raw: string[] = [];
  const log = createLogger({ write: (line: string) => void raw.push(line) }, "debug");
  return { log, raw, lines: () => raw.map((line) => JSON.parse(line)) };
}

describe("logger", () => {
  it("writes one JSON object per line with a level label and ISO time", () => {
    const { log, lines } = capture();
    log.info({ bookingId: "b1" }, "booking saved");

    const [line] = lines();
    expect(line).toMatchObject({ level: "info", msg: "booking saved", bookingId: "b1" });
    expect(new Date(line.time).toISOString()).toBe(line.time);
  });

  it("adds the correlation ids of the current context", async () => {
    const { log, lines } = capture();
    await withLogContext({ requestId: "req-12345678" }, async () => {
      await withLogContext({ job: "gcal.sync", jobId: "job-1" }, async () => {
        log.info("inside a job");
      });
    });

    expect(lines()[0]).toMatchObject({
      requestId: "req-12345678",
      job: "gcal.sync",
      jobId: "job-1",
    });
  });

  it("never writes a guest email or an OAuth token, wherever it appears", () => {
    const { log, raw } = capture();

    log.info(`no booking for ${EMAIL}`);
    log.info({ guest: { email: EMAIL, name: "Ada" } }, "guest loaded");
    log.info({ note: `contact ${EMAIL}` }, "free text field");
    log.info(
      { tokens: { access_token: ACCESS_TOKEN, refresh_token: REFRESH_TOKEN } },
      "token refresh",
    );
    log.info(
      { url: `https://oauth2.googleapis.com/token?refresh_token=${REFRESH_TOKEN}` },
      "calling",
    );
    log.info({ header: `Bearer ${ACCESS_TOKEN}` }, "outgoing request");
    log.error({ err: new Error(`Google rejected ${ACCESS_TOKEN} for ${EMAIL}`) }, "sync failed");
    log.warn("%s signed in with %s", EMAIL, ACCESS_TOKEN);

    const output = raw.join("");
    expect(raw).toHaveLength(8);
    expect(output).not.toContain(EMAIL);
    expect(output).not.toContain(ACCESS_TOKEN);
    expect(output).not.toContain(REFRESH_TOKEN);
    expect(output).not.toContain("ya29.");
  });

  it("files an error passed first under `err`, as pino does", () => {
    const { log, lines } = capture();
    log.error(new Error(`bad guest ${EMAIL}`));
    log.error(new Error("second"), "with a message");

    const [bare, withMessage] = lines();
    expect(bare).toMatchObject({ msg: "bad guest [email]", err: { message: "bad guest [email]" } });
    expect(withMessage).toMatchObject({ msg: "with a message", err: { message: "second" } });
  });

  it("keeps an error's type, message and stack, scrubbed", () => {
    const { log, lines } = capture();
    log.error({ err: new TypeError(`bad guest ${EMAIL}`) }, "failed");

    const { err } = lines()[0];
    expect(err.type).toBe("TypeError");
    expect(err.message).toBe("bad guest [email]");
    expect(err.stack).toContain("logger.test.ts");
  });
});
