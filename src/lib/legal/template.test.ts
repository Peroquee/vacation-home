import { describe, expect, it } from "vitest";

import { TEMPLATE_MARKER } from "./legal";
import { emailProviderOf, privacyTemplate, type TemplateFacts } from "./template";

const FACTS: TemplateFacts = {
  imprint: {
    imprintName: "Ada Owner",
    imprintAddress: "Seestraße 1\n12345 Seedorf",
    imprintEmail: "owner@example.test",
    imprintPhone: null,
  },
  retentionMonths: 6,
  googleCalendar: true,
  cloudflare: true,
  emailProvider: "brevo",
};

describe("the privacy policy template", () => {
  for (const locale of ["de-DE", "en-GB"] as const) {
    describe(locale, () => {
      const text = privacyTemplate(locale, FACTS);

      it("opens with the note that it is a template, not legal advice", () => {
        expect(text.startsWith(`${TEMPLATE_MARKER}\n> **`)).toBe(true);
        expect(text).toMatch(locale === "de-DE" ? /keine Rechtsberatung/ : /not legal advice/);
      });

      it("names the owner as controller, and as the contact for the guest's rights", () => {
        expect(text).toContain("Ada Owner  \nSeestraße 1  \n12345 Seedorf  \nowner@example.test");
        expect(text).toMatch(/owner@example\.test\.\n$/);
      });

      it("covers what the app does with guests' data", () => {
        for (const fact of [
          /Art\. 6( Abs\. 1 lit\. b|\(1\)\(b\))/,
          /ALTCHA/,
          /IP/,
          /§ 147/,
          /\/stay\/legal\/cookies/,
          /Art\. 15/,
          /Art\. 21/,
          /Google/,
          /Cloudflare, Inc\./,
          /Data Privacy Framework/,
          /Brevo/,
          locale === "de-DE" ? /nach 6 Monaten anonymisiert/ : /anonymised after 6 months/,
          locale === "de-DE" ? /Kartendaten/ : /card details/,
          locale === "de-DE" ? /Aufsichtsbehörde/ : /supervisory authority/,
        ]) {
          expect(text).toMatch(fact);
        }
      });

      it("numbers its sections in order", () => {
        const numbers = [...text.matchAll(/^## (\d+)\./gm)].map((m) => Number(m[1]));
        expect(numbers).toEqual(numbers.map((_, i) => i + 1));
      });
    });
  }

  it("follows the retention setting and leaves Google out when not synced", () => {
    const text = privacyTemplate("en-GB", {
      ...FACTS,
      retentionMonths: 3,
      googleCalendar: false,
      cloudflare: false,
      emailProvider: null,
    });
    expect(text).toContain("anonymised after 3 months");
    expect(text).not.toMatch(/Google|Cloudflare|Brevo|processor/);
    const numbers = [...text.matchAll(/^## (\d+)\./gm)].map((m) => Number(m[1]));
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it("names an email provider other than Brevo only as a placeholder", () => {
    const text = privacyTemplate("en-GB", { ...FACTS, emailProvider: "other" });
    expect(text).toContain("[email provider, address]");
    expect(text).not.toContain("Brevo");
  });

  it("tells Brevo apart from other SMTP hosts, and no host from either", () => {
    expect(emailProviderOf("smtp-relay.brevo.com")).toBe("brevo");
    expect(emailProviderOf("smtp-relay.sendinblue.com")).toBe("brevo");
    expect(emailProviderOf("brevo.com.evil.test")).toBe("other");
    expect(emailProviderOf("smtp.example.com")).toBe("other");
    expect(emailProviderOf(undefined)).toBeNull();
  });

  it("leaves placeholders where the owner has not filled in the imprint", () => {
    const empty = {
      imprintName: null,
      imprintAddress: null,
      imprintEmail: null,
      imprintPhone: null,
    };
    const text = privacyTemplate("de-DE", { ...FACTS, imprint: empty });
    expect(text).toContain("[Name, Anschrift, E-Mail]");
    expect(text).toContain("an [E-Mail-Adresse].");
  });
});
