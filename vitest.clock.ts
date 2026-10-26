/**
 * Runs a test suite as if it were another moment (GitLab #147): with
 * `TEST_NOW` set to an ISO instant, `Date` starts there and moves on as real
 * time does. Tests that depend on the real clock show up this way, e.g.
 *
 *   TEST_NOW=2027-02-15T12:00:00Z npm test
 *   TEST_NOW=2026-10-31T23:30:00Z npm run test:db
 *
 * Only `Date` is faked, so timers, promises and the database client run as
 * usual. A test that fakes the clock itself (vi.useFakeTimers) takes over
 * for as long as it does. The database's own now() is not shifted: tests
 * compare times the app writes from JS (GitLab #134).
 */
import { vi } from "vitest";

const at = process.env.TEST_NOW;
if (at) {
  const now = new Date(at);
  if (Number.isNaN(now.getTime())) throw new Error(`TEST_NOW is not an instant: ${at}`);
  // Ticking every millisecond, like the real clock: writes in a row get
  // different times, as tests ordering by time expect.
  vi.useFakeTimers({ toFake: ["Date"], now, shouldAdvanceTime: true, advanceTimeDelta: 1 });
}
