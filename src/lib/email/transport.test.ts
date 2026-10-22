import { describe, expect, it, vi } from "vitest";

const createTransport = vi.fn((_options: Record<string, unknown>) => ({ sendMail: vi.fn() }));
vi.mock("nodemailer", () => ({ default: { createTransport } }));

const { mailTransport, SEND_TIMEOUT_MS } = await import("./transport");

describe("the SMTP transport", () => {
  // GitLab #134: without them a hanging server holds a send for minutes.
  it("gives up on a server that doesn't answer, well within an email's claim", () => {
    mailTransport();
    const options = createTransport.mock.calls[0]![0];
    expect(options).toMatchObject({
      connectionTimeout: expect.any(Number),
      greetingTimeout: expect.any(Number),
      socketTimeout: expect.any(Number),
    });
    const total =
      (options.connectionTimeout as number) +
      (options.greetingTimeout as number) +
      (options.socketTimeout as number);
    expect(total).toBeLessThanOrEqual(SEND_TIMEOUT_MS);
  });
});
