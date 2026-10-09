# Google Calendar sync: precedence and conflict rules

How the app and Google Calendar stay in step, and who wins when they
disagree (GitLab #70, #72–#74). The code is in [`src/lib/google`](../src/lib/google).

## Two kinds of events

| Event                                                 | Who owns it                        | How it's recognised                                                     |
| ----------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------- |
| **Booking events**, pushed by the app (outbound sync) | The app. The booking is the truth. | The private extended property `vacationHome=booking` (plus `bookingId`) |
| **Everything else** in the calendar (inbound sync)    | Google. The app only mirrors it.   | No such property                                                        |

A booking event never becomes a block, and a Google event never becomes a
booking. That's what stops a sync loop.

## Precedence

1. **The booking wins over its own event.** If a booking event is edited in
   Google (moved, renamed), the app writes the booking's version back:
   - when the booking next changes: the update is sent with `If-Match` and
     the stored etag, and a `412` means "changed in Google", so the app
     overwrites it;
   - or as soon as inbound sync sees the edit: the event comes back with an
     etag the app didn't write, so the booking's push is queued again.

   The fields where Google's version differed are logged by **name only**
   (`differingFields`), never by value, since someone may have typed
   personal data there.

2. **A booking event deleted in Google is created again** under a new id
   (Google never reuses a deleted id), as long as the booking is confirmed.
3. **Google wins over its own events.** Moving, editing or deleting an
   external event moves or removes its block. Nothing is ever written back
   to such an event.
4. **A confirmed booking wins over an external event that overlaps it.**
   The event isn't imported as a block, and a **sync issue** is raised for
   review instead of anything changing silently:
   - `GET /api/calendar-sync/issues` lists open issues;
   - the count is `sync.openIssues` on `GET /api/google/connection`.

   The issue resolves itself (`resolution: "gone"`) once the event no
   longer overlaps (moved, shortened, deleted) or a full list no longer
   contains it. It can also be dismissed with
   `POST /api/calendar-sync/issues/:id/dismiss`. An event that's still
   overlapping after a booking is cancelled stays un-imported until the
   event next changes in Google or the next full list runs.

## Why there's no loop

- **Etags:** the app stores the etag of every event it writes. When inbound
  sync sees one of the app's events, it compares etags. Its own write comes
  back with the stored etag and causes nothing. Only a change made in Google
  has a different one.
- **One-way kinds:** booking events are only ever written by the app, and
  external events are only ever read by it.
- **Collapsed changes:** rapid changes to a booking become one push of the
  latest version (`changeSeq`), and each booking has one event per calendar
  with an id fixed before the first insert. Retries and repeats never add a
  second event.

## What is never synced

- **No guest personal data goes to Google.** Booking events carry the
  property, booking id, nights, guest count and total.
- **Nothing personal comes back.** Blocks keep a Google event id and dates
  only; titles, descriptions, locations and attendees aren't stored.
