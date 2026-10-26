# Benutzerhandbuch

Ein kurzer Rundgang durch die App für alle, die täglich damit arbeiten. Die
Bezeichnungen sind die der deutschen Oberfläche; mit der Sprache English
zeigt die App dieses Handbuch auf Englisch.

## Inhalt {#contents}

- [Erste Schritte](#getting-around)
- [Unterkünfte](#properties)
- [Rechtliche Seiten und live gehen](#legal-pages-and-going-live)
- [Der Kalender](#the-calendar)
- [Buchungen](#bookings)
- [E-Mails](#emails)
- [Gäste und ihre persönlichen Daten](#guests-and-their-personal-data)
- [Google-Kalender-Synchronisierung](#google-calendar-sync)
- [Buchungsplattformen (iCal)](#booking-platforms-ical)
- [Finanzen](#finance)
- [Übersicht](#dashboard)

## Erste Schritte {#getting-around}

Das Menü links (auf dem Handy unten) führt zu **Kalender**, **Buchungen**,
**Finanzen**, **Übersicht** und **Einstellungen**. Im Kontomenü unten in der
Seitenleiste finden Sie die **Sprache** (Deutsch oder English) und
**Abmelden**. Die Sprache merkt sich der Browser; ohne Auswahl richtet sich
die App nach der Sprache des Browsers, sonst nach Deutsch. Datumsangaben,
Beträge und der erste Wochentag folgen ebenfalls der Sprache.

Drücken Sie überall (außerhalb eines Textfelds) **T**, um einen Posten zu
erfassen.

**Hilfe auf jeder Seite:** Die Schaltfläche **Hilfe** (unten in der
Seitenleiste; auf dem Handy das **?** oben) öffnet die Hilfe zur Seite, auf
der Sie gerade sind: wofür sie da ist, die häufigen Aufgaben Schritt für
Schritt, was die Status bedeuten und was zu tun ist, wenn etwas nicht wie
geplant läuft. Der letzte Link führt zum passenden Teil dieses Handbuchs,
das die App unter **/help** zeigt. Kleine **?**-Zeichen neben einigen
Einstellungen (die nicht erstattbare Anzahlung, die Webadresse, der
iCal-Link, Google Kalender, live gehen) erklären sie in ein, zwei Sätzen.
Die Hilfetexte sind Dateien im Repository (`help/de-DE`, `help/en-GB`) und
lassen sich verbessern, ohne den Code anzufassen.

**Wer sich anmelden darf** (Einstellungen → **Zugang**): die Google-Konten,
die die App nutzen dürfen. Fügen Sie eines über seine Adresse hinzu - eine
Partnerin, ein Partner, ein zweites eigenes Konto - und entfernen Sie es
wieder; Entfernen meldet es sofort ab. Die auf dem Server eingetragenen
Konten (`AUTH_ALLOWED_EMAILS`) sind als „Fest eingetragen“ markiert und
bleiben, damit Sie sich nie aussperren können, und niemand kann sein eigenes
Konto entfernen. Gäste brauchen nie ein Konto: Sie buchen auf der
öffentlichen Seite. Wer bei der Anmeldung abgewiesen wird, sieht, mit
welchem Konto er es versucht hat (gekürzt, z. B. „f…@gmail.com“), und dass
Sie es hinzufügen müssen. Solange die Google-Anmeldung der App noch im
**Testmodus** ist, lässt Google nur seine Testnutzer herein: Fügen Sie das
Konto auch dort hinzu (siehe [google-cloud-setup.md](google-cloud-setup.md)).

## Unterkünfte {#properties}

**Einstellungen → Unterkünfte** listet die Unterkünfte, die Sie vermieten.
Jede hat einen Namen, eine Adresse, eine Zeitzone, eine Währung, einen
Standardpreis pro Nacht und eine Reinigungsgebühr sowie eine Farbe für den
Kalender.

- Preis und Gebühr sind **Vorgaben**: Eine neue Buchung beginnt damit, und
  spätere Änderungen betreffen bestehende Buchungen nicht.
- **Archivieren** Sie eine Unterkunft, die Sie nicht mehr vermieten. Sie
  verschwindet aus den Auswahllisten, aber ihre Buchungen und Finanzen
  bleiben, und die Auslastung zählt sie ab dem Tag der Archivierung nicht
  mehr mit. **Wiederherstellen** holt sie zurück.
- **Öffentliche Buchungsseite**: Geben Sie einer Unterkunft eine
  **Webadresse** (zum Beispiel `seehaus`) und setzen Sie den Haken **Auf der
  öffentlichen Buchungsseite zeigen**. Gäste können dann `/stay/seehaus`
  ohne Anmeldung öffnen. Das ist für jede Unterkunft aus, bis Sie es
  einschalten, und eine archivierte Unterkunft wird nie gezeigt. Die Seite
  zeigt nie die Adresse, die Sie hier eingetragen haben.
- **Startseite**: Gäste, die die Adresse der Seite selbst öffnen (zum
  Beispiel `https://robbenplate.com`), sehen die gelisteten Unterkünfte: bei
  einer gleich ihre Seite, bei mehreren je eine Karte mit Titelbild, Titel,
  kurzer Beschreibung und „ab“-Preis, bei keiner ein neutrales
  „Demnächst“. Dieselbe Seite liegt unter `/stay`. Angemeldet öffnet die
  Adresse wie bisher Ihren Kalender; der Link **Anmeldung für Gastgeber**
  in der Fußzeile führt zur Anmeldung. Der Haken bleibt aus, bis die
  [rechtlichen Seiten](#legal-pages-and-going-live) ausgefüllt sind.
- **Inserat**: **Einstellungen → Unterkünfte → Inserat** ist das, was Gäste
  auf der öffentlichen Seite sehen: Titel, Beschreibung und Hausregeln auf
  Deutsch und Englisch, die Zahl der Gäste, Schlaf- und Badezimmer, die
  Ausstattung und der Ort oder die Region (nie die genaue Adresse).
  Fügen Sie dort auch Fotos hinzu, vom Computer oder direkt vom iPhone oder
  iPad: Das erste ist das Titelbild, die Pfeile ändern die Reihenfolge. Fotos
  werden verkleinert gespeichert, ohne die Standort- und Kameradaten, die
  ein Handy hineinschreibt.
- **An- und Abreise**: auf derselben Seite die früheste Anreise, die
  früheste und die späteste Abreise, jeweils optional, in der Zeitzone der
  Unterkunft (die früheste Abreise darf nicht nach der spätesten liegen).
  Gäste sehen sie auf der öffentlichen Seite, auf ihrer Buchungsseite und in
  den E-Mails, als „Anreise ab 15:00 · Abreise zwischen 08:00 und 10:00“.
  Eine Buchung behält die Zeiten, unter denen sie reserviert oder angelegt
  wurde; Änderungen gelten also nur für neue Buchungen.
- **Verfügbarkeit auf der öffentlichen Seite**: Gäste sehen, welche Nächte
  frei sind, und wählen einen An- und einen Abreisetag; wählbar sind nur
  Aufenthalte, die Ihre Buchungsregeln erlauben, und sie sehen eine
  Schätzung (Nächte × Preis pro Nacht + Reinigungsgebühr, aus den Vorgaben
  der Unterkunft). Sie sehen nie, warum eine Nacht belegt ist, und Anfragen,
  die Sie nicht angenommen haben, blockieren nichts.
- **Hilfe für Gäste**: Die öffentliche Seite erklärt **So funktioniert die
  Buchung** - Anfrage, Ihre Antwort, Anzahlung, Restzahlung, die
  Bestätigung mit der Adresse - mit kurzen Fragen zum Aufklappen: wann die
  Tage gehalten werden und wann eine unbezahlte Reservierung verfällt, wie
  man bezahlt, Stornieren, die Kurtaxe, An- und Abreise und die eigenen
  Daten. Die Buchungsseite des Gastes sagt unter **Wie es weitergeht**, was
  sein Status bedeutet (Anfrage gesendet, reserviert, bestätigt, bezahlt,
  abgelehnt, verfallen, storniert) und was als Nächstes zu tun ist: was bis
  wann zu zahlen ist, welche Buchungsnummer anzugeben ist, wie man den
  Aufenthalt in den Kalender einträgt, wie man storniert und wie man Sie
  erreicht.
  - Die Zahlen sind **Ihre Einstellungen**, so wie sie gerade sind: die
    Anzahlung und ihre Fristen (Zahlungsbedingungen), wie lange eine Anfrage
    auf Ihre Antwort wartet (Buchungsanfragen), die Stornostaffel, die
    Kurtaxe, die An- und Abreisezeiten und ob eine Bankverbindung
    eingetragen ist. Ändern Sie eine, nennt die Hilfe den neuen Wert; eine
    Einstellung, die Sie nicht gemacht haben, bleibt weg. Die Buchungsseite
    nimmt die Beträge und Daten der Buchung selbst.
  - „Wie erreiche ich Sie?“ nennt die E-Mail-Adresse aus Ihrem
    [Impressum](#legal-pages-and-going-live); ohne sie fällt die Frage weg.
  - Die Texte liegen in `help/de-DE/` und `help/en-GB/` (`public-stay.md`,
    `public-booking.md`); Gäste lesen sie in der Sprache ihres Browsers.
- **Preise** (Einstellungen → Unterkünfte → **Preise**): alles, was den
  Preis einer Unterkunft bestimmt, auf einer Seite pro Unterkunft. Ein
  Aufenthalt wird Nacht für Nacht nach seiner Saison berechnet; dann geht
  der Rabatt für längere Aufenthalte von den Nächten ab; dann kommt die
  Reinigungsgebühr dazu. Der Normalpreis und die Reinigungsgebühr selbst
  bleiben unter **Bearbeiten** bei der Unterkunft.
- **Saisonpreise** (auf der Seite Preise): Zeiträume mit eigenem Preis pro
  Nacht, etwa „Hauptsaison“ vom 1. Juli bis 31. August. Eine Saison
  wiederholt sich **jedes Jahr** (sie darf über Neujahr gehen, z. B. 20.
  Dezember bis 6. Januar) oder gilt **einmalig** in einem bestimmten Jahr.
  Außerhalb aller Saisons gilt der Normalpreis der Unterkunft. Zwei Saisons
  derselben Art dürfen sich nicht überschneiden; eine einmalige Saison (eine
  Ferienwoche) darf in einer jährlichen liegen und gilt dann an ihren Tagen.
  Der Streifen unter jeder Unterkunft zeigt die nächsten 12 Monate: welcher
  Preis an welchen Tagen gilt.
  - Jeder Preis wird gleich berechnet, Nacht für Nacht: die Schätzung für
    Gäste auf der öffentlichen Seite, der Gesamtbetrag einer neuen Buchung
    und daraus die Anzahlung, die Restzahlung, die E-Mails und die Seite des
    Gastes. Schätzung und Buchung zeigen die Zeilen („2 Nächte × 140,00 € ·
    Hauptsaison“). Gäste sehen die Namen der Saisons, benennen Sie sie also
    für Gäste.
  - Der „ab“-Preis der öffentlichen Seite ist der niedrigste Preis der
    nächsten 12 Monate.
  - **Eine Buchung behält ihren Preis.** Wird eine Saison später geändert
    oder gelöscht, ändern sich bestehende Buchungen nicht. Neu berechnet
    wird eine Buchung nur, wenn Sie ihre Daten, ihren eigenen Preis oder
    ihre Reinigungsgebühr ändern (oder einen von Hand festgelegten
    Gesamtbetrag zurückgeben). Buchungen von vor den Saisonpreisen behalten
    ihren Gesamtbetrag.
  - **Rabatte für längere Aufenthalte** (auf der Seite Preise): „ab 7
    Nächten 10 % Rabatt“, „ab 14 Nächten 15 %“. Die höchste Stufe, die ein
    Aufenthalt erreicht, geht von seinen Nächten ab (nicht von der
    Reinigungsgebühr) und steht als eigene Zeile im Preis. Gäste sehen die
    Stufen neben dem Preis auf der öffentlichen Seite. 2 bis 365 Nächte, 1
    bis 90 %, eine Stufe pro Nächtezahl; keine Stufe heißt kein Rabatt. Wie
    bei den Saisons ändern spätere Änderungen bestehende Buchungen nicht.
  - **Stornierung: wann die Anzahlung einbehalten wird** (auf der Seite
    Preise): Normalerweise verliert ein Gast, der storniert, die ganze
    Anzahlung (wenn sie unter Zahlungsbedingungen als nicht erstattbar
    eingestellt ist). Eine Staffel macht es davon abhängig, wie früh er
    storniert: kostenlos bis einige Monate vor der Anreise, dann ein Anteil,
    der Tag für Tag von einem ersten bis zu einem letzten Prozentsatz über
    einige Monate steigt, und dieser letzte Anteil bis zur Anreise. Zum
    Beispiel kostenlos bis 6 Monate vorher, dann 20 % steigend auf 100 %
    über 5 Monate. Die Monate zählen vom Anreisetag zurück (vom 31. August
    sechs Monate zurück ist der 28. Februar). Gäste sehen die Staffel in
    echten Daten für ihren Aufenthalt - neben der Schätzung, über der
    Einwilligung der Anfrage, auf ihrer Buchungsseite und in den E-Mails zu
    Reservierung und Anzahlung -, und der Stornodialog zeigt, wo der heutige
    Tag steht und was das für die Erstattung heißt. Was über die Anzahlung
    hinaus bezahlt wurde, und die Kurtaxe werden immer erstattet. Eine
    Buchung behält die Staffel, unter der sie angefragt wurde. Das
    Live-Beispiel in den Einstellungen zeigt die Daten für eine Anreise
    Ihrer Wahl.
  - **Kurtaxe** (auf der Seite Preise): die Abgabe der Gemeinde pro Person
    und Nacht, die Sie einnehmen und weitergeben - sie ist nicht Ihr
    Einkommen. Tragen Sie die Sätze aus der Satzung Ihrer Gemeinde ein:
    einen Satz pro Erwachsenem und Nacht, bis zu vier Altersgruppen für
    Kinder (0–17) mit eigenem Satz (0 für kostenlos; wer außerhalb liegt,
    zahlt den Satz für Erwachsene), optional jährliche Zeiträume mit anderen
    Sätzen (die Hochsaison eines Kurorts) und optional eine Höchstzahl
    berechneter Nächte. Wählen Sie, wie Preise sie zeigen: **zzgl. Kurtaxe**
    (zum Preis hinzu, die Voreinstellung) oder **inklusive** (Ihre Preise
    pro Nacht enthalten sie schon).
    - Gäste geben dann die Zahl der Erwachsenen und der Kinder pro
      Altersgruppe an (nie Geburtsdaten); ohne Altersgruppen fragt das
      Formular nur nach der Zahl der Gäste. Die Kurtaxe ist eine eigene
      Zeile in der Schätzung, der Buchung und auf der Seite des Gastes, und
      die E-Mails nennen sie mit dem Gesamtbetrag. Preise, die gezeigt
      werden, bevor die Gäste feststehen, sagen „zzgl. Kurtaxe“ oder „inkl.
      Kurtaxe“.
    - Sie wird mit der Restzahlung bezahlt, nie in der Anzahlung, und bei
      einer Stornierung voll erstattet.
    - Ändern Sie die Gäste einer Buchung, wird ihre Kurtaxe nach den Regeln
      neu berechnet, unter denen die Buchung berechnet wurde; sonst ändert
      sich nichts an ihrem Preis. **Kurtaxe von Hand festlegen** im
      Buchungsformular ist für einen Gast, der nach der Satzung befreit ist
      oder weniger zahlt, mit einem Grund; sie erscheint als „Kurtaxe
      (manuell)“.
    - In den Büchern geht sie in eine eigene Kategorie, **Kurtaxe
      (durchlaufend)**, die die Übersicht, der PDF-Bericht und die
      Kennzahlen pro Nacht aus dem Umsatz herauslassen. **Finanzen →
      Kurtaxe** zeigt pro Monat, was die Aufenthalte schulden und was
      eingegangen ist. Sie zählt die geschuldete Kurtaxe **nach dem Monat, in
      dem ein Aufenthalt beginnt**: Prüfen Sie, wie Ihre Gemeinde sie
      gemeldet haben möchte (nach Anreise, nach Nacht oder nach Zahlung),
      bevor Sie sie melden.
  - Im Buchungsformular gibt **Eigener Preis pro Nacht** einer Buchung
    einen festen Preis für jede Nacht statt der Saisons; leer gelassen
    gelten die Saisons. **Gesamtbetrag von Hand festlegen** geht weiterhin
    allem vor.
- **Buchungsregeln** (Einstellungen → Buchungsregeln) begrenzen, was Gäste
  auf der öffentlichen Seite anfragen können: Mindest- und Höchstnächte, wie
  viele Tage im Voraus ein Aufenthalt angefragt werden muss (Vorlaufzeit)
  und darf (Buchungshorizont), an welchen Wochentagen Gäste anreisen können,
  und freie Nächte zwischen Aufenthalten (für die Reinigung). Ihre eigenen
  Buchungen dürfen davon abweichen: Das Buchungsformular warnt, speichert
  aber.

## Rechtliche Seiten und live gehen {#legal-pages-and-going-live}

Eine öffentliche Buchungsseite in Deutschland braucht ein **Impressum** (§ 5
DDG) und eine **Datenschutzerklärung** (Art. 13 DSGVO). Füllen Sie sie unter
**Einstellungen → Rechtliche Seiten** aus; sie gelten für die ganze Seite
und erscheinen unter `/stay/legal/imprint` und `/stay/legal/privacy`,
verlinkt unten auf jeder öffentlichen Seite und in jeder E-Mail.

- **Impressum**: Ihr Name, eine Postanschrift, unter der Sie erreichbar
  sind, und eine E-Mail-Adresse sind Pflicht; eine Telefonnummer, eine
  USt-IdNr. und ein freier Zusatz (zum Beispiel eine Aufsichtsbehörde) sind
  optional.
- **Datenschutzerklärung**: ein Text auf Deutsch und einer auf Englisch.
  Beim ersten Öffnen beginnen beide mit einer **Vorlage**, geschrieben nach
  dem, was diese App wirklich tut: das Anfrageformular (Name, E-Mail,
  Telefon, Daten, Gäste, Nachricht, Zeitpunkt der Einwilligung und die
  Sprache), Zahlung per Überweisung (keine Kartendaten), die automatischen
  E-Mails, die Fotos und das Inserat, der selbst betriebene Spamschutz
  (ALTCHA, keine Dritten) und die Begrenzungen nach IP-Adresse, die
  Server-Logs, das Hosting auf Ihrem eigenen Server, Cloudflare, wenn die
  Seite über dessen Tunnel läuft, der E-Mail-Anbieter, sobald E-Mail
  eingerichtet ist (Brevo namentlich), die Google-Kalender-Synchronisierung,
  wenn Sie sie nutzen (ohne persönliche Daten der Gäste), wie lange Daten
  aufbewahrt werden (abgelehnte und verfallene Anfragen nach Ihrer
  Aufbewahrungsfrist anonymisiert, Buchungen und Zahlungen 8 Jahre nach §
  147 AO, Backups nach Ablauf ihrer Aufbewahrung) und die Rechte der Gäste
  (Art. 15–21 DSGVO, Beschwerde bei einer Aufsichtsbehörde). **Die Vorlage
  ist ein Ausgangspunkt, keine Rechtsberatung: Lassen Sie sie prüfen.**
  Füllen Sie die Stellen in [eckigen Klammern] aus und löschen Sie den
  Hinweis oben. **Neu mit der Vorlage beginnen** stellt sie wieder her.
- Die Texte sind Markdown: `## Überschrift`, `- Listenpunkt`, `**fett**`,
  `[Text](https://…)`. HTML und Bilder werden nicht gezeigt, und Links
  funktionieren nur zu `http`-, `https`- und `mailto`-Adressen.

**Live gehen** oben in den Einstellungen ist die Checkliste. Solange das
Impressum und beide Datenschutztexte nicht ausgefüllt sind, **kann keine
Unterkunft gelistet werden**, und solange eine gelistet ist, können sie nicht
geleert werden (nehmen Sie sie erst von der Seite). Die Checkliste warnt
außerdem, ohne Sie aufzuhalten, solange die Datenschutzerklärung noch den
Hinweis der Vorlage enthält, und für jede Unterkunft ohne Bankverbindung,
deren Gäste nicht erfahren würden, wohin sie überweisen sollen.

### Cookies {#cookies}

Die öffentlichen Seiten setzen **keine Cookies**: Gäste können schauen,
Tage wählen und eine Anfrage senden, ganz ohne. Nur Ihre Anmeldung und Ihre
eigenen Seiten verwenden einige wenige, alle unbedingt erforderlich (um Sie
angemeldet zu halten, um die Anmeldung zu schützen und um die Sprache und
die gewählte Unterkunft im Kalender zu merken). Die Seite braucht und zeigt
deshalb **kein Cookie-Banner**. Der **Cookie-Hinweis**
(`/stay/legal/cookies`, verlinkt in der Fußzeile jeder öffentlichen Seite
und auf der Anmeldeseite) listet sie mit Zweck und Speicherdauer auf; die
Vorlage der Datenschutzerklärung verweist darauf. Cloudflare setzt für diese
Seite keine.

## Der Kalender {#the-calendar}

Ein Monat auf einen Blick, ein farbiger Balken pro Aufenthalt. Ein Balken
reicht von der Mitte des Anreisetags bis zur Mitte des Abreisetags; reist
ein Gast ab und der nächste am selben Tag an, treffen sie sich in der Mitte.

| Balken                            | Bedeutet                                                                                                        |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Voll, in der Farbe der Unterkunft | Eine **bestätigte** Buchung: Die Tage sind vergeben                                                             |
| Gestrichelter Rand                | Eine **Anfrage**: notiert, aber die Tage sind nicht gehalten                                                    |
| Grau schraffiert, farbiger Rand   | **Blockiert**: von Ihnen, von einem Termin in Ihrem Google Kalender oder vom Aufenthalt einer Buchungsplattform |

- **Anzeigen** oben wählt eine Unterkunft oder alle; die App merkt sich die
  Auswahl.
- **Tage buchen oder blockieren**: Ziehen Sie über die Tage (oder tippen Sie
  auf den ersten und den letzten Tag) und wählen Sie dann **Neue Buchung**
  oder **Tage blockieren** mit einem optionalen Grund. Belegte Tage färben
  die Auswahl rot und sagen, was im Weg ist; liegen Sie eine Nacht neben
  einem Wechseltag, nennt die App den Tag, der passt.
- Mit der Tastatur: Die Pfeiltasten wechseln zwischen den Tagen, die
  **Eingabetaste** beginnt und beendet eine Auswahl, **Umschalt** mit den
  Pfeilen erweitert sie, **Esc** bricht ab.
- Klicken Sie auf eine Buchung, um sie zu öffnen, oder auf eine Blockierung,
  um sie zu ändern oder zu löschen. Blockierungen aus Google Kalender lassen
  sich nur dort ändern.
- **Eine Buchung ziehen** (mit Maus oder Stift) verschiebt den Aufenthalt;
  ziehen Sie ihr linkes oder rechtes Ende, um An- oder Abreise zu ändern.
  Die Tage, die sie belegen würde, leuchten auf, rot, wenn sie belegt sind;
  eine bestätigte Buchung lässt sich nicht auf belegte Tage ziehen. Bevor
  etwas gespeichert wird, zeigt die App die alten und die neuen Daten und
  fragt nach. Danach setzt **Rückgängig** in der Meldung die Daten 15
  Sekunden lang zurück. Ein kleiner Ausrutscher mit der Maus verschiebt
  nichts, und **Esc** bricht ab. Auf dem Handy ändern Sie die Daten in der
  Buchung selbst.
- Auf dem Handy ist der Kalender eine Liste, Monat für Monat; beim Scrollen
  lädt er den nächsten Monat.

**Wechseltage.** Der Abreisetag ist für die nächste Anreise frei: Ein Gast
kann an dem Tag anreisen, an dem der vorige abreist, aber nicht am Tag davor.

## Buchungen {#bookings}

**Buchungen** listet jeden Aufenthalt, die kommenden zuerst, mit Filtern für
Gast, Unterkunft, Status, Quelle und Daten. **Neue Buchung** (auch aus dem
Kalender) fragt nach:

- der **Unterkunft** und dem **Gast**: Suchen Sie vorhandene Gäste nach Name
  oder E-Mail, oder legen Sie direkt einen neuen an;
- **Anreise** und **Abreise**: Das Formular prüft die Daten schon beim
  Tippen;
- Gästen, **Status** und **Quelle** (Direkt, Airbnb, Booking.com, Sonstige);
- dem **Preis pro Nacht** und der **Reinigungsgebühr**, aus der Unterkunft
  übernommen. Der Gesamtbetrag ist Nächte × Preis + Reinigungsgebühr;
  setzen Sie den Haken **Gesamtbetrag von Hand festlegen**, um einen anderen
  Preis zu vereinbaren, der dann auch bei geänderten Daten gleich bleibt.

**Status**

| Status     | Hält die Tage | Im Google Kalender und im iCal-Export | Zählt als Einnahme und Umsatz |
| ---------- | ------------- | ------------------------------------- | ----------------------------- |
| Anfrage    | Nein          | Nein                                  | Nein                          |
| Reserviert | Ja            | Ja                                    | Nein                          |
| Bestätigt  | Ja            | Ja                                    | Ja                            |
| Bezahlt    | Ja            | Ja                                    | Ja                            |
| Abgelaufen | Nein          | Nein (entfernt)                       | Nein                          |
| Storniert  | Nein          | Nein (entfernt)                       | Nein                          |

Die Auslastung in der Übersicht zählt die gehaltenen Nächte. Eine Anfrage
von der öffentlichen Seite kommt als Anfrage mit der Quelle „Website“ an.

Eine Anfrage darf sich mit anderen Aufenthalten überschneiden; **Buchung
bestätigen** prüft die Daten erneut und lehnt ab, wenn sie inzwischen
vergeben sind. **Buchung stornieren** gibt die Tage sofort frei und behält
die Buchung (als storniert markiert); zur Erstattung siehe
**Stornierungen** weiter unten. Eine stornierte oder abgelaufene
Buchung lässt sich **als Anfrage wiederherstellen**, solange kein Geld aus
ihr mehr eingegangen ist (erst erstatten oder eine neue Buchung anlegen)
und ihre Tage noch frei sind. Eine so wiederhergestellte Anfrage von Ihrer
Website wartet ab der Wiederherstellung wieder so lange auf Ihre Antwort
wie eine neue.

Den Status setzen Sie selbst nur bei einer Buchung, die Sie von Hand
eingetragen haben und die außerhalb des Zahlungsablaufs liegt: nie
angenommen, keine Zahlung erfasst. Eine Buchung von Airbnb oder
Booking.com, dort bezahlt, kann gleich **Bezahlt** sein. Jede andere
Änderung des Status läuft über die Schaltflächen der Buchung: annehmen,
Zahlung erfassen, stornieren, wiederherstellen. Deshalb gibt es **Buchung
bestätigen** nur bei von Hand eingetragenen Buchungen; eine Anfrage von
der Website wird angenommen, und ihre Zahlungen bestätigen sie.

**Anfragen** (Buchungen → Anfragen; die Zahl neben Buchungen im Menü zählt
sie) listet die Anfragen, die Gäste über Ihre öffentliche Seite geschickt
haben: Daten, Gäste, ihre Nachricht, die Schätzung und den Tag, bis zu dem
Sie antworten sollten. **Annehmen und reservieren** hält die Tage (siehe
unten); hat eine andere Buchung sie inzwischen belegt, wird das abgelehnt
und angezeigt, welche. **Ablehnen** fragt nach einem optionalen Grund für
den Gast. Eine Anfrage, die nicht rechtzeitig beantwortet wird, verfällt von
selbst (Einstellungen → Buchungsanfragen: 3 Tage, wenn Sie nichts anderes
wählen). Abgelehnte und verfallene Anfragen werden 6 Monate aufbewahrt
(ebenfalls einstellbar), dann werden die Daten des Gastes gelöscht wie mit
**Persönliche Daten löschen** - außer der Gast hat weitere Buchungen bei
Ihnen. Unter den Anfragen listet die Seite jede Buchung, bei der noch eine
Zahlung aussteht, mit ihrer Frist.

**Eine Anfrage annehmen und die Zahlung.** **Annehmen und reservieren** hält
die Tage einer Anfrage für den Gast, bis seine erste Zahlung fällig ist,
nach den **Zahlungsbedingungen** der Unterkunft (Einstellungen →
Zahlungsbedingungen; voreingestellt 20 % Anzahlung binnen 7 Tagen nach der
Annahme und der Rest 30 Tage vor der Anreise; liegt die Anreise 30 Tage oder
weniger entfernt, der ganze Betrag binnen 3 Tagen). Die Karte **Zahlung** der
Buchung zeigt, was wann fällig ist; **Fristen ändern** gibt dem Gast mehr
Zeit. **Zahlung erfassen** trägt Geld ein, sobald es da ist: Die erste
Zahlung bestätigt die Buchung, der ganze Betrag markiert sie als bezahlt.
Eine Reservierung, die bis zum Ende ihres Fristtags nicht bezahlt ist,
läuft binnen einer Stunde von selbst ab, und ihre Tage sind wieder frei.
Eine bestätigte Buchung mit überfälliger Restzahlung wird nie automatisch
storniert: Das entscheiden Sie.

**Stornierungen.** Unter den Zahlungsbedingungen ist **Anzahlung bei
Stornierung durch den Gast nicht erstattbar** (voreingestellt an) Ihre
Stornoregel: Ein Gast, der storniert, verliert die Anzahlung und bekommt
zurück, was er darüber hinaus gezahlt hat. Ist es aus, bekommt er alles
zurück. Andere Gebühren gibt es nicht. Gäste lesen die Regel neben dem Preis
auf Ihrer öffentlichen Seite, über der Einwilligung, wenn sie eine Anfrage
senden, und in den E-Mails, die sie zur Zahlung auffordern. Eine Buchung
behält die Regel, unter der der Gast angefragt hat (oder Sie sie angelegt
haben), auch wenn Sie sie später ändern; einbehalten wird die Anzahlung, um
die er bei der Annahme gebeten wurde.

**Buchung stornieren** fragt, wer storniert. Für den Gast berechnet es die
Erstattung nach der Regel der Buchung; für Sie ist es alles Eingegangene, da
Sie immer voll erstatten. Sie können den Betrag ändern, bis zu dem, was
eingegangen ist. Die Tage sind sofort frei, der Gast bekommt eine E-Mail
(und Sie, wenn der Gast storniert hat), und die Buchung zeigt **Zu
erstatten**, bis Sie das Geld überweisen und mit **Zahlung erfassen**
eintragen, das die Erstattung vorschlägt. Die Erstattung erscheint dann in
den Finanzen als negative Einnahme.

## E-Mails {#emails}

Sobald E-Mail eingerichtet ist ([Deployment-Anleitung](deployment.md#email-optional)),
schreibt die App Gästen, die über die öffentliche Seite angefragt haben, in
der Sprache, die sie dort benutzt haben:

| Wann                                           | Der Gast erhält                                                                                                                    |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Er sendet eine Anfrage                         | Eine Bestätigung, dass sie angekommen ist                                                                                          |
| Sie nehmen sie an                              | Dass die Tage reserviert sind, was bis wann zu zahlen ist, die Bankverbindung, einen GiroCode und den Link zu seiner Buchungsseite |
| Kurz bevor eine Zahlung fällig ist             | Eine Erinnerung (nur solange sie noch offen ist)                                                                                   |
| Die erste Zahlung geht ein                     | Dass die Buchung bestätigt ist und was noch zu zahlen ist                                                                          |
| Alles ist bezahlt                              | An- und Abreisezeiten, die genaue Adresse, Hinweise zur Anreise und die Hausregeln                                                 |
| Sie oder der Gast stornieren                   | Dass die Buchung storniert ist und was erstattet wird                                                                              |
| Sie lehnen ab, oder sie verfällt oder läuft ab | Dass es nicht geklappt hat, mit Ihrem Grund, wenn Sie einen angegeben haben                                                        |

Die beiden Bestätigungen (erste Zahlung, alles bezahlt) bringen den
Aufenthalt für den Kalender des Gastes mit: eine Datei `stay.ics` und Links
für Google Kalender und Outlook.com. Der Eintrag reicht von der frühesten
Anreise am Anreisetag bis zur spätesten Abreise am Abreisetag, in der
Zeitzone der Unterkunft (ganztägig, wenn keine Zeit eingestellt ist), und
nennt die Buchungsnummer und einen Link zur Buchungsseite des Gastes. Die
zweite Datei aktualisiert den Eintrag der ersten. Nur die E-Mail „alles
bezahlt“ enthält die genaue Adresse. Sobald die Tage reserviert sind, kann
der Gast den Aufenthalt auch von seiner Buchungsseite aus eintragen.

Sie bekommen eine E-Mail für jede neue Anfrage, jede verfallene
Reservierung, jede überfällige Restzahlung und jede Stornierung durch einen
Gast.

Die genaue Adresse und die Hinweise zur Anreise stehen unter
**Einstellungen → Unterkünfte → Inserat**, „Nur für bestätigte Gäste“. Sie
erscheinen nie auf der öffentlichen Seite; nur die E-Mail „alles bezahlt“
enthält sie.

Jede E-Mail wird einmal gesendet. Eine, die nicht mehr stimmt, wenn sie an
der Reihe ist, etwa eine Erinnerung an eine inzwischen eingegangene Zahlung,
wird nicht gesendet. **Einstellungen → E-Mails** listet, was wartet und was
schiefgegangen ist, und **Jetzt senden** sendet das Wartende sofort.

## Gäste und ihre persönlichen Daten {#guests-and-their-personal-data}

Die Seite eines Gastes zeigt seine Kontaktdaten und alle seine Aufenthalte.
**Persönliche Daten löschen** setzt einen Antrag auf Löschung um (DSGVO Art.
17): Der Name wird zu „Gelöschter Gast“, E-Mail, Telefon und Notizen
verschwinden, ebenso die Notizen seiner Buchungen, die Notizen zur Kurtaxe
und die Notizen zu seinen Zahlungen. Links, die der Gast zu seiner
Buchungsseite bekommen hat, funktionieren nicht mehr. Die Buchungen und
Zahlungen selbst bleiben, anonymisiert, mit Beträgen und Daten, weil sie
Buchhaltungsunterlagen sind. Das lässt sich
nicht rückgängig machen. Belege an Posten bleiben unberührt: Sie sind
Buchhaltungsunterlagen. Wie gelöschte Gäste aus den Backups verschwinden:
[backup-and-restore.md](backup-and-restore.md).

## Google-Kalender-Synchronisierung {#google-calendar-sync}

Optional. Die Einrichtung auf Googles Seite zuerst:
[google-cloud-setup.md](google-cloud-setup.md).

1. **Einstellungen → Google Kalender → Google Kalender verbinden** und den
   Zugriff erlauben.
2. Wählen Sie für jede Unterkunft einen **Kalender** und was synchronisiert
   wird:
   - **Buchungen an Google senden**: Jede bestätigte Buchung erscheint als
     ganztägiger Termin und folgt der Buchung, wenn sie sich ändert oder
     storniert wird. Der Termin nennt die Unterkunft, die Nächte, die Zahl
     der Gäste und den Gesamtbetrag sowie einen Link zur Buchung, aber
     **keinen Namen und keine Kontaktdaten des Gastes**.
   - **Tage für andere Termine dort blockieren**: Ihre eigenen Termine in
     diesem Kalender (ein Familienbesuch, eine Renovierung) blockieren die
     Tage in der App. Kurze Termine mit Uhrzeit wie Besprechungen blockieren
     keine Nächte.
3. **Synchronisierung starten**. **Alles neu synchronisieren** sendet alle
   Buchungen der Unterkunft erneut; **Synchronisierung beenden** hört auf
   und lässt die Termine in Google stehen.

**Wer gewinnt.** Für ihren eigenen Termin ist die Buchung maßgeblich:
Verschieben oder löschen Sie den Termin einer Buchung in Google, stellt die
App ihn wieder her. Ihre anderen Termine gehören Google: Die App spiegelt sie
nur als Blockierungen. Überschneidet sich einer davon mit einer bestätigten
Buchung, wird er keine Blockierung: Die Buchung gewinnt, auf keiner Seite
wird etwas geändert, und die App vermerkt den Konflikt als Sync-Problem
(vorerst über die API einsehbar), bis Sie den Termin in Google verschieben
oder löschen. Die vollständigen Regeln: [calendar-sync.md](calendar-sync.md).

**Wenn die Synchronisierung scheitert**, zeigt jede Buchung ihren Stand (Im
Google Kalender, Wird synchronisiert, Sync fehlgeschlagen, Sync gestoppt),
und **Einstellungen → Google Kalender → Sync-Probleme** listet, was warum
fehlgeschlagen ist, mit **Erneut versuchen**. Fehler werden eine Zeit lang
automatisch wiederholt; nach wiederholten Fehlern hält ein Termin an, bis
Sie ihn erneut versuchen oder die Buchung sich ändert. Scheitert die
Synchronisierung seit über einer Stunde, sagt ein Hinweis auf jeder Seite
das: Ein veralteter Google Kalender ist schlimmer als keiner.

## Buchungsplattformen (iCal) {#booking-platforms-ical}

Stehen die Unterkünfte auch bei Airbnb, Booking.com oder ähnlichen
Plattformen, verbinden Sie deren Kalender unter **Einstellungen →
Buchungsplattformen (iCal)**, damit nichts doppelt vergeben wird.

- **Ihre Aufenthalte hier**: Fügen Sie den Kalender-Export-Link einer
  Plattform hinzu (das Feld sagt, wo Sie ihn finden). Jeder Aufenthalt dort
  wird zu einer schreibgeschützten Blockierung, benannt nach der Plattform
  („Blockiert: Airbnb“), und folgt der Plattform binnen etwa einer halben
  Stunde; **Jetzt lesen** holt sofort. Ändern Sie diese Aufenthalte auf der
  Plattform, nicht hier.
- **Ihre Tage dort**: Setzen Sie den Haken **Belegte Tage dieser Unterkunft
  als iCal-Kalender veröffentlichen** und geben Sie den Link jeder Plattform
  als zu importierenden Kalender. Er zeigt Ihre bestätigten Buchungen als
  „Gebucht“ und Ihre Blockierungen als „Blockiert“, sonst nichts. **Neuen
  Link erstellen** macht den alten sofort ungültig. Die Plattformen können
  ihn nur lesen, wenn Ihr Server aus dem Internet erreichbar ist; siehe
  [deployment.md](deployment.md#sharing-availability-with-booking-platforms).

**Doppelbuchungen.** Hat eine Plattform einen Aufenthalt an den Tagen einer
hier bestätigten Buchung, wurden die Tage zweimal vergeben. Die App versteckt
das nicht: Ein roter Hinweis auf jeder Seite, eine Liste in den
Einstellungen und eine Warnung im Kalender (die Buchung umrandet) nennen die
Plattform, die Daten und die Buchung. Stornieren Sie eine der beiden, auf der
Plattform oder hier; die Warnung verschwindet von selbst, sobald sich die
Tage nicht mehr überschneiden.

**Aufenthalte, die auf einmal verschwinden.** Ein auf der Plattform
stornierter Aufenthalt gibt seine Tage hier beim nächsten Lesen frei. Würde
ein Lesen aber alle kommenden Aufenthalte einer Plattform freigeben, oder
mehr als die Hälfte, wartet die App: Eine Plattform liefert manchmal aus
Versehen einen leeren Kalender, und die Website böte diese Tage dann an.
Die Aufenthalte bleiben blockiert, die Einstellungen sagen es, und frei
werden sie erst, wenn das nächste Lesen dasselbe ergibt. Aufenthalte, die
der Kalender der Plattform in einer Form nennt, die die App nicht lesen
kann, bleiben ebenfalls blockiert; die Einstellungen zählen sie.

Die Aufenthalte einer Plattform sind hier Blockierungen, keine Buchungen:
Legen Sie einen Aufenthalt als Buchung an, wenn er in den Finanzen und der
Auslastung erscheinen soll.

## Finanzen {#finance}

**Finanzen** ist das Kassenbuch: Einnahmen und Ausgaben, Monat für Monat, mit
laufenden Summen. Wählen Sie darüber Monat, Unterkunft, Art oder Kategorie,
oder **Belege: Ohne Beleg**, um die Posten zu finden, denen noch einer fehlt
(etwa nach einem CSV-Import oder für die Steuererklärung); der CSV-Export
folgt diesem Filter ebenfalls.

- **Erfassen** (oder die Taste **T**) trägt einen Posten ein: Betrag,
  Kategorie, Datum, Unterkunft, optional die zugehörige Buchung und eine
  Beschreibung. Das Fenster öffnet mit einer Ausgabe für heute, der übliche
  Eintrag ist also Betrag, Kategorie, Eingabetaste.
- Klicken Sie auf einen Posten, um ihn zu bearbeiten oder zu löschen.
- **Kategorien** gruppieren Einnahmen und Ausgaben; die Farben gelten auch in
  den Diagrammen. Die Standardkategorien lassen sich umbenennen, umfärben und
  ausblenden, aber nicht löschen. Wird eine verwendete Kategorie gelöscht,
  verschieben Sie ihre Posten zuerst in eine andere.

**Belege.** Fügen Sie die Belege eines Postens gleich beim Erfassen hinzu
oder später, indem Sie ihn öffnen: PDFs oder Fotos (JPEG, PNG, WebP, HEIC),
je bis 10 MB und 5 pro Posten. Wählen Sie **Belege hinzufügen**, ziehen Sie
die Dateien ins Fenster, oder auf Handy und Tablet **Foto aufnehmen**. Die
Belege eines neuen Postens werden hochgeladen, sobald er gespeichert ist;
scheitert einer (zu groß etwa), bleibt der Posten gespeichert, das Fenster
nennt die Datei, und **Erneut versuchen** lädt nur die noch fehlenden hoch,
sodass nichts doppelt eingetragen wird. Fotos erscheinen als kleine
Vorschau; ein Klick öffnet ein Foto oder lädt ein PDF herunter. Aus
JPEG-Fotos werden die Standortdaten beim Hochladen entfernt; HEIC- und
WebP-Fotos (etwa das eigene Format des iPhones) behalten ihre, exportieren
Sie sie also vorher als JPEG, wenn Ihnen das wichtig ist. Eine Büroklammer
im Kassenbuch markiert Posten mit Belegen.

Belege sind Buchhaltungsunterlagen: Das deutsche Steuerrecht verlangt, sie
**8 Jahre** aufzubewahren (§ 147 AO). Das Löschen der persönlichen Daten
eines Gastes lässt sie unberührt, und die App löscht sie nie nach Alter;
das Löschen des Postens oder des Belegs tut es. Sie werden mit der Datenbank
gesichert ([backup-and-restore.md](backup-and-restore.md#7-files-volume-receipts-and-listing-photos)).

**CSV.** **CSV exportieren** speichert, was das Kassenbuch zeigt (seinen
Monat und seine Filter), für Ihre Steuerberatung oder eine Tabelle, in einem
einfachen Format oder einem für deutsches Excel. **CSV importieren** liest
einen Kontoauszug, eine Tabelle oder einen solchen Export: Geben Sie an,
welche Spalte das Datum, den Betrag und so weiter enthält, sehen Sie sich
die geprüften Zeilen an und importieren Sie. Zeilen mit Problemen werden mit
ihrer Zeilennummer aufgeführt und ausgelassen; mögliche Doppel (gleiches
Datum, gleicher Betrag und gleiche Beschreibung wie ein vorhandener Eintrag)
werden übersprungen, außer Sie haken sie an. Eine hier exportierte Datei
lässt sich wieder importieren, ohne etwas doppelt anzulegen.

**Einnahmen aus Buchungen** füllen das Kassenbuch automatisch: Jede
bestätigte Buchung wird zu Einnahmen (Unterkunft und Reinigungsgebühr).
Das wird vorerst über die API eingerichtet (siehe die [README](../README.md#api)).

### Wiederkehrende Kosten {#recurring-costs}

**Finanzen → Wiederkehrende Kosten** (ein Reiter oben auf jeder
Finanzen-Seite) listet die Ausgaben, die sich wiederholen: was sie sind, die
Unterkunft, der Betrag pro Monat, Quartal oder Jahr, wann die nächste fällig
ist und ob die Regel aktiv, pausiert oder beendet ist. An jedem
Fälligkeitstag trägt die App die Ausgabe von selbst ins Kassenbuch ein; war
sie offline, holt sie das später nach, nie zweimal für denselben Tag.

- **Wiederkehrende Kosten hinzufügen**: Unterkunft, Kategorie, Betrag, wie
  oft, die erste Fälligkeit, optional die letzte, und eine Beschreibung. Der
  Tag der ersten Fälligkeit bestimmt jedes Mal den Tag (eine Regel ab dem 31. ist in kürzeren Monaten am letzten Tag fällig).
- **Wiederkehrend machen**: Öffnen Sie eine Ausgabe im Kassenbuch und
  klicken Sie auf **Wiederkehrend machen**, um eine Regel mit ihrer
  Unterkunft, Kategorie, ihrem Betrag und ihrer Beschreibung anzulegen, erste
  Fälligkeit einen Monat später. Beim Erfassen einer neuen Ausgabe fragt das
  Fenster **Kommt diese Ausgabe regelmäßig?**: **Wiederkehrend machen**
  legt dort eine Regel mit dem an, was Sie eingetippt haben, erste
  Fälligkeit an diesem Datum, statt des einzelnen Postens.
- **Dokumente**: **Bearbeiten** Sie eine Regel, um ihren Vertrag, ihre
  Police oder ihre Jahresabrechnungen bei ihr abzulegen (**Dokumente
  hinzufügen**; PDFs oder Fotos, je bis 10 MB und 20 pro Regel, geprüft wie
  Belege). Eine Büroklammer in der Liste markiert Regeln mit Dokumenten.
- **Zahlungen**: Dasselbe Fenster listet die Posten, die die Regel angelegt
  hat, die neuesten zuerst, jeweils mit ihren Belegen oder „ohne Beleg“; die
  Büroklammer daneben fügt die Rechnung dieses Monats zu diesem Posten
  hinzu.
- **Bearbeiten** ändert Kategorie, Betrag, letzte Fälligkeit und
  Beschreibung für die noch kommenden Posten. Posten, die schon im
  Kassenbuch stehen, behalten ihre Beträge. Unterkunft, Rhythmus und erste
  Fälligkeit lassen sich nicht ändern; geben Sie der Regel dafür eine letzte
  Fälligkeit und legen Sie eine neue an.
- **Pausieren** stoppt neue Posten, etwa solange ein Vertrag ruht.
  **Fortsetzen** macht ab der nächsten Fälligkeit weiter; die Termine, die
  während der Pause vergangen sind, werden übersprungen, nicht nachgeholt.
- **Löschen** entfernt die Regel und ihre Dokumente. Posten, die sie schon
  angelegt hat, bleiben im Kassenbuch, mit ihren Belegen.
- Im Kassenbuch markiert ein Abzeichen **wiederkehrend** die Posten einer
  Regel; es führt zu dieser Regel.

Zwei Beispiele:

- **Kredit.** 950,00 € am 1. jedes Monats: Legen Sie zuerst unter
  **Kategorien** eine Kategorie _Kredit_ an, dann Betrag 950, monatlich,
  erste Fälligkeit 1. Januar, Beschreibung „Darlehen Sparkasse“. Ändert die
  Bank die Rate ab Juli, ändern Sie den Betrag im Juni: Die Posten bis Juni
  bleiben bei 950,00 €, spätere nehmen den neuen Betrag. Ist der Kredit
  abbezahlt, setzen Sie die letzte Fälligkeit.
- **Nebenkostenvorauszahlung.** 180,00 € im Quartal an die Stadtwerke:
  Kategorie _Nebenkosten_, Betrag 180, vierteljährlich, erste Fälligkeit 15.
  Februar. Die Jahresabrechnung ist ein einzelner Posten im Kassenbuch (eine
  Erstattung als Einnahme, eine Nachzahlung als Ausgabe); legt sie eine neue
  Vorauszahlung fest, ändern Sie den Betrag der Regel.

## Übersicht {#dashboard}

Wie es den Unterkünften in einem Zeitraum geht (dieser Monat, letzter Monat,
seit Jahresbeginn, die letzten 12 Monate oder eigene Daten), für eine
Unterkunft oder alle. Veränderungen werden mit denselben Tagen ein Jahr
zuvor verglichen.

| Kennzahl           | Bedeutet                                                  |
| ------------------ | --------------------------------------------------------- |
| Umsatz             | Einnahmen im Kassenbuch, nach Datum des Postens           |
| Ausgaben           | Ausgaben im Kassenbuch, nach Datum des Postens            |
| Gewinn             | Umsatz minus Ausgaben                                     |
| Gewinnmarge        | Gewinn als Anteil am Umsatz                               |
| Auslastung         | Gebuchte Nächte als Anteil der verfügbaren Nächte (unten) |
| Kommende Buchungen | Bestätigte Anreisen in den nächsten 30 Tagen              |

**Auslastung.** Eine Nacht gehört zu dem Datum, an dem sie beginnt, und eine
bestätigte Buchung belegt die Nächte von der Anreise bis vor die Abreise.
Anfragen und stornierte Buchungen belegen keine. **Verfügbare Nächte** sind
die Nächte jeder Unterkunft im Zeitraum (bis zum Tag ihrer Archivierung),
abzüglich der Nächte, die Sie blockiert haben und die niemand gebucht hat:
Die haben Sie nicht angeboten. Ein Monat mit 30 Nächten, 3 davon blockiert
und 18 gebucht, ergibt also 18 von 27, 67 %.

Die Diagramme zeigen Umsatz und Ausgaben pro Monat, wohin das Geld nach
Kategorie geht (ein Klick auf eine Kategorie zeigt ihre Posten), die
Auslastung pro Monat (auf Wunsch neben dem Vorjahr) und ein Jahr gebuchter
Nächte als Heatmap. Jedes Diagramm kann seine Zahlen als Tabelle zeigen.

**Exportieren** (oben rechts) speichert den angezeigten Zeitraum, für die
Unterkunft oder alle: den **Bericht als PDF** (die Kennzahlen, ein Diagramm
der Monate, die Ausgaben nach Kategorie und die Auslastung, dieselben Zahlen
wie auf dem Bildschirm) für Ihre Steuerberatung oder die Steuererklärung,
und die **Posten als CSV**.

„Alle Unterkünfte“ addiert Beträge nur, wenn sie dieselbe Währung haben;
sonst wählen Sie eine Unterkunft.
