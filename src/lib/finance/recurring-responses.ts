import { fieldError, notFound } from "@/lib/api";

import { type RuleWrite, toDto } from "./recurring";

export function ruleResponse(result: RuleWrite, created = false): Response {
  if ("rule" in result) {
    const body = toDto(result.rule);
    return created
      ? Response.json(body, {
          status: 201,
          headers: { Location: `/api/recurring-expenses/${result.rule.id}` },
        })
      : Response.json(body);
  }
  return result.error === "not_found"
    ? notFound("Recurring expense")
    : fieldError(result.field, result.message);
}
