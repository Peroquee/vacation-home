/**
 * The main tasks walked as the owner and a guest would (GitLab #132),
 * counting what each takes: clicks (and taps), fields typed into, and pages
 * passed through. Each step is photographed into
 * docs/ux-review/screens/tasks/<task>/, with the counts in counts.json
 * there, so a later run shows whether a change made a task shorter. Runs after pages.spec.ts on the data of scripts/ux/seed.ts,
 * in German, at desktop width (the guest's tasks at phone width).
 *
 * The walks use what the screen shows: visible labels and button texts, the
 * way a person finds them, never test ids.
 */
import { rmSync, writeFileSync } from "node:fs";

import { expect, type Locator, type Page, test } from "@playwright/test";

import { createSession, E2E_USER, sessionCookie } from "../database";
import { addDays } from "../../src/lib/calendar-date";
import { receiptPhoto, scenePhoto } from "../../scripts/ux/images";
import { save, SCREENS, seeded } from "./shared";

type TaskResult = {
  task: string;
  clicks: number;
  fields: number;
  pages: number;
  steps: string[];
};

/** One task: counts what it takes and photographs each step. */
class Walk {
  clicks = 0;
  fields = 0;
  pages = new Set<string>();
  steps: string[] = [];

  constructor(
    readonly page: Page,
    readonly name: string,
  ) {
    // Pictures of an earlier, longer walk would linger beside this one's.
    rmSync(`${SCREENS}/tasks/${name}`, { recursive: true, force: true });
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) this.pages.add(new URL(frame.url()).pathname);
    });
  }

  async click(target: Locator): Promise<void> {
    await target.click();
    this.clicks++;
  }

  async fill(target: Locator, value: string): Promise<void> {
    await target.fill(value);
    this.fields++;
  }

  /** Picks from a select: open it, pick the option - two clicks, either kind. */
  async choose(trigger: Locator, option: string): Promise<void> {
    if ((await trigger.evaluate((el) => el.tagName)) === "SELECT") {
      await trigger.selectOption({ label: option });
      this.clicks += 2;
      return;
    }
    await this.click(trigger);
    await this.click(this.page.getByRole("option", { name: option, exact: true }));
  }

  /** Picks files in the chooser a button opens: the click, and the choice. */
  async upload(button: Locator, files: { name: string; buffer: Buffer }[]): Promise<void> {
    const chooser = this.page.waitForEvent("filechooser");
    await this.click(button);
    await (await chooser).setFiles(files.map((f) => ({ ...f, mimeType: "image/jpeg" })));
    this.clicks++;
  }

  async step(label: string): Promise<void> {
    await this.page.waitForLoadState("networkidle");
    const n = String(this.steps.length + 1).padStart(2, "0");
    this.steps.push(label);
    // UX_DEBUG=1: the page's structure too, for writing the next step.
    if (process.env.UX_DEBUG) {
      writeFileSync(
        `test-results/ux-${this.name}-${n}.aria.yml`,
        await this.page.locator("body").ariaSnapshot(),
      );
    }
    // A modal covers only the viewport: a full-page picture would show the
    // page below it undimmed.
    const modal = await this.page.getByRole("dialog").isVisible();
    await save(this.page, `tasks/${this.name}/${n}-${label}`, !modal);
  }

  /** The counts, next to the task's pictures. */
  done(): void {
    const result: TaskResult = {
      task: this.name,
      clicks: this.clicks,
      fields: this.fields,
      pages: this.pages.size,
      steps: this.steps,
    };
    writeFileSync(
      `${SCREENS}/tasks/${this.name}/counts.json`,
      `${JSON.stringify(result, null, 2)}\n`,
    );
  }
}

test.describe("owner", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(async ({ context, baseURL }) => {
    await context.addCookies([sessionCookie(await createSession(E2E_USER), baseURL!)]);
  });

  test("enter a booking by hand", async ({ page }) => {
    // An Airbnb booking the owner copies over, for a gap in the lake house.
    const s = seeded();
    const walk = new Walk(page, "booking-by-hand");
    await page.goto("/calendar");
    await walk.step("start");
    await walk.click(page.getByRole("link", { name: "Neue Buchung" }));
    await walk.step("form");
    await walk.choose(page.getByRole("combobox", { name: "Unterkunft" }), "Haus am See");
    await walk.click(page.getByRole("button", { name: "Neuer Gast" }));
    await walk.fill(page.getByRole("textbox", { name: "Name", exact: true }), "Greta Lindqvist");
    await walk.fill(page.getByRole("textbox", { name: "E-Mail" }), "greta@example.test");
    await walk.step("new-guest");
    await walk.click(page.getByRole("button", { name: "Gast anlegen" }));
    await walk.fill(page.getByRole("textbox", { name: "Anreise" }), addDays(s.today, 17));
    await walk.fill(page.getByRole("textbox", { name: "Abreise" }), addDays(s.today, 21));
    await walk.fill(page.getByRole("spinbutton", { name: "Gäste" }), "2");
    await walk.choose(page.getByRole("combobox", { name: "Status" }), "Bestätigt");
    await walk.choose(page.getByRole("combobox", { name: "Quelle" }), "Airbnb");
    await walk.step("filled");
    await walk.click(page.getByRole("button", { name: "Buchung anlegen" }));
    await page.waitForURL((url) => !url.pathname.endsWith("/new"));
    await walk.step("saved");
    walk.done();
  });

  test("answer a request and record the deposit", async ({ page }) => {
    const walk = new Walk(page, "request-to-deposit");
    await page.goto("/calendar");
    await walk.step("start");
    await walk.click(page.getByRole("link", { name: /^Buchungen/ }));
    await walk.step("bookings");
    await walk.click(page.getByRole("link", { name: /^Anfragen/ }));
    await walk.step("requests");
    // Miriam Schulte's request: two months ahead, so a deposit is due first.
    const request = page
      .getByRole("region", { name: /offene Anfragen/ })
      .getByRole("listitem")
      .filter({ hasText: "Miriam Schulte" });
    await walk.click(request.getByRole("button", { name: "Annehmen und reservieren" }));
    await expect(request).toHaveCount(0);
    await walk.step("accepted");
    await walk.click(page.getByRole("link", { name: "Miriam Schulte" }));
    await walk.step("booking");
    await walk.click(page.getByRole("button", { name: "Zahlung erfassen" }));
    await walk.step("payment-dialog");
    const dialog = page.getByRole("dialog", { name: "Zahlung erfassen" });
    // The dialog offers what is due; the deposit came in as asked.
    await walk.click(dialog.getByRole("button", { name: "Zahlung erfassen" }));
    await expect(dialog).toBeHidden();
    await walk.step("recorded");
    walk.done();
  });
  test("enter an expense with a receipt", async ({ page }) => {
    const walk = new Walk(page, "expense-with-receipt");
    await page.goto("/calendar");
    await walk.click(page.getByRole("link", { name: "Finanzen" }));
    await walk.step("finance");
    await walk.click(page.getByRole("button", { name: /^Erfassen/ }));
    const dialog = page.getByRole("dialog", { name: "Posten erfassen" });
    await walk.step("dialog");
    await walk.fill(dialog.getByRole("textbox", { name: "Betrag", exact: true }), "23,80");
    await walk.choose(dialog.getByRole("combobox", { name: "Kategorie" }), "Supplies");
    await walk.choose(dialog.getByRole("combobox", { name: "Unterkunft" }), "Haus am See");
    await walk.fill(
      dialog.getByRole("textbox", { name: "Beschreibung" }),
      "Grillkohle und Anzünder",
    );
    const receipt = await receiptPhoto("Getränke Ole", [
      ["Grillkohle 5 kg", "15,90"],
      ["Anzünder", "7,90"],
      ["Summe EUR", "23,80"],
    ]);
    await walk.upload(dialog.locator("button", { hasText: "Belege hinzufügen" }), [
      { name: "Kassenbon.jpg", buffer: receipt },
    ]);
    await walk.step("filled");
    await walk.click(dialog.getByRole("button", { name: "Erfassen" }));
    await expect(dialog).toBeHidden();
    await walk.step("saved");
    walk.done();
  });

  test("set up a recurring cost", async ({ page }) => {
    const walk = new Walk(page, "recurring-cost");
    await page.goto("/calendar");
    await walk.click(page.getByRole("link", { name: "Finanzen" }));
    await walk.step("finance");
    await walk.click(page.getByRole("link", { name: "Wiederkehrende Kosten" }));
    await walk.step("recurring");
    await walk.click(page.getByRole("button", { name: "Wiederkehrende Kosten hinzufügen" }));
    const dialog = page.getByRole("dialog", { name: "Wiederkehrende Kosten hinzufügen" });
    await walk.choose(dialog.getByRole("combobox", { name: "Unterkunft" }), "Haus am See");
    await walk.choose(dialog.getByRole("combobox", { name: "Kategorie" }), "Utilities");
    await walk.fill(dialog.getByRole("textbox", { name: "Betrag", exact: true }), "38,50");
    await walk.choose(dialog.getByRole("combobox", { name: "Alle" }), "Vierteljährlich");
    await walk.fill(dialog.getByRole("textbox", { name: "Beschreibung" }), "Müllabfuhr");
    await walk.step("filled");
    await walk.click(dialog.getByRole("button", { name: /^(Hinzufügen|Speichern)$/ }).last());
    await expect(dialog).toBeHidden();
    await walk.step("saved");
    walk.done();
  });

  test("set seasonal prices and a discount", async ({ page }) => {
    const walk = new Walk(page, "season-and-discount");
    await page.goto("/calendar");
    await walk.click(page.getByRole("link", { name: "Einstellungen" }));
    await walk.step("settings");
    await walk.click(
      page
        .getByRole("row")
        .filter({ hasText: "Haus am See" })
        .getByRole("link", { name: "Preise" }),
    );
    await walk.step("pricing");
    await walk.click(page.getByRole("button", { name: "Saison hinzufügen" }));
    const season = page.getByRole("dialog", { name: "Neue Saison" });
    await walk.fill(season.getByRole("textbox", { name: "Name", exact: true }), "Herbstferien");
    await walk.fill(season.getByRole("textbox", { name: "Erster Tag: Tag" }), "10");
    await walk.choose(season.getByRole("combobox", { name: "Erster Tag: Monat" }), "Oktober");
    await walk.fill(season.getByRole("textbox", { name: "Letzter Tag: Tag" }), "25");
    await walk.choose(season.getByRole("combobox", { name: "Letzter Tag: Monat" }), "Oktober");
    await walk.fill(season.getByRole("textbox", { name: "Preis pro Nacht (EUR)" }), "145");
    await walk.step("season-filled");
    await walk.click(season.getByRole("button", { name: /^(Hinzufügen|Speichern)$/ }).last());
    await expect(season).toBeHidden();
    await walk.step("season-saved");
    await walk.click(page.getByRole("button", { name: "Rabatte bearbeiten" }));
    const discounts = page.getByRole("dialog", { name: "Rabatte für längere Aufenthalte" });
    await walk.click(discounts.getByRole("button", { name: "Stufe hinzufügen" }));
    await walk.fill(discounts.getByRole("textbox", { name: "Stufe 2: Nächte" }), "14");
    await walk.fill(discounts.getByRole("textbox", { name: "Stufe 2: Prozent" }), "15");
    await walk.step("discount-filled");
    await walk.click(discounts.getByRole("button", { name: "Speichern" }));
    await expect(discounts).toBeHidden();
    await walk.step("discount-saved");
    walk.done();
  });

  test("check the month on the dashboard", async ({ page }) => {
    const walk = new Walk(page, "month-on-dashboard");
    await page.goto("/calendar");
    await walk.click(page.getByRole("link", { name: "Übersicht" }));
    await walk.step("dashboard");
    await walk.click(page.getByRole("radio", { name: "Letzter Monat" }));
    await walk.step("last-month");
    walk.done();
  });

  test("publish a property", async ({ page }) => {
    const walk = new Walk(page, "publish-property");
    await page.goto("/calendar");
    await walk.click(page.getByRole("link", { name: "Einstellungen" }));
    await walk.step("settings");
    await walk.click(page.getByRole("button", { name: "Unterkunft hinzufügen" }).first());
    const dialog = page.getByRole("dialog", { name: "Unterkunft hinzufügen" });
    await walk.fill(
      dialog.getByRole("textbox", { name: "Name", exact: true }),
      "Ferienwohnung Ostsee",
    );
    await walk.fill(
      dialog.getByRole("textbox", { name: "Adresse", exact: true }),
      "Strandallee 21, 23683 Scharbeutz",
    );
    await walk.fill(dialog.getByRole("textbox", { name: "Preis pro Nacht" }), "95");
    await walk.fill(dialog.getByRole("textbox", { name: "Reinigungsgebühr" }), "55");
    await walk.fill(dialog.getByRole("textbox", { name: "Webadresse" }), "ostsee");
    await walk.step("new-property");
    await walk.click(dialog.getByRole("button", { name: "Unterkunft hinzufügen" }));
    await expect(dialog).toBeHidden();
    await walk.step("created");
    await walk.click(
      page
        .getByRole("row")
        .filter({ hasText: "Ferienwohnung Ostsee" })
        .getByRole("link", { name: "Inserat" }),
    );
    await walk.step("listing");
    await walk.upload(page.locator("button", { hasText: "Fotos hinzufügen" }), [
      { name: "aussen.jpg", buffer: await scenePhoto("terrace") },
      { name: "wohnen.jpg", buffer: await scenePhoto("living") },
    ]);
    await expect(page.getByRole("button", { name: /^Lade/ })).toHaveCount(0);
    await walk.fill(page.getByRole("textbox", { name: "Ort" }), "Scharbeutz, Ostsee");
    await walk.fill(
      page
        .getByRole("spinbutton", { name: "Höchstzahl Gäste" })
        .or(page.getByRole("textbox", { name: "Höchstzahl Gäste" })),
      "3",
    );
    const german = page.getByRole("group", { name: "Deutsch" });
    await walk.fill(german.getByRole("textbox", { name: "Titel" }), "Ferienwohnung am Strand");
    await walk.fill(
      german.getByRole("textbox", { name: "Beschreibung" }),
      "Zwei Minuten zum Strand, Balkon mit Blick auf die Ostsee.",
    );
    await walk.step("listing-filled");
    await walk.click(page.getByRole("button", { name: "Speichern" }).first());
    await walk.step("listing-saved");
    // Back to the settings, to switch the public page on.
    await walk.click(page.getByRole("link", { name: "Zurück zu den Einstellungen" }));
    await walk.click(
      page
        .getByRole("row")
        .filter({ hasText: "Ferienwohnung Ostsee" })
        .getByRole("button", { name: "Bearbeiten" }),
    );
    const edit = page.getByRole("dialog");
    await walk.click(
      edit.getByRole("checkbox", { name: "Auf der öffentlichen Buchungsseite zeigen" }),
    );
    await walk.step("publish");
    await walk.click(edit.getByRole("button", { name: /^(Speichern|Änderungen speichern)$/ }));
    await expect(edit).toBeHidden();
    await walk.step("published");
    walk.done();
  });
});

/** How the public calendar names a day, e.g. "Montag, 14. Dezember 2026". */
const GERMAN_DATE = new Intl.DateTimeFormat("de-DE", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

test.describe("guest", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("find dates, see the price and send a request", async ({ page }) => {
    const walk = new Walk(page, "guest-request");
    await page.goto("/stay");
    await walk.step("start");
    await walk.click(page.getByRole("link", { name: /Haus am See/ }).first());
    await page.waitForURL("**/stay/haus-am-see");
    await walk.step("property");
    // Four nights, seven weeks ahead: page to the month, tap both days.
    const checkIn = addDays(seeded().today, 50);
    const calendar = page.getByRole("region", { name: "Freie Termine" });
    const day = (date: string) =>
      calendar.getByRole("button", { name: GERMAN_DATE.format(new Date(`${date}T12:00:00Z`)) });
    while (!(await day(checkIn).isVisible())) {
      await walk.click(calendar.getByRole("button", { name: "Nächster Monat" }));
    }
    await walk.click(day(checkIn));
    await walk.step("arrival");
    await walk.click(day(addDays(checkIn, 4)));
    await walk.step("departure");
    await walk.click(page.getByRole("button", { name: "Diese Daten anfragen" }));
    await expect(page.getByRole("textbox", { name: /Name/ })).toBeVisible();
    await walk.step("form");
    const form = page.getByRole("form", { name: "Ihre Anfrage" });
    await walk.fill(form.getByRole("textbox", { name: "Name" }), "Ida Brenner");
    await walk.fill(form.getByRole("textbox", { name: "E-Mail" }), "ida.brenner@example.test");
    await walk.fill(form.getByRole("spinbutton", { name: "Gäste" }), "2");
    await walk.fill(
      form.getByRole("textbox", { name: "Nachricht an den Gastgeber" }),
      "Wir freuen uns auf ruhige Tage am See!",
    );
    await walk.click(form.getByRole("checkbox"));
    await walk.step("form-filled");
    await walk.click(form.getByRole("button", { name: "Anfrage senden" }));
    await expect(form).toBeHidden({ timeout: 30_000 });
    await walk.step("sent");
    walk.done();
  });

  test("use the guest page", async ({ page }) => {
    // The link from the reservation email, for a booking with the deposit in.
    const walk = new Walk(page, "guest-page");
    await page.goto(seeded().guestPath);
    await walk.step("open");
    await walk.click(page.getByText("Wie bezahle ich?"));
    await walk.step("how-to-pay");
    await page.getByText(/^Bitte zahlen Sie/).scrollIntoViewIfNeeded();
    await walk.step("payment-details");
    walk.done();
  });
});
