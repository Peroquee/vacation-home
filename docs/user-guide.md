# User guide

A short tour of the app for the people who use it day to day. The labels
below are the English ones; with the interface in German, the app shows
this guide in German (`docs/user-guide.de-DE.md`).

## Contents

- [Getting around](#getting-around)
- [Properties](#properties)
- [Legal pages and going live](#legal-pages-and-going-live)
- [The calendar](#the-calendar)
- [Bookings](#bookings)
- [Emails](#emails)
- [Guests and their personal data](#guests-and-their-personal-data)
- [Google Calendar sync](#google-calendar-sync)
- [Booking platforms (iCal)](#booking-platforms-ical)
- [Finance](#finance)
- [Dashboard](#dashboard)

## Getting around

The menu on the left (at the bottom on a phone) leads to **Calendar**,
**Bookings**, **Finance**, **Dashboard** and **Settings**. Your account menu
at the bottom of the sidebar holds the **language** (Deutsch or English) and
**Sign out**. The language is remembered on that browser; without a choice,
the app follows the browser's language, and German otherwise. Dates, amounts
and the first day of the week follow the language too.

Press **T** anywhere (outside a text field) to record a transaction.

**Help on every page:** the **Help** button (bottom of the sidebar; the **?**
at the top on a phone) opens help for the page you are on: what it is for,
the common tasks step by step, what the statuses mean, and what to do when
something doesn't go as planned. Its last link leads to the matching part of
this guide, which the app shows under **/help**. Small **?** signs next to a
few settings (the non-refundable deposit, the web address, the iCal link,
Google Calendar, going live) explain them in a sentence or two. The help
texts are files in the repository (`help/de-DE`, `help/en-GB`), so they can
be improved without touching the code.

**Who may sign in** (Settings → **Access**): the Google accounts that may
use the app. Add one by its address - a partner, a second account of your
own - and remove it again; removing signs it out at once. The accounts set
on the server (`AUTH_ALLOWED_EMAILS`) are marked "fixed" and stay, so you
can never lock yourself out, and nobody can remove their own account.
Guests never need an account: they book on the public site. Someone turned
away at sign-in sees which account they used (masked, e.g. "f…@gmail.com")
and that you need to add it. While the app's Google sign-in is still in
**testing**, Google lets in only its test users: add the account there too
(see [google-cloud-setup.md](google-cloud-setup.md)).

## Properties

**Settings → Properties** lists the places you rent out. Each has a name, an
address, a timezone, a currency, a default nightly rate and cleaning fee, and
a colour for the calendar.

- The rate and fee are **defaults**: a new booking starts from them, and
  changing them later does not touch existing bookings.
- **Archive** a property you no longer rent out. It disappears from the
  selectors, but its bookings and finances stay, and the occupancy figures
  stop counting it from the day it was archived. **Restore** brings it back.
- **Public booking site**: give a property a **web address** (for example
  `lake-house`) and tick **Show on the public booking site**. Guests can then
  open `/stay/lake-house` without signing in. It is off for every property
  until you turn it on, and an archived property is never shown. The page
  never shows the address you entered here.
- **Start page**: guests who open the site's own address (for example
  `https://robbenplate.com`) see the listed homes: with one, its page
  straight away; with several, a card for each with its cover photo, title,
  a short description and the "from" price; with none, a neutral "coming
  soon". The same page is at `/stay`. Signed in, the address opens your
  calendar as before; the footer's **Owner sign-in** link leads to sign-in. The tick box stays off until the
  [legal pages](#legal-pages-and-going-live) are filled in.
- **Listing**: **Settings → Properties → Listing** is what guests see on
  the public page: a title, description and house rules in English and
  German, the number of guests, bedrooms and bathrooms, amenities, and the
  town or region (never the exact address).
  Add photos there too, from a computer or straight from an iPhone or iPad:
  the first one is the cover, and the arrows change the order. Photos are
  stored resized, without the location or camera data a phone puts in them.
- **Arrival and departure**: on the same page, the earliest arrival, the
  earliest departure and the latest departure, each optional, in the
  property's timezone (the earliest departure can't be after the latest).
  Guests see them on the public page, on their booking page and in the
  emails, as "Arrival from 15:00 · Departure between 08:00 and 10:00". A
  booking keeps the times it was reserved or made under, so changing them
  only affects new bookings.
- **Availability on the public page**: guests see which nights are free and
  pick an arrival and a departure day; only stays your booking rules allow
  can be picked, and they see an estimate (nights × nightly rate + cleaning
  fee, from the property's defaults). They never see why a night is taken,
  and requests you have not accepted do not block anything.
- **Help for guests**: the public page explains **How booking works** -
  request, your answer, deposit, balance, the confirmation with the address -
  with short questions to unfold: when the dates are held and when an unpaid
  reservation lapses, how to pay, cancelling, the Kurtaxe, arrival and
  departure, and their data. The guest's booking page says **What happens
  now** for its status (request sent, reserved, confirmed, paid, declined,
  expired, cancelled) and what to do next: what to pay by when, which
  reference to quote, adding the stay to their calendar, how to cancel and
  how to reach you.
  - The numbers are **your settings**, as they are now: the deposit and its
    deadlines (Payment terms), how long a request waits for your answer
    (Booking requests), the cancellation schedule, the Kurtaxe, the arrival
    and departure times, and whether bank details are set. Change one, and
    the help says the new value; a setting you haven't made is left out.
    The booking page uses the booking's own amounts and dates.
  - "How do I reach you?" gives the email address from your
    [Impressum](#legal-pages-and-going-live); without one, it's left out.
  - The texts are in `help/de-DE/` and `help/en-GB/` (`public-stay.md`,
    `public-booking.md`); guests read them in their browser's language.
- **Prices** (Settings → Properties → **Prices**): everything that changes
  a property's price, on one page per property. A stay is priced night by
  night by its season; then the length-of-stay discount comes off the
  nights; then the cleaning fee is added. The standard rate and the
  cleaning fee themselves stay under **Edit** on the property.
- **Seasonal prices** (on the Prices page): periods with their own
  nightly rate, such as "Hauptsaison" from 1 July to 31 August. A season
  repeats **every year** (it may run across New Year, e.g. 20 December to
  6 January) or happens **once**, in a given year. Outside every season the
  property's standard rate applies. Two seasons of the same kind may not
  overlap; a one-off season (a holiday week) may lie inside a yearly one and
  then wins on its days. The strip under each property shows the next 12
  months: which rate applies on which days.
  - Every price is worked out the same way, night by night: the guest's
    estimate on the public page, the total of a new booking, and from it the
    deposit, the balance, the emails and the guest's page. The estimate and
    the booking show the lines ("2 nights × €140.00 · Hauptsaison"). Guests
    see the season names, so name them for guests.
  - The public page's "from" price is the lowest rate of the next 12 months.
  - **A booking keeps its price.** Changing or deleting a season later does
    not change existing bookings. A booking is priced anew only when you
    change its dates, its own rate or its cleaning fee (or hand back a total
    you had set by hand). Bookings made before seasonal prices keep their
    total as it was.
  - **Length-of-stay discounts** (on the Prices page): "from 7 nights 10%
    off", "from 14 nights 15% off". The highest tier a stay reaches comes off
    its nights (not the cleaning fee), and shows as its own line in the price.
    Guests see the tiers next to the price on the public page. 2 to 365
    nights, 1 to 90%, one tier per number of nights; none means no discount.
    Like the seasons, changing them later does not change existing bookings.
  - **Cancellation: when the deposit is kept** (on the Prices page): by
    default a guest who cancels loses the whole deposit (if it is set to
    non-refundable under Payment terms). A schedule makes it depend on how
    early they cancel: free until some months before arrival, then a share
    that rises day by day from a first to a last percentage over some
    months, and that last share until arrival. For example free until 6
    months before, then 20% rising to 100% over 5 months. Months count back
    from the arrival day (from 31 August, six months back is 28 February).
    Guests see it in real dates for their stay - next to the estimate, above
    the request's consent, on their booking page and in the reservation and
    deposit emails - and the cancel dialog shows where today stands and
    what that means for the refund. Anything paid beyond the deposit, and
    the Kurtaxe, is always refunded. A booking keeps the schedule it was
    requested under. The live example in the settings shows the dates for
    an arrival of your choice.
  - **Kurtaxe** (on the Prices page): the municipality's tax per person
    and night, which you collect and pass on - it is not your income. Enter
    the rates from your municipality's statute: a rate per adult and night,
    up to four children's age groups (0–17) with their own rate (0 for
    free; anyone outside them pays the adult rate), optional yearly periods
    with other rates (a resort's high season), and optionally a maximum of
    nights charged. Choose how prices show it: **plus Kurtaxe** (added to the
    price, the default: "zzgl. Kurtaxe") or **included** (your nightly rates
    already contain it).
    - Guests then give the number of adults and of children per age group
      (never birth dates); with no children's groups the form asks only for
      the number of guests. The Kurtaxe is its own line in the estimate,
      the booking and the guest's page, and emails name it with the total.
      Prices shown before the guests are known say "plus Kurtaxe" or "incl.
      Kurtaxe".
    - It is paid with the balance, never in the deposit, and is refunded in
      full when a stay is cancelled.
    - Changing a booking's guests works out its Kurtaxe anew by the rules
      the booking was priced under; nothing else of its price changes.
      **Set the Kurtaxe by hand** in the booking form for a guest who is
      exempt or pays less under the statute, with a reason; it shows as
      "Kurtaxe (manuell)".
    - In the books it goes to its own category, **Kurtaxe (durchlaufend)**,
      which the dashboard, the PDF report and the nightly figures leave out
      of revenue. **Finance → Kurtaxe** shows per month what the stays owe
      and what has come in. It counts the Kurtaxe owed **by the month a stay
      starts in**: check how your municipality wants it reported (by
      arrival, by night or by payment) before you file.
  - In the booking form, **Own nightly rate** gives one booking a flat
    rate for every night instead of the seasons; leave it empty to use them.
    **Set the total by hand** still overrides everything.
- **Booking rules** (Settings → Booking rules) limit what guests can request
  on the public site: minimum and maximum nights, how many days ahead a stay
  must be requested (lead time) and may be (horizon), which weekdays guests
  can arrive on, and free nights to keep between stays (for cleaning). Your
  own bookings may break them: the booking form warns you, but saves.

## Legal pages and going live

A public booking site in Germany needs an **Impressum** (§ 5 DDG) and a
**privacy policy** (Art. 13 GDPR). Fill them in under **Settings → Legal
pages**; they are one set for the whole site and appear at
`/stay/legal/imprint` and `/stay/legal/privacy`, linked at the bottom of every
public page and in every email.

- **Impressum**: your name, a postal address where you can be reached and an
  email address are required; a phone number, a VAT ID and a free-text
  addition (for example a supervisory authority) are optional.
- **Privacy policy**: one text in German and one in English. The first time you
  open it, both start from a **template** written from what this app really
  does: the request form (name, email, phone, dates, guests, message, the time
  of consent and the language), payments by bank transfer (no card data), the
  automatic emails, the photos and listing, the self-hosted spam protection
  (ALTCHA, no third parties) and the rate limits by IP address, server logs,
  hosting on your own server, Cloudflare when the site runs through its
  tunnel, the email provider once email is set up (Brevo by name), the
  Google Calendar sync if you use it (without guests' personal data), how long data is kept (declined and expired requests
  anonymised after your retention setting, bookings and payments kept 8 years
  under § 147 AO, backups rolling out after their retention) and the guest's
  rights (Art. 15–21 GDPR, complaint to a supervisory authority).
  **The template is a starting point, not legal advice: have it checked.**
  Fill in the parts in [square brackets] and delete the note at the top. **Start
  again from the template** puts it back.
- The texts are Markdown: `## Heading`, `- list item`, `**bold**`,
  `[text](https://…)`. HTML and images are not shown, and links work only to
  `http`, `https` and `mailto` addresses.

**Going live** at the top of Settings is the checklist. Until the Impressum and
both privacy texts are filled in, **no property can be listed**, and while one
is listed, they cannot be emptied (unlist it first). It also warns, without
stopping you, while the privacy policy still has the template's note and for
every property without bank details, whose guests would not be told where to
transfer.

### Cookies

The public pages set **no cookies**: guests can look, pick dates and send a
request without any. Only your sign-in and your own pages use a few, all
strictly necessary (to keep you signed in, to protect the sign-in, and to
remember the language and the calendar's home you chose), so the site
needs and shows **no cookie banner**. The **Cookie notice**
(`/stay/legal/cookies`, linked in every public page's footer and on the
sign-in page) lists them with their purpose and how long they are kept; the
privacy policy template points to it. Cloudflare sets none for this site.

## The calendar

A month at a glance, one coloured bar per stay. A bar runs from the middle
of the check-in day to the middle of the check-out day, so a guest leaving
and the next one arriving on the same day meet in the middle.

| Bar                           | Means                                                                                     |
| ----------------------------- | ----------------------------------------------------------------------------------------- |
| Solid, in the property colour | A **confirmed** booking: the dates are taken                                              |
| Dashed outline                | An **inquiry**: noted, but the dates are not held                                         |
| Hatched grey, coloured edge   | **Blocked**: by you, by an event in your Google calendar, or by a booking platform's stay |

- **Show** at the top picks one property or all of them; the app remembers
  the choice.
- **Book or block dates**: drag across the days (or tap the first and the
  last day), then choose **New booking** or **Block dates** with an optional
  reason. Taken dates turn the selection red and say what is in the way;
  when you are one night off a changeover, it tells you which day works.
- With the keyboard: the arrow keys move between days, **Enter** starts and
  ends a selection, **Shift** with the arrows extends it, **Escape** cancels.
- Click a booking to open it, or a block to change or delete it. Blocks that
  come from Google Calendar can only be changed there.
- **Drag a booking** (with a mouse or pen) to move the stay, or drag its
  left or right end to change check-in or check-out. The days it would take
  light up, red when taken; a confirmed booking can't be dropped on taken
  dates. Before anything is saved, the app shows the old and the new dates
  and asks. Afterwards, **Undo** in the message puts the dates back for 15
  seconds. A small slip of the mouse moves nothing, and **Escape** cancels.
  On a phone, change dates in the booking itself.
- On a phone the calendar is a list, month by month; it loads the next
  month as you scroll.

**Changeovers.** Check-out day is free for the next arrival: a guest can
arrive on the day the previous one leaves, but not the day before.

## Bookings

**Bookings** lists every stay, upcoming first, with filters for guest,
property, status, source and dates. **New booking** (also from the
calendar) asks for:

- the **property** and the **guest**: search existing guests by name or
  email, or add a new one in place;
- **check-in** and **check-out**: the form checks the dates as you type;
- guests, **status** and **source** (direct, Airbnb, Booking.com, other);
- the **nightly rate** and **cleaning fee**, filled in from the property.
  The total is nights × rate + cleaning fee; tick **Set the total by hand**
  to agree a different price, which then stays put when the dates change.

**Statuses**

| Status    | Holds the dates | In Google Calendar and the iCal export | Counts as income and revenue |
| --------- | --------------- | -------------------------------------- | ---------------------------- |
| Inquiry   | No              | No                                     | No                           |
| Reserved  | Yes             | Yes                                    | No                           |
| Confirmed | Yes             | Yes                                    | Yes                          |
| Paid      | Yes             | Yes                                    | Yes                          |
| Expired   | No              | No (removed)                           | No                           |
| Cancelled | No              | No (removed)                           | No                           |

Occupancy on the dashboard counts the nights held. A request from the
public site arrives as an inquiry with the source "Website".

An inquiry may overlap other stays; **Confirm booking** checks the dates
again and refuses if they have been taken since. **Cancel booking** frees the
dates at once and keeps the booking (marked cancelled); see
**Cancellations** below for the refund. A cancelled or expired
booking can be **reinstated as an inquiry**, as long as no money from it is
still held (refund it first, or make a new booking) and its dates are still
free.

You set the status yourself only on a booking you entered by hand that is
outside the payment flow: never accepted, and no payment recorded for it.
A booking from Airbnb or Booking.com, paid there, can be **Paid** straight
away. Every other change of status goes through the booking's buttons:
accept, record a payment, cancel, reinstate. So **Confirm booking** is
offered only for bookings entered by hand; a request from the website is
accepted, and its payments confirm it.

**Requests** (Bookings → Requests; the number next to Bookings in the
menu counts them) lists the requests guests sent from your public page:
dates, guests, their message, the estimate, and the day to answer by.
**Accept and reserve** holds the dates (see below); if another booking took
them meanwhile, it is refused and shows which. **Decline** asks for an
optional reason for the guest. A request not answered in time expires by
itself (Settings → Booking requests: 3 days unless you choose otherwise).
Declined and expired requests are kept for 6 months (also adjustable),
then the guest's details are erased as with **Erase personal data** -
unless the guest has other bookings with you. Below the requests, the page
lists every booking with a payment still to come and its deadline.

**Accepting a request and payment.** **Accept and reserve** holds an
inquiry's dates for the guest until their first payment is due, under the
property's **payment terms** (Settings → Payment terms; by default a 20%
deposit within 7 days of accepting and the balance 30 days before arrival;
when arrival is 30 days off or closer, the full amount within 3 days). The
booking's **Payment** card shows what is due and when; **Change deadlines**
gives the guest more time. **Record payment** enters money as it arrives:
the first payment confirms the booking, the whole total marks it paid. A
reservation not paid by the end of its deadline day expires by itself
within the hour and its dates are free again. A confirmed booking whose
balance is overdue is never cancelled automatically: that is your call.

**Cancellations.** Under the payment terms, **Deposit non-refundable if the
guest cancels** (on by default) is your cancellation policy: a guest who
cancels forfeits the deposit and gets back anything paid beyond it. Off,
they get everything back. There is no other fee. Guests read the policy
next to the price on your public page, above the consent when they send a
request, and in the emails asking them to pay. A booking keeps the policy the guest
requested (or you made it) under, even if you change it later; the deposit
kept is the one they were asked to pay when you accepted.

**Cancel booking** asks who is cancelling. For the guest it works out the
refund from the booking's policy; for you it is everything received, since
you always refund in full. You can change the amount, up to what was
received. The dates are free at once, the guest gets an email (and you,
when the guest cancelled), and the booking shows **Refund due** until you
send the money and enter it with **Record payment**, which suggests the
refund. The refund then appears in Finance as negative income.

## Emails

Once mail is set up ([deployment guide](deployment.md#email-optional)), the
app writes to guests who sent a request from the public site, in the
language they used there:

| When                                 | The guest gets                                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| They send a request                  | A confirmation that it arrived                                                                                |
| You accept it                        | That the dates are reserved, what to pay by when, bank details, a GiroCode and the link to their booking page |
| Shortly before a payment is due      | A reminder (only while it is still unpaid)                                                                    |
| The first payment arrives            | That the booking is confirmed, and what is left to pay                                                        |
| Everything is paid                   | Arrival and departure times, the exact address, arrival notes and the house rules                             |
| You or the guest cancel              | That the booking is cancelled, and what is refunded                                                           |
| You decline, or it lapses or expires | That it did not work out, with your reason if you gave one                                                    |

The two confirmations (first payment, everything paid) carry the stay for
the guest's calendar: a `stay.ics` file and links for Google Calendar and
Outlook.com. The entry runs from the earliest arrival on the arrival day to
the latest departure on the departure day, in the property's timezone (whole
days when a time is not set), and names the reference and a link to the
guest's booking page. The second file updates the entry the first one made.
Only the "everything paid" one has the exact address. Once the dates are
reserved, the guest can also add the stay from their booking page.

You get an email for each new request, each reservation that lapsed, each
balance that is overdue and each cancellation by a guest.

The exact address and arrival notes are under **Settings → Properties →
Listing**, "For confirmed guests only". They never appear on the public
site; only the "everything is paid" email contains them.

Each email is sent once. One that is no longer true when its turn comes,
such as a reminder for a payment that has since arrived, is not sent.
**Settings → Emails** lists what is waiting and what went wrong, and
**Send now** sends what is waiting at once.

## Guests and their personal data

A guest's page shows their contact details and all their stays. **Erase
personal data** carries out a request to be forgotten (DSGVO Art. 17): the
name becomes "Deleted guest", and the email, phone and notes go, as do the
notes of their bookings. The bookings themselves remain, anonymised, because
they are accounting records. This cannot be undone. Receipts on transactions are not touched: they are
accounting records. How erased guests age out of backups:
[backup-and-restore.md](backup-and-restore.md).

## Google Calendar sync

Optional. Setting up Google's side first: [google-cloud-setup.md](google-cloud-setup.md).

1. **Settings → Google Calendar → Connect Google Calendar** and allow access.
2. For each property, choose a **calendar** and what to sync:
   - **Send bookings to Google**: every confirmed booking appears as an
     all-day event, and follows the booking as it changes or is cancelled.
     The event carries the property, nights, guest count and total, and a
     link to the booking, but **no guest name or contact details**.
   - **Block dates for other events there**: your own events in that
     calendar (a family visit, renovation) block the dates in the app.
     Short timed events such as meetings do not block nights.
3. **Start syncing**. **Resync everything** sends all the property's
   bookings again; **Stop syncing** stops, leaving the events in Google.

**Who wins.** The booking is the truth for its own event: if you move or
delete a booking's event in Google, the app puts it back. Your other events
are Google's: the app only mirrors them as blocks. If one of them overlaps a
confirmed booking, it does not become a block: the booking wins, nothing is
changed on either side, and the app records the clash as a sync issue
(listed through the API for now) until you move or delete the event in
Google. The full rules:
[calendar-sync.md](calendar-sync.md).

**When syncing fails**, each booking shows its state (in Google Calendar,
syncing, sync failed, sync stopped), and **Settings → Google Calendar → Sync
problems** lists
what failed and why, with **Retry**. Failures are retried automatically
for a while; after repeated failures an event stops until you retry it or
the booking changes. If syncing has been failing for over an hour, a banner
on every page says so: a stale Google calendar is worse than none.

## Booking platforms (iCal)

If the properties are also on Airbnb, Booking.com or similar, connect their
calendars under **Settings → Booking platforms**, so nothing is sold twice.

- **Their stays here**: add a platform's calendar export link (the field
  says where to find it). Every stay there becomes a read-only block, named
  after the platform ("Blocked: Airbnb"), and follows the platform within
  about half an hour; **Read now** fetches at once. Change those stays on
  the platform, not here.
- **Your dates there**: tick **Publish this property's taken dates** and
  give the link to each platform as a calendar to import. It shows your
  confirmed bookings as "Booked" and your blocks as "Blocked", nothing
  else. **Make a new link** retires the old one at once. The platforms can
  only read it if your server is reachable from the internet; see
  [deployment.md](deployment.md#sharing-availability-with-booking-platforms).

**Double bookings.** If a platform has a stay on the dates of a confirmed
booking here, the dates were sold twice. The app does not hide that: a red
banner on every page, a list in Settings and a warning on the calendar (the
booking ringed) name the platform, the dates and the booking. Cancel one of
the two, on the platform or here; the warning goes by itself once the dates
no longer clash.

**Stays that vanish at once.** A stay cancelled on the platform frees its
dates here at the next reading. But if one reading would free all of a
platform's coming stays, or more than half of them, the app waits: a
platform sometimes serves an empty calendar by mistake, and the website
would then offer those dates. The stays stay blocked, Settings says so,
and they are freed once the next reading says the same. Stays the
platform's calendar lists in a form the app can't read stay blocked too,
and Settings counts them.

A platform's stays are blocks here, not bookings: record a stay as a
booking if you want it in the finances and occupancy.

## Finance

**Finance** is the ledger: income and expenses, month by month, with
running totals. Pick the month, property, type or category above it, or
**Receipts: Without a receipt** to find the transactions still missing one
(after a CSV import, say, or for the tax return); the CSV export follows
that filter too.

- **Add** (or press **T**) records a transaction: amount, category, date,
  property, optionally the booking it belongs to and a description. It opens
  on an expense for today, so the usual entry is amount, category, Enter.
- Click a transaction to edit or delete it.
- **Categories** groups income and expenses; the colours carry over to the
  charts. The default categories can be renamed, recoloured and hidden but
  not deleted. Deleting a category in use moves its transactions to another
  first.

**Receipts.** Add a transaction's receipts as you enter it, or later by
opening it: PDFs or photos (JPEG, PNG, WebP, HEIC), up to 10 MB each and 5
per transaction. Choose **Add receipts**, drop the files on the window, or
on a phone or tablet **Take a photo**. A new transaction's receipts upload
once it is saved; if one fails (too large, say), the transaction stays
saved, the window names the file and **Try again** uploads only the ones
still missing, so nothing is entered twice. Photos
show as small previews; a click opens a photo or downloads a PDF. Location
data is removed from JPEG photos on upload; HEIC and WebP photos (the
iPhone's own format, for example) keep theirs, so export those as JPEG
first if that matters. A paperclip in the ledger marks transactions with
receipts.

Receipts are accounting records: German tax law requires keeping them **8
years** (§147 AO). Erasing a guest's personal data leaves them alone, and the
app never deletes them by age; deleting the transaction or the receipt does.
They are backed up with the database ([backup-and-restore.md](backup-and-restore.md#7-files-volume-receipts-and-listing-photos)).

**CSV.** **Export CSV** saves what the ledger shows (its month and filters)
for your accountant or a spreadsheet, in a plain format or one for German
Excel. **Import CSV** reads a bank statement, a spreadsheet or such an
export: say which column holds the date, the amount and so on, look at the
checked rows, and import. Rows with problems are listed by line and left
out; possible duplicates (same date, amount and description as an entry
already there) are skipped unless you tick them. A file exported here
imports again without creating anything twice.

**Booking income** fills the ledger automatically: each confirmed booking
becomes income entries (accommodation and cleaning fee). It is set up
through the API for now (see the [README](../README.md#api)).

### Recurring costs

**Finance → Recurring costs** (a tab at the top of every Finance page)
lists the expenses that repeat: what they
are, the property, the amount per month, quarter or year, when the next one
is due and whether the rule is active, paused or ended. On each due date the
app adds the expense to the ledger by itself; if it was offline, it catches
up later, never twice for the same date.

- **Add a recurring cost**: property, category, amount, how often, the
  first due date, optionally the last one, and a description. The day of
  the first due date sets the day each time (a rule starting on the 31st is
  due on the last day of shorter months).
- **Make recurring**: open an expense in the ledger and click **Make
  recurring** to start a rule with its property, category, amount and
  description, first due one month later. While entering a new expense,
  the dialog asks **Does this expense come back regularly?**: **Make
  recurring** there starts a rule with what you typed, first due on that
  date, instead of the single entry.
- **Documents**: **Edit** a rule to keep its contract, policy or yearly
  statements with it (**Add documents**; PDFs or photos, up to 10 MB each and
  20 per rule, checked like receipts). A paperclip in the list marks rules
  with documents.
- **Payments**: the same dialog lists the entries the rule made, newest
  first, each with its receipts or "no receipt"; the paperclip next to one
  adds that month's invoice to that entry.
- **Edit** changes the category, amount, last due date and description for
  the entries still to come. Entries already in the ledger keep their
  amounts. Property, interval and first due date cannot change; for that,
  give the rule a last due date and add a new one.
- **Pause** stops new entries, for example while a contract is suspended.
  **Resume** carries on from the next due date; the dates that passed while
  paused are skipped, not caught up.
- **Delete** removes the rule and its documents. Entries it already made
  stay in the ledger, with their receipts.
- In the ledger, a **recurring** badge marks the entries a rule made; it
  links to that rule.

Two examples:

- **Mortgage.** €950.00 on the 1st of every month: add a category
  _Mortgage_ under **Categories** first, then amount 950, monthly, first due 1 January, description
  "Sparkasse loan". When the bank changes the rate from July, edit the
  amount in June: the entries up to June stay at €950.00, later ones use the
  new amount. When the loan is paid off, set the last due date.
- **Utility prepayment.** €180.00 a quarter to the municipal utility:
  category _Utilities_, amount 180, quarterly, first due 15 February. The
  yearly statement is a one-off entry in the ledger (a refund as income, an
  extra payment as an expense); if it sets a new prepayment, edit the rule's
  amount.

## Dashboard

How the properties are doing over a period (this month, last month, year to
date, the last 12 months, or your own dates), for one property or all.
Changes are compared with the same dates a year earlier.

| Figure            | Means                                                |
| ----------------- | ---------------------------------------------------- |
| Revenue           | Income in the ledger, by transaction date            |
| Expenses          | Expenses in the ledger, by transaction date          |
| Net profit        | Revenue minus expenses                               |
| Profit margin     | Net profit as a share of revenue                     |
| Occupancy rate    | Booked nights as a share of available nights (below) |
| Upcoming bookings | Confirmed arrivals in the next 30 days               |

**Occupancy.** A night belongs to the date it starts on, and a confirmed
booking occupies the nights from check-in up to, not including, check-out.
Inquiries and cancelled bookings occupy none. **Available nights** are each
property's nights in the period (until the day it was archived), less the
nights you blocked and nobody booked: you did not offer those. So a month of
30 nights with 3 blocked and 18 booked is 18 of 27, 67%.

The charts show revenue and expenses per month, where the money goes by
category (click a category for its transactions), occupancy per month
(optionally beside the year before) and a year of booked nights as a
heatmap. Each chart can show its figures as a table.

**Export** (top right) saves the period on screen, for the property or all
of them: the **report as a PDF** (the figures, a chart of the months, the
expenses by category and the occupancy, the same numbers as on screen) for
your accountant or the tax return, and the **transactions as CSV**.

"All properties" adds amounts together only when they share a currency;
otherwise choose one property.
