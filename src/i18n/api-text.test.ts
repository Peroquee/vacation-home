import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";

import de from "../../messages/de-DE.json";

import { apiFields, apiText, type ApiTranslate } from "./api-text";

const t = createTranslator({ locale: "de-DE", messages: de, namespace: "api" }) as ApiTranslate;

describe("apiText", () => {
  it("translates a known phrase", () => {
    expect(apiText("is required", t)).toBe("ist erforderlich");
    expect(apiText("Booking not found.", t)).toBe("Buchung nicht gefunden.");
  });

  it("carries values through placeholders", () => {
    expect(apiText("must be at most 200 characters", t)).toBe(
      "darf höchstens 200 Zeichen lang sein",
    );
  });

  it("leaves unknown text as it came", () => {
    expect(apiText("Something new went wrong.", t)).toBe("Something new went wrong.");
  });

  it("translates every field message", () => {
    expect(apiFields({ name: ["is required"], color: undefined }, t)).toEqual({
      name: ["ist erforderlich"],
      color: undefined,
    });
  });
});
