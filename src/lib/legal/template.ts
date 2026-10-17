/**
 * The privacy policy's starting point (GitLab #112), from what the app
 * really does: the request form, payments by bank transfer, the automatic
 * emails, the self-hosted spam protection, the logs, the calendar sync and
 * the retention periods. Placeholders in [brackets] are for the owner to
 * fill in. A template, not legal advice: it opens with a note saying so,
 * which the settings checklist warns about until it is removed.
 * Client-safe.
 */
import { type Legal, TEMPLATE_MARKER } from "./legal";

export type TemplateFacts = {
  imprint: Pick<Legal, "imprintName" | "imprintAddress" | "imprintEmail" | "imprintPhone">;
  /** Months after which declined and expired requests are anonymised. */
  retentionMonths: number;
  /** Whether bookings are synced to a Google Calendar. */
  googleCalendar: boolean;
};

const controller = (imprint: TemplateFacts["imprint"], placeholder: string) =>
  [
    imprint.imprintName ?? placeholder,
    ...(imprint.imprintAddress ?? "").split("\n").filter(Boolean),
    imprint.imprintEmail,
    imprint.imprintPhone,
  ]
    .filter(Boolean)
    // Markdown line breaks: two spaces at the end of a line.
    .join("  \n");

export function privacyTemplate(locale: "de-DE" | "en-GB", facts: TemplateFacts): string {
  return (locale === "de-DE" ? german : english)(facts).trim() + "\n";
}

function german({ imprint, retentionMonths, googleCalendar }: TemplateFacts): string {
  const contact = imprint.imprintEmail ?? "[E-Mail-Adresse]";
  return `${TEMPLATE_MARKER}
> **Vorlage, keine Rechtsberatung.** Dieser Text beschreibt, was die Buchungsseite tut, ersetzt aber keine rechtliche Prüfung. Lassen Sie ihn prüfen, ergänzen Sie die Angaben in [eckigen Klammern] und löschen Sie danach diesen Hinweis samt der Zeile darüber.

## 1. Verantwortlicher

${controller(imprint, "[Name, Anschrift, E-Mail]")}

## 2. Buchungsanfragen

Wenn Sie eine Anfrage senden, verarbeiten wir Ihren Namen, Ihre E-Mail-Adresse, Ihre Telefonnummer (falls angegeben), den Reisezeitraum, die Zahl der Gäste, Ihre Nachricht, die Sprache der Seite und den Zeitpunkt, zu dem Sie diesen Hinweisen zugestimmt haben. Wir brauchen diese Angaben, um Ihre Anfrage zu beantworten und die Buchung durchzuführen (Art. 6 Abs. 1 lit. b DSGVO: vorvertragliche Maßnahmen und Vertragserfüllung).

## 3. Zahlungen

Sie bezahlen per Überweisung. Wir speichern die fälligen und eingegangenen Beträge und die Zahlungstermine; auf Ihrer Buchungsseite und in unseren E-Mails sehen Sie unsere Bankverbindung. Kartendaten oder Ihre Bankverbindung erheben wir nicht; Ihre Bank verarbeitet die Überweisung in eigener Verantwortung. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b und c DSGVO.

## 4. E-Mails

Wir senden Ihnen automatische E-Mails zu Ihrer Buchung: den Eingang der Anfrage, eine Absage oder Reservierung, Zahlungserinnerungen, eingegangene Zahlungen, die Bestätigung mit der Anschrift der Unterkunft und gegebenenfalls eine Stornierung. Sie werden über [E-Mail-Anbieter] versendet. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO.

## 5. Die Unterkunft auf dieser Seite

Fotos, Beschreibung und Belegungskalender der Unterkunft enthalten keine Daten über Gäste. Der Kalender zeigt nur, ob ein Tag frei ist.

## 6. Schutz vor Spam und Missbrauch

Das Anfrageformular schützt eine Rechenaufgabe, die Ihr Browser löst (ALTCHA). Sie läuft auf unserem eigenen Server, ohne Dienste Dritter und ohne Cookies. Um Missbrauch zu begrenzen, zählt der Server Anfragen je IP-Adresse; die Adressen werden dafür nur kurz im Arbeitsspeicher gehalten und nicht gespeichert. Rechtsgrundlage ist unser berechtigtes Interesse an einem sicheren Betrieb (Art. 6 Abs. 1 lit. f DSGVO).

## 7. Server-Protokolle

Beim Aufruf der Seite verarbeitet der Server technisch notwendige Daten (aufgerufene Adresse, Zeitpunkt, Browser-Kennung und [beim vorgeschalteten Webserver] Ihre IP-Adresse). Die Protokolle der Anwendung enthalten keine Namen oder E-Mail-Adressen. Protokolle werden nach [Zeitraum] gelöscht. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO.

## 8. Hosting

Die Seite läuft auf unserem eigenen Server [Standort]. Ihre Daten werden nicht an Hosting-Anbieter weitergegeben.
${
  googleCalendar
    ? `
## 9. Kalender

Wir gleichen Buchungen mit unserem Google-Kalender ab (Google Ireland Limited). Dabei werden nur Zeitraum, Zahl der Gäste, Betrag und eine Buchungsnummer übertragen, keine Namen, E-Mail-Adressen, Telefonnummern oder Nachrichten. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO.
`
    : ""
}
## ${googleCalendar ? 10 : 9}. Speicherdauer

- Abgelehnte und abgelaufene Anfragen werden nach ${retentionMonths} Monaten anonymisiert.
- Buchungen und Zahlungen sind Buchhaltungsunterlagen und werden acht Jahre aufbewahrt (§ 147 AO); danach werden sie gelöscht.
- Datensicherungen werden nach ihrer Aufbewahrungszeit [von etwa sechs Monaten] überschrieben; bis dahin können gelöschte Daten noch in ihnen enthalten sein.

## ${googleCalendar ? 11 : 10}. Ihre Rechte

Sie haben das Recht auf Auskunft (Art. 15 DSGVO), Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung der Verarbeitung (Art. 18), Datenübertragbarkeit (Art. 20) und Widerspruch gegen eine Verarbeitung auf Grundlage berechtigter Interessen (Art. 21). Sie können sich außerdem bei einer Datenschutz-Aufsichtsbehörde beschweren, etwa bei [der Behörde Ihres Bundeslandes].

Schreiben Sie uns dazu an ${contact}.
`;
}

function english({ imprint, retentionMonths, googleCalendar }: TemplateFacts): string {
  const contact = imprint.imprintEmail ?? "[email address]";
  return `${TEMPLATE_MARKER}
> **Template, not legal advice.** This text describes what the booking site does, but it is no substitute for a legal review. Have it checked, fill in the details in [square brackets], and then delete this note together with the line above it.

## 1. Controller

${controller(imprint, "[name, address, email]")}

## 2. Booking requests

When you send a request, we process your name, your email address, your phone number (if given), the dates of your stay, the number of guests, your message, the language of the page and the time you agreed to this policy. We need these details to answer your request and to carry out the booking (Art. 6(1)(b) GDPR: steps prior to and performance of a contract).

## 3. Payments

You pay by bank transfer. We keep the amounts due and received and their dates; your booking page and our emails show our bank details. We do not collect card details or your bank details; your bank processes the transfer under its own responsibility. The legal basis is Art. 6(1)(b) and (c) GDPR.

## 4. Emails

We send you automatic emails about your booking: that your request arrived, a decline or the reservation, payment reminders, payments received, the confirmation with the address of the home and, if it comes to it, a cancellation. They are sent through [email provider]. The legal basis is Art. 6(1)(b) GDPR.

## 5. The home on this site

The photos, description and availability calendar of the home contain no data about guests. The calendar only shows whether a day is free.

## 6. Protection against spam and abuse

The request form is protected by a small puzzle your browser solves (ALTCHA). It runs on our own server, without third parties and without cookies. To limit abuse, the server counts requests per IP address; the addresses are only held briefly in memory for this and are not stored. The legal basis is our legitimate interest in running the site securely (Art. 6(1)(f) GDPR).

## 7. Server logs

When you open the site, the server processes technically necessary data (the address requested, the time, your browser's identifier and, [at the web server in front], your IP address). The application's logs contain no names or email addresses. Logs are deleted after [period]. The legal basis is Art. 6(1)(f) GDPR.

## 8. Hosting

The site runs on our own server [location]. Your data is not passed to a hosting provider.
${
  googleCalendar
    ? `
## 9. Calendar

We keep bookings in step with our Google Calendar (Google Ireland Limited). Only the dates, the number of guests, the amount and a booking number are sent, no names, email addresses, phone numbers or messages. The legal basis is Art. 6(1)(f) GDPR.
`
    : ""
}
## ${googleCalendar ? 10 : 9}. How long data is kept

- Declined and expired requests are anonymised after ${retentionMonths} months.
- Bookings and payments are accounting records and are kept for eight years (§ 147 of the German Fiscal Code, AO); they are deleted afterwards.
- Backups are overwritten after their retention period [of about six months]; until then, deleted data may still be in them.

## ${googleCalendar ? 11 : 10}. Your rights

You have the right of access (Art. 15 GDPR), rectification (Art. 16), erasure (Art. 17), restriction of processing (Art. 18), data portability (Art. 20) and to object to processing based on legitimate interests (Art. 21). You can also complain to a data protection supervisory authority, for example [the authority of your federal state].

To exercise them, write to us at ${contact}.
`;
}
