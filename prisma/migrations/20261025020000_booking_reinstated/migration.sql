-- Reinstating a cancelled or expired booking is an action of its own
-- (GitLab #135), recorded like the others. It mails no one.
ALTER TYPE "booking_event_kind" ADD VALUE 'reinstated';
