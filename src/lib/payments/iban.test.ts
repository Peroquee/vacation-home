import { describe, expect, it } from "vitest";

import { formatIban, isValidBic, isValidIban, normaliseIban } from "./iban";

describe("an IBAN", () => {
  it("is accepted with a valid checksum, in any spacing and case", () => {
    expect(isValidIban(normaliseIban("de89 3704 0044 0532 0130 00"))).toBe(true);
    expect(isValidIban("GB82WEST12345698765432")).toBe(true);
    expect(isValidIban("AT611904300234573201")).toBe(true);
  });

  it("is refused with a wrong checksum, length or shape", () => {
    expect(isValidIban("DE89370400440532013001")).toBe(false);
    expect(isValidIban("DE8937040044053201300")).toBe(false);
    expect(isValidIban("DE89-3704")).toBe(false);
    expect(isValidIban("")).toBe(false);
  });

  it("is shown in groups of four", () => {
    expect(formatIban("DE89370400440532013000")).toBe("DE89 3704 0044 0532 0130 00");
  });
});

describe("a BIC", () => {
  it("has 8 or 11 characters", () => {
    expect(isValidBic("COBADEFF")).toBe(true);
    expect(isValidBic("COBADEFFXXX")).toBe(true);
    expect(isValidBic("COBADE")).toBe(false);
    expect(isValidBic("COBADEFFX")).toBe(false);
  });
});
