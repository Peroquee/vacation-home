/**
 * Documents on recurring costs (GitLab #130) against a real PostgreSQL and
 * a temporary receipts folder: the same checks, serving and cleanup as a
 * transaction's receipts, and the payments listed with their receipts.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { DELETE as deleteAttachment, GET as getFile } from "@/app/api/attachments/[id]/route";
import { DELETE as deleteRule, GET as getRule } from "@/app/api/recurring-expenses/[id]/route";
import {
  GET as listDocuments,
  POST as upload,
} from "@/app/api/recurring-expenses/[id]/attachments/route";
import { GET as listPayments } from "@/app/api/recurring-expenses/[id]/payments/route";
import { toUtcDate } from "@/lib/calendar-date";
import { db } from "@/lib/db";

import { addReceipt, readReceiptFile, removeOrphanFiles } from "./receipts";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const GET = new Request("http://test");
const pdf = new TextEncoder().encode("%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n");
const unique = () => new TextEncoder().encode(`%PDF-1.7\n% ${crypto.randomUUID()}\n`);

function form(name: string, bytes: Uint8Array<ArrayBuffer>) {
  const data = new FormData();
  data.set("file", new File([bytes], name, { type: "application/pdf" }));
  return new Request("http://test/api", { method: "POST", body: data });
}

let ruleId: string;
let propertyId: string;
let categoryId: string;

beforeEach(async () => {
  const tag = crypto.randomUUID().slice(0, 8);
  propertyId = (
    await db.property.create({
      data: { name: `Lake ${tag}`, timezone: "Europe/Berlin", currency: "EUR", color: "#0f766e" },
    })
  ).id;
  categoryId = (
    await db.category.create({
      data: { name: `Insurance ${tag}`, type: "expense", color: "#64748b" },
    })
  ).id;
  ruleId = (
    await db.recurringExpense.create({
      data: {
        propertyId,
        categoryId,
        amountMinor: 48_000,
        currency: "EUR",
        interval: "annual",
        startDate: toUtcDate("2025-01-01"),
        description: "Building insurance",
      },
    })
  ).id;
});

afterAll(() => db.$disconnect());

describe("uploading to a rule", () => {
  it("stores, lists, serves and removes a document", async () => {
    const response = await upload(form("Police.pdf", pdf), ctx(ruleId));
    expect(response.status).toBe(201);
    const document = await response.json();
    expect(document).toMatchObject({
      recurringExpenseId: ruleId,
      transactionId: null,
      fileName: "Police.pdf",
      mediaType: "application/pdf",
    });
    expect(await (await listDocuments(GET, ctx(ruleId))).json()).toEqual([document]);
    // The rule counts it, for the list's paperclip.
    expect((await (await getRule(GET, ctx(ruleId))).json()).documents).toBe(1);

    const file = await getFile(GET, ctx(document.id));
    expect(file.status).toBe(200);
    expect(file.headers.get("content-disposition")).toBe("attachment; filename*=UTF-8''Police.pdf");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(pdf);

    expect((await deleteAttachment(GET, ctx(document.id))).status).toBe(204);
    expect(await (await listDocuments(GET, ctx(ruleId))).json()).toEqual([]);
    expect((await getFile(GET, ctx(document.id))).status).toBe(404);
  });

  it("refuses the wrong type, an oversize file and a 21st, like receipts", async () => {
    const html = await upload(
      form("contract.pdf", new TextEncoder().encode("<html><script>alert(1)</script>")),
      ctx(ruleId),
    );
    expect(html.status).toBe(422);
    expect((await html.json()).error.fields.file).toEqual([
      "must be a PDF, JPEG, PNG, WebP or HEIC file",
    ]);

    // Just over 10 MB, a PDF by its start.
    const oversize = new Uint8Array(10 * 1024 * 1024 + 1);
    oversize.set(pdf);
    const big = await upload(form("big.pdf", oversize), ctx(ruleId));
    expect(big.status).toBe(422);
    expect((await big.json()).error.fields.file).toEqual(["is larger than 10 MB"]);

    for (let i = 0; i < 20; i++) {
      expect((await upload(form(`statement ${i}.pdf`, pdf), ctx(ruleId))).status).toBe(201);
    }
    const extra = await upload(form("one more.pdf", pdf), ctx(ruleId));
    expect(extra.status).toBe(422);
    expect((await extra.json()).error.fields.file).toEqual([
      "is one too many: at most 20 documents per recurring expense",
    ]);
    // Twenty rows, one file: identical uploads share it.
    const rows = await db.transactionAttachment.findMany({ where: { recurringExpenseId: ruleId } });
    expect(rows).toHaveLength(20);
    expect(new Set(rows.map((r) => r.sha256)).size).toBe(1);
  });

  it("refuses an unknown rule and a malformed id", async () => {
    expect((await upload(form("a.pdf", pdf), ctx(crypto.randomUUID()))).status).toBe(404);
    expect((await upload(form("a.pdf", pdf), ctx("lake"))).status).toBe(404);
    expect((await listDocuments(GET, ctx("lake"))).status).toBe(404);
  });
});

describe("the database", () => {
  it("lets a file belong to exactly one: a transaction or a rule", async () => {
    const transactionId = (
      await db.transaction.create({
        data: {
          propertyId,
          currency: "EUR",
          type: "expense",
          categoryId,
          amountMinor: 100,
          date: toUtcDate("2026-07-14"),
        },
      })
    ).id;
    const row = {
      fileName: "a.pdf",
      mediaType: "application/pdf",
      size: 8,
      sha256: "a".repeat(64),
    };
    await expect(db.transactionAttachment.create({ data: row })).rejects.toThrow(
      /transaction_attachments_one_owner/,
    );
    await expect(
      db.transactionAttachment.create({
        data: { ...row, transactionId, recurringExpenseId: ruleId },
      }),
    ).rejects.toThrow(/transaction_attachments_one_owner/);
  });

  it("drops a rule's documents with the rule; the cleanup removes the files", async () => {
    const bytes = unique();
    const document = await (await upload(form("Vertrag.pdf", bytes), ctx(ruleId))).json();
    const { sha256 } = await db.transactionAttachment.findUniqueOrThrow({
      where: { id: document.id },
    });
    expect((await deleteRule(GET, ctx(ruleId))).status).toBe(204);
    expect(await db.transactionAttachment.count({ where: { id: document.id } })).toBe(0);

    await removeOrphanFiles({ now: new Date(Date.now() + 2 * 60 * 60_000) });
    await expect(readReceiptFile(sha256)).rejects.toThrow();
  });

  it("keeps a file a rule shares with a receipt", async () => {
    const bytes = unique();
    const transactionId = (
      await db.transaction.create({
        data: {
          propertyId,
          currency: "EUR",
          type: "expense",
          categoryId,
          amountMinor: 100,
          date: toUtcDate("2026-07-14"),
        },
      })
    ).id;
    const document = await (await upload(form("Rechnung.pdf", bytes), ctx(ruleId))).json();
    await addReceipt(transactionId, { name: "Rechnung.pdf", bytes });
    const { sha256 } = await db.transactionAttachment.findUniqueOrThrow({
      where: { id: document.id },
    });

    await deleteAttachment(GET, ctx(document.id));
    await removeOrphanFiles({ now: new Date(Date.now() + 2 * 60 * 60_000) });
    await expect(readReceiptFile(sha256)).resolves.toBeTruthy();
  });
});

describe("GET /api/recurring-expenses/:id/payments", () => {
  it("lists the rule's payments newest first, with their receipt counts", async () => {
    const payment = async (date: string) =>
      (
        await db.transaction.create({
          data: {
            propertyId,
            currency: "EUR",
            type: "expense",
            categoryId,
            amountMinor: 48_000,
            date: toUtcDate(date),
            recurringExpenseId: ruleId,
          },
        })
      ).id;
    const older = await payment("2025-01-01");
    const newer = await payment("2026-01-01");
    await db.transactionAttachment.create({
      data: {
        transactionId: older,
        fileName: "2025.pdf",
        mediaType: "application/pdf",
        size: 8,
        sha256: "b".repeat(64),
      },
    });

    expect(await (await listPayments(GET, ctx(ruleId))).json()).toEqual({
      items: [
        { id: newer, date: "2026-01-01", amountMinor: 48_000, currency: "EUR", receipts: 0 },
        { id: older, date: "2025-01-01", amountMinor: 48_000, currency: "EUR", receipts: 1 },
      ],
      total: 2,
    });
    expect((await listPayments(GET, ctx(crypto.randomUUID()))).status).toBe(404);
  });
});
