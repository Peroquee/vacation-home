# User guide

A short tour of the app for the people who use it day to day. The labels
below are the English ones; the German interface uses the same layout.

## Contents

- [Getting around](#getting-around)
- [Properties](#properties)
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
- **Listing**: **Settings → Properties → Listing** is what guests see on
  the public page: a title, description and house rules in English and
  German, the number of guests, bedrooms and bathrooms, amenities, check-in
  and check-out times, and the town or region (never the exact address).
  Add photos there too, from a computer or straight from an iPhone or iPad:
  the first one is the cover, and the arrows change the order. Photos are
  stored resized, without the location or camera data a phone puts in them.
- **Availability on the public page**: guests see which nights are free and
  pick an arrival and a departure day; only stays your booking rules allow
  can be picked, and they see an estimate (nights × nightly rate + cleaning
  fee, from the property's defaults). They never see why a night is taken,
  and requests you have not accepted do not block anything.
- **Booking rules** (Settings → Booking rules) limit what guests can request
  on the public site: minimum and maximum nights, how many days ahead a stay
  must be requested (lead time) and may be (horizon), which weekdays guests
  can arrive on, and free nights to keep between stays (for cleaning). Your
  own bookings may break them: the booking form warns you, but saves.

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
dates at once, keeps the booking (marked cancelled) and does not notify the
guest. A cancelled or expired booking can be **reinstated as an inquiry**.

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
gives the guest more time. **Deposit received** confirms the booking,
**Balance received** (or **Full amount received**) marks it paid. A
reservation not paid by the end of its deadline day expires by itself
within the hour and its dates are free again. A confirmed booking whose
balance is overdue is never cancelled automatically: that is your call.
Reminders and notices for each of these steps are recorded for the emails
to guests and to you, which come with a later update.

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
| Everything is paid                   | Check-in and check-out times, the exact address, arrival notes and the house rules                            |
| You decline, or it lapses or expires | That it did not work out, with your reason if you gave one                                                    |

You get an email for each new request, each reservation that lapsed and
each balance that is overdue.

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

A platform's stays are blocks here, not bookings: record a stay as a
booking if you want it in the finances and occupancy.

## Finance

**Finance** is the ledger: income and expenses, month by month, with
running totals. Pick the month, property, type or category above it.

- **Add** (or press **T**) records a transaction: amount, category, date,
  property, optionally the booking it belongs to and a description. It opens
  on an expense for today, so the usual entry is amount, category, Enter.
- Click a transaction to edit or delete it.
- **Categories** groups income and expenses; the colours carry over to the
  charts. The default categories can be renamed, recoloured and hidden but
  not deleted. Deleting a category in use moves its transactions to another
  first.

**Receipts.** Open a saved transaction to add its receipts: PDFs or photos
(JPEG, PNG, WebP, HEIC), up to 10 MB each and 5 per transaction. Photos
show as small previews; a click opens a photo or downloads a PDF. Location
data is removed from JPEG photos on upload; HEIC and WebP photos (the
iPhone's own format, for example) keep theirs, so export those as JPEG
first if that matters. A paperclip in the ledger marks transactions with
receipts.

Receipts are accounting records: German tax law requires keeping them **8
years** (§147 AO). Erasing a guest's personal data leaves them alone, and the
app never deletes them by age; deleting the transaction or the receipt does.
They are backed up with the database ([backup-and-restore.md](backup-and-restore.md#7-receipts)).

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

**Finance → Recurring costs** lists the expenses that repeat: what they
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
  description, first due one month later.
- **Edit** changes the category, amount, last due date and description for
  the entries still to come. Entries already in the ledger keep their
  amounts. Property, interval and first due date cannot change; for that,
  give the rule a last due date and add a new one.
- **Pause** stops new entries, for example while a contract is suspended.
  **Resume** carries on from the next due date; the dates that passed while
  paused are skipped, not caught up.
- **Delete** removes the rule. Entries it already made stay in the ledger.
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
