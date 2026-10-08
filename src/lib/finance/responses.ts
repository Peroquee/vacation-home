import { fieldError, notFound } from "@/lib/api";

import { toDto, type TransactionWrite } from "./transactions";

export function transactionResponse(result: TransactionWrite, created = false): Response {
  if ("transaction" in result) {
    const body = toDto(result.transaction);
    return created
      ? Response.json(body, {
          status: 201,
          headers: { Location: `/api/transactions/${result.transaction.id}` },
        })
      : Response.json(
          result.detached
            ? {
                ...body,
                warning: {
                  code: "detached_from_booking",
                  message:
                    "This entry was created from its booking. After this edit it no longer follows the booking's changes.",
                },
              }
            : body,
        );
  }
  return result.error === "not_found"
    ? notFound("Transaction")
    : fieldError(result.field, result.message);
}
