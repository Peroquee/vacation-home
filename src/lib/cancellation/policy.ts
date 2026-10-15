/**
 * The cancellation policy (GitLab #116), as pure functions over plain data.
 * Client-safe.
 *
 * The owner's rule: when a guest cancels, the deposit is kept if the
 * property says so (the default) and anything paid beyond it is refunded in
 * full - no fee, no tiers by days. Nothing paid, nothing refunded; the dates
 * are freed either way. The owner cancelling always refunds in full.
 */

/** The policy a booking is under, kept on it when the guest agrees to it. */
export type CancellationTerms = {
  depositNonRefundable: boolean;
  /** The deposit as it was when the guest agreed: what may be kept. */
  depositAmountMinor: number;
};

export type GuestRefund = {
  /** What the guest has paid, less what was refunded already. */
  receivedMinor: number;
  /** Kept as the deposit. */
  retainedMinor: number;
  refundMinor: number;
};

/** What a guest who cancels gets back of `receivedMinor` under `terms`. */
export function guestRefund(terms: CancellationTerms, receivedMinor: number): GuestRefund {
  const received = Math.max(0, receivedMinor);
  const retained = terms.depositNonRefundable
    ? Math.min(received, Math.max(0, terms.depositAmountMinor))
    : 0;
  return { receivedMinor: received, retainedMinor: retained, refundMinor: received - retained };
}
