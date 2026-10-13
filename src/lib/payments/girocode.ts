/**
 * The GiroCode: an EPC QR code (EPC069-12, version 002) that German and
 * other European banking apps scan to fill in a SEPA credit transfer -
 * beneficiary, IBAN, amount and reference - so the guest types nothing.
 * Euro only, by the standard. Server-side (the QR code is drawn here).
 */
import QRCode from "qrcode";

import { formatReference } from "@/lib/booking-requests/values";

export type TransferDetails = {
  accountHolder: string;
  iban: string;
  bic: string | null;
  /** In cents; the GiroCode is for euros only. */
  amountMinor: number;
  currency: string;
  /** The text on the guest's transfer, so the owner can match it. */
  remittance: string;
};

/** The remittance text for a booking's transfers: its reference, as the guest reads it. */
export function remittanceFor(reference: string): string {
  return `Booking ${formatReference(reference)}`;
}

/** "350.00" for 35000 cents: no thousands separators, a full stop. */
function euros(amountMinor: number): string {
  return `${Math.floor(amountMinor / 100)}.${String(amountMinor % 100).padStart(2, "0")}`;
}

/**
 * The EPC QR payload, or null when there cannot be one: not euros, or an
 * amount outside 0.01 to 999,999,999.99. Lines, in order: service tag,
 * version, character set (1 = UTF-8), identification, BIC (optional in
 * version 002), beneficiary name, IBAN, amount, purpose, structured
 * reference, unstructured remittance. Trailing empty lines are left off.
 */
export function epcPayload(details: TransferDetails): string | null {
  if (details.currency !== "EUR") return null;
  if (details.amountMinor < 1 || details.amountMinor > 99_999_999_999) return null;
  const lines = [
    "BCD",
    "002",
    "1",
    "SCT",
    details.bic ?? "",
    details.accountHolder.slice(0, 70),
    details.iban,
    `EUR${euros(details.amountMinor)}`,
    "",
    "",
    details.remittance.slice(0, 140),
  ];
  return lines.join("\n");
}

/** The GiroCode as an SVG document, error correction M as the standard asks. */
export function girocodeSvg(payload: string): Promise<string> {
  return QRCode.toString(payload, { type: "svg", errorCorrectionLevel: "M", margin: 4 });
}
