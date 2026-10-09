# User guide

A short tour of the app for the people who use it day to day. The labels
below are the English ones; the German interface uses the same layout.

## Contents

- [Getting around](#getting-around)
- [Properties](#properties)
- [The calendar](#the-calendar)
- [Bookings](#bookings)
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

| Status    | Holds the dates | In Google Calendar | Counts as income and occupancy |
| --------- | --------------- | ------------------ | ------------------------------ |
| Inquiry   | No              | No                 | No                             |
| Confirmed | Yes             | Yes                | Yes                            |
| Cancelled | No              | No (removed)       | No                             |

An inquiry may overlap other stays; **Confirm booking** checks the dates
again and refuses if they have been taken since. **Cancel booking** frees the
dates at once, keeps the booking (marked cancelled) and does not notify the
guest. A cancelled booking can be **reinstated as an inquiry**.

## Guests and their personal data

A guest's page shows their contact details and all their stays. **Erase
personal data** carries out a request to be forgotten (DSGVO Art. 17): the
name becomes "Deleted guest", and the email, phone and notes go, as do the
notes of their bookings. The bookings themselves remain, anonymised, because
they are accounting records. This cannot be undone. How erased guests age
out of backups: [backup-and-restore.md](backup-and-restore.md).

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

**CSV.** **Export CSV** saves what the ledger shows (its month and filters)
for your accountant or a spreadsheet, in a plain format or one for German
Excel. **Import CSV** reads a bank statement, a spreadsheet or such an
export: say which column holds the date, the amount and so on, look at the
checked rows, and import. Rows with problems are listed by line and left
out; possible duplicates (same date, amount and description as an entry
already there) are skipped unless you tick them. A file exported here
imports again without creating anything twice.

Two things can fill the ledger automatically, set up through the API for
now (see the [README](../README.md#api)): **booking income**, which turns
each confirmed booking into income entries (accommodation and cleaning fee),
and **recurring expenses** (monthly, quarterly or annual).

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

"All properties" adds amounts together only when they share a currency;
otherwise choose one property.
