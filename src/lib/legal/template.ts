/**
 * The privacy policy's starting point (GitLab #112), from what the app
 * really does: the request form, payments by bank transfer, the automatic
 * emails, the self-hosted spam protection, the logs, the calendar sync and
 * the retention periods - and the services it runs through, when it does:
 * Cloudflare in front of it (GitLab #113) and the email provider.
 * Placeholders in [brackets] are for the owner to fill in. A template, not
 * legal advice: it opens with a note saying so, which the settings
 * checklist warns about until it is removed. Sections are numbered in
 * order, whichever are included. Client-safe.
 */
import { type Legal, TEMPLATE_MARKER } from "./legal";

export type TemplateFacts = {
  imprint: Pick<Legal, "imprintName" | "imprintAddress" | "imprintEmail" | "imprintPhone">;
  /** Months after which declined and expired requests are anonymised. */
  retentionMonths: number;
  /** Whether bookings are synced to a Google Calendar. */
  googleCalendar: boolean;
  /** Whether requests reach the app through Cloudflare (a Cloudflare Tunnel). */
  cloudflare: boolean;
  /** Who sends the emails: null while no SMTP server is set up. */
  emailProvider: "brevo" | "other" | null;
};

/** The provider behind an SMTP host name, as far as the template names one. */
export function emailProviderOf(smtpHost: string | undefined): TemplateFacts["emailProvider"] {
  if (!smtpHost) return null;
  return /(^|\.)(brevo|sendinblue)\.com$/i.test(smtpHost.trim()) ? "brevo" : "other";
}

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

type Section = { title: string; body: string } | false;

const numbered = (note: string, sections: Section[]) =>
  [
    `${TEMPLATE_MARKER}\n${note}`,
    ...sections
      .filter((section): section is { title: string; body: string } => section !== false)
      .map(({ title, body }, i) => `## ${i + 1}. ${title}\n\n${body.trim()}`),
  ].join("\n\n");

export function privacyTemplate(locale: "de-DE" | "en-GB", facts: TemplateFacts): string {
  return (locale === "de-DE" ? german : english)(facts).trim() + "\n";
}

function german(facts: TemplateFacts): string {
  const { imprint, retentionMonths, googleCalendar, cloudflare, emailProvider } = facts;
  const contact = imprint.imprintEmail ?? "[E-Mail-Adresse]";
  return numbered(
    "> **Vorlage, keine Rechtsberatung.** Dieser Text beschreibt, was die Buchungsseite tut, ersetzt aber keine rechtliche Prüfung. Lassen Sie ihn prüfen, ergänzen Sie die Angaben in [eckigen Klammern] und löschen Sie danach diesen Hinweis samt der Zeile darüber.",
    [
      { title: "Verantwortlicher", body: controller(imprint, "[Name, Anschrift, E-Mail]") },
      {
        title: "Buchungsanfragen",
        body: "Wenn Sie eine Anfrage senden, verarbeiten wir Ihren Namen, Ihre E-Mail-Adresse, Ihre Telefonnummer (falls angegeben), den Reisezeitraum, die Zahl der Gäste, Ihre Nachricht, die Sprache der Seite und den Zeitpunkt, zu dem Sie diesen Hinweisen zugestimmt haben. Wir brauchen diese Angaben, um Ihre Anfrage zu beantworten und die Buchung durchzuführen (Art. 6 Abs. 1 lit. b DSGVO: vorvertragliche Maßnahmen und Vertragserfüllung).",
      },
      {
        title: "Zahlungen",
        body: "Sie bezahlen per Überweisung. Wir speichern die fälligen und eingegangenen Beträge und die Zahlungstermine; auf Ihrer Buchungsseite und in unseren E-Mails sehen Sie unsere Bankverbindung. Kartendaten oder Ihre Bankverbindung erheben wir nicht; Ihre Bank verarbeitet die Überweisung in eigener Verantwortung. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b und c DSGVO.",
      },
      {
        title: "E-Mails",
        body: `Wir senden Ihnen automatische E-Mails zu Ihrer Buchung: den Eingang der Anfrage, eine Absage oder Reservierung, Zahlungserinnerungen, eingegangene Zahlungen, die Bestätigung mit der Anschrift der Unterkunft und gegebenenfalls eine Stornierung. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO.${
          emailProvider === "brevo"
            ? "\n\nDie E-Mails versendet für uns Brevo (Sendinblue SAS, 106 boulevard Haussmann, 75008 Paris, Frankreich) als Auftragsverarbeiter (Art. 28 DSGVO). Brevo erhält dafür Ihre E-Mail-Adresse, Ihren Namen und den Inhalt der E-Mail und speichert Versandprotokolle [für die Dauer laut Vertrag]. Die Daten werden in der EU verarbeitet."
            : emailProvider === "other"
              ? "\n\nDie E-Mails versendet für uns [E-Mail-Anbieter, Anschrift] als Auftragsverarbeiter (Art. 28 DSGVO). Er erhält dafür Ihre E-Mail-Adresse, Ihren Namen und den Inhalt der E-Mail."
              : ""
        }`,
      },
      {
        title: "Die Unterkunft auf dieser Seite",
        body: "Fotos, Beschreibung und Belegungskalender der Unterkunft enthalten keine Daten über Gäste. Der Kalender zeigt nur, ob ein Tag frei ist.",
      },
      {
        title: "Schutz vor Spam und Missbrauch",
        body: "Das Anfrageformular schützt eine Rechenaufgabe, die Ihr Browser löst (ALTCHA). Sie läuft auf unserem eigenen Server, ohne Dienste Dritter und ohne Cookies. Um Missbrauch zu begrenzen, zählt der Server Anfragen je IP-Adresse; die Adressen werden dafür nur kurz im Arbeitsspeicher gehalten und nicht gespeichert. Rechtsgrundlage ist unser berechtigtes Interesse an einem sicheren Betrieb (Art. 6 Abs. 1 lit. f DSGVO).",
      },
      {
        title: "Cookies",
        body: "Gäste bekommen von dieser Seite keine Cookies. Nur die Anmeldung der Gastgeber und deren eigene Seiten nutzen einige Cookies, die dafür unbedingt erforderlich sind (§ 25 Abs. 2 Nr. 2 TTDSG); es gibt kein Tracking und keine Cookies von Dritten. Welche Cookies das sind und wie lange sie gespeichert werden, steht im [Cookie-Hinweis](/stay/legal/cookies).",
      },
      {
        title: "Server-Protokolle",
        body: `Beim Aufruf der Seite verarbeitet der Server technisch notwendige Daten (aufgerufene Adresse, Zeitpunkt, Browser-Kennung und ${cloudflare ? "Ihre IP-Adresse, die Cloudflare weitergibt" : "[beim vorgeschalteten Webserver] Ihre IP-Adresse"}). Die Protokolle der Anwendung enthalten keine Namen oder E-Mail-Adressen. Protokolle werden nach [Zeitraum] gelöscht. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO.`,
      },
      {
        title: "Hosting",
        body: `Die Seite läuft auf unserem eigenen Server [Standort]. ${cloudflare ? "Ihre Daten werden dort gespeichert, nicht bei einem Hosting-Anbieter; die Verbindung dorthin läuft über Cloudflare (siehe unten)." : "Ihre Daten werden nicht an Hosting-Anbieter weitergegeben."}`,
      },
      cloudflare && {
        title: "Cloudflare",
        body: "Alle Aufrufe dieser Seite laufen über Cloudflare (Cloudflare, Inc., 101 Townsend St., San Francisco, CA 94107, USA): Cloudflare stellt die verschlüsselte Verbindung her, schützt vor Angriffen und leitet die Anfragen über eine Verbindung (Tunnel) an unseren Server weiter. Dabei verarbeitet Cloudflare Ihre IP-Adresse, die aufgerufenen Adressen, Browser-Angaben und die übermittelten Inhalte, als Auftragsverarbeiter (Art. 28 DSGVO). Cloudflare kann Daten in den USA verarbeiten; das Unternehmen ist nach dem EU-US Data Privacy Framework zertifiziert (Angemessenheitsbeschluss der EU-Kommission, Art. 45 DSGVO). Rechtsgrundlage ist unser berechtigtes Interesse an einer sicheren, erreichbaren Seite ohne eigene öffentliche IP-Adresse (Art. 6 Abs. 1 lit. f DSGVO).",
      },
      googleCalendar && {
        title: "Kalender",
        body: "Wir gleichen Buchungen mit unserem Google-Kalender ab (Google Ireland Limited). Dabei werden nur Zeitraum, Zahl der Gäste, Betrag und eine Buchungsnummer übertragen, keine Namen, E-Mail-Adressen, Telefonnummern oder Nachrichten. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO.",
      },
      {
        title: "Speicherdauer",
        body: `- Abgelehnte und abgelaufene Anfragen werden nach ${retentionMonths} Monaten anonymisiert.
- Buchungen und Zahlungen sind Buchhaltungsunterlagen und werden acht Jahre aufbewahrt (§ 147 AO); danach werden sie gelöscht.
- Datensicherungen werden nach ihrer Aufbewahrungszeit [von etwa sechs Monaten] überschrieben; bis dahin können gelöschte Daten noch in ihnen enthalten sein.`,
      },
      {
        title: "Ihre Rechte",
        body: `Sie haben das Recht auf Auskunft (Art. 15 DSGVO), Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung der Verarbeitung (Art. 18), Datenübertragbarkeit (Art. 20) und Widerspruch gegen eine Verarbeitung auf Grundlage berechtigter Interessen (Art. 21). Sie können sich außerdem bei einer Datenschutz-Aufsichtsbehörde beschweren, etwa bei [der Behörde Ihres Bundeslandes].

Schreiben Sie uns dazu an ${contact}.`,
      },
    ],
  );
}

function english(facts: TemplateFacts): string {
  const { imprint, retentionMonths, googleCalendar, cloudflare, emailProvider } = facts;
  const contact = imprint.imprintEmail ?? "[email address]";
  return numbered(
    "> **Template, not legal advice.** This text describes what the booking site does, but it is no substitute for a legal review. Have it checked, fill in the details in [square brackets], and then delete this note together with the line above it.",
    [
      { title: "Controller", body: controller(imprint, "[name, address, email]") },
      {
        title: "Booking requests",
        body: "When you send a request, we process your name, your email address, your phone number (if given), the dates of your stay, the number of guests, your message, the language of the page and the time you agreed to this policy. We need these details to answer your request and to carry out the booking (Art. 6(1)(b) GDPR: steps prior to and performance of a contract).",
      },
      {
        title: "Payments",
        body: "You pay by bank transfer. We keep the amounts due and received and their dates; your booking page and our emails show our bank details. We do not collect card details or your bank details; your bank processes the transfer under its own responsibility. The legal basis is Art. 6(1)(b) and (c) GDPR.",
      },
      {
        title: "Emails",
        body: `We send you automatic emails about your booking: that your request arrived, a decline or the reservation, payment reminders, payments received, the confirmation with the address of the home and, if it comes to it, a cancellation. The legal basis is Art. 6(1)(b) GDPR.${
          emailProvider === "brevo"
            ? "\n\nThe emails are sent for us by Brevo (Sendinblue SAS, 106 boulevard Haussmann, 75008 Paris, France) as our processor (Art. 28 GDPR). Brevo receives your email address, your name and the content of the email for this, and keeps delivery logs [for the period in its contract]. The data is processed in the EU."
            : emailProvider === "other"
              ? "\n\nThe emails are sent for us by [email provider, address] as our processor (Art. 28 GDPR). It receives your email address, your name and the content of the email for this."
              : ""
        }`,
      },
      {
        title: "The home on this site",
        body: "The photos, description and availability calendar of the home contain no data about guests. The calendar only shows whether a day is free.",
      },
      {
        title: "Protection against spam and abuse",
        body: "The request form is protected by a small puzzle your browser solves (ALTCHA). It runs on our own server, without third parties and without cookies. To limit abuse, the server counts requests per IP address; the addresses are only held briefly in memory for this and are not stored. The legal basis is our legitimate interest in running the site securely (Art. 6(1)(f) GDPR).",
      },
      {
        title: "Cookies",
        body: "Guests get no cookies from this site. Only the owner's sign-in and the owner's own pages use a few cookies, strictly necessary for them (§ 25(2) no. 2 TTDSG); there is no tracking and no third-party cookie. Which cookies they are and how long they are kept is in the [cookie notice](/stay/legal/cookies).",
      },
      {
        title: "Server logs",
        body: `When you open the site, the server processes technically necessary data (the address requested, the time, your browser's identifier and ${cloudflare ? "your IP address, as passed on by Cloudflare" : "[at the web server in front] your IP address"}). The application's logs contain no names or email addresses. Logs are deleted after [period]. The legal basis is Art. 6(1)(f) GDPR.`,
      },
      {
        title: "Hosting",
        body: `The site runs on our own server [location]. ${cloudflare ? "Your data is stored there, not with a hosting provider; the connection to it runs through Cloudflare (see below)." : "Your data is not passed to a hosting provider."}`,
      },
      cloudflare && {
        title: "Cloudflare",
        body: "Every visit to this site goes through Cloudflare (Cloudflare, Inc., 101 Townsend St., San Francisco, CA 94107, USA): Cloudflare provides the encrypted connection, protects against attacks and passes the requests to our server through a connection (tunnel). In doing so, Cloudflare processes your IP address, the addresses requested, browser details and the content sent, as our processor (Art. 28 GDPR). Cloudflare may process data in the USA; it is certified under the EU-US Data Privacy Framework (the European Commission's adequacy decision, Art. 45 GDPR). The legal basis is our legitimate interest in a secure site that can be reached without a public IP address of our own (Art. 6(1)(f) GDPR).",
      },
      googleCalendar && {
        title: "Calendar",
        body: "We keep bookings in step with our Google Calendar (Google Ireland Limited). Only the dates, the number of guests, the amount and a booking number are sent, no names, email addresses, phone numbers or messages. The legal basis is Art. 6(1)(f) GDPR.",
      },
      {
        title: "How long data is kept",
        body: `- Declined and expired requests are anonymised after ${retentionMonths} months.
- Bookings and payments are accounting records and are kept for eight years (§ 147 of the German Fiscal Code, AO); they are deleted afterwards.
- Backups are overwritten after their retention period [of about six months]; until then, deleted data may still be in them.`,
      },
      {
        title: "Your rights",
        body: `You have the right of access (Art. 15 GDPR), rectification (Art. 16), erasure (Art. 17), restriction of processing (Art. 18), data portability (Art. 20) and to object to processing based on legitimate interests (Art. 21). You can also complain to a data protection supervisory authority, for example [the authority of your federal state].

To exercise them, write to us at ${contact}.`,
      },
    ],
  );
}
