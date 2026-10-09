"use client";

/**
 * Toasts for success and failure feedback. The `<Toaster />` is mounted once
 * in the root layout; call these from client components.
 *
 * Keep toasts for the outcome of something the user just did. Errors that
 * stop a page from showing anything belong in an `<ErrorState />` instead.
 */
import { toast } from "sonner";

export { toast };

/** "Booking saved", "Block removed". */
export function toastSuccess(message: string, description?: string) {
  toast.success(message, { description });
}

/**
 * Reports a failed action under the caller's translated `message`, with the
 * error's own message, when it has one, as the description.
 */
export function toastError(error: unknown, message: string) {
  const detail =
    error instanceof Error && error.message
      ? error.message
      : typeof error === "string"
        ? error
        : undefined;
  toast.error(message, { description: detail });
}
