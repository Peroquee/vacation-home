/**
 * Accounts allowed to sign in, managed in the app (GitLab #122), against a
 * real PostgreSQL: added ones may sign in, the fixed ones stay, removing
 * one ends its sessions and is audited, and nobody removes themselves.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";

import {
  addAllowedAccount,
  isAllowedEmail,
  listAllowedAccounts,
  removeAllowedAccount,
} from "./allowed-emails";

const OWNER = { id: "", email: "owner@example.test" };

beforeEach(async () => {
  await db.session.deleteMany();
  await db.allowedAccount.deleteMany();
  await db.user.deleteMany();
  OWNER.id = (await db.user.create({ data: { name: "Owner", email: OWNER.email } })).id;
});

afterAll(async () => {
  await db.$disconnect();
});

describe("allowed accounts", () => {
  it("lets an added account in, in any case, next to the fixed ones", async () => {
    expect(await isAllowedEmail("friend@example.test")).toBe(false);
    const added = await addAllowedAccount(" Friend@Example.TEST ", OWNER.id);
    expect(added).toMatchObject({ email: "friend@example.test", fixed: false });
    expect(await isAllowedEmail("FRIEND@example.test")).toBe(true);
    expect(await isAllowedEmail("owner@example.test")).toBe(true);
    expect((await listAllowedAccounts()).map((a) => [a.email, a.fixed])).toEqual([
      ["owner@example.test", true],
      ["friend@example.test", false],
    ]);
  });

  it("refuses one that may sign in already, fixed or added", async () => {
    expect(await addAllowedAccount("OWNER@example.test", OWNER.id)).toBe("exists");
    await addAllowedAccount("friend@example.test", OWNER.id);
    expect(await addAllowedAccount("friend@example.test", OWNER.id)).toBe("exists");
  });

  it("removed, ends its sessions at once and is in the audit trail without the address", async () => {
    const added = await addAllowedAccount("friend@example.test", OWNER.id);
    if (added === "exists") throw new Error("exists");
    const friend = await db.user.create({ data: { name: "Friend", email: "Friend@example.test" } });
    await db.session.create({
      data: {
        sessionToken: "friend-token",
        userId: friend.id,
        expires: new Date(Date.now() + 86_400_000),
      },
    });
    await db.session.create({
      data: {
        sessionToken: "owner-token",
        userId: OWNER.id,
        expires: new Date(Date.now() + 86_400_000),
      },
    });

    expect(await removeAllowedAccount(added.id!, OWNER)).toBe("removed");
    expect(await isAllowedEmail("friend@example.test")).toBe(false);
    expect(await db.session.findMany({ select: { sessionToken: true } })).toEqual([
      { sessionToken: "owner-token" },
    ]);
    const audit = await db.auditEvent.findMany({
      where: { subjectType: "allowed_account", subjectId: added.id! },
      orderBy: { occurredAt: "asc" },
    });
    expect(audit.map((e) => [e.action, e.subjectId, e.actorUserId])).toEqual([
      ["access.added", added.id, OWNER.id],
      ["access.removed", added.id, OWNER.id],
    ]);
    expect(JSON.stringify(audit)).not.toContain("friend@");
    expect(await removeAllowedAccount(added.id!, OWNER)).toBe("not_found");
  });

  it("never removes the caller's own account", async () => {
    const added = await addAllowedAccount("partner@example.test", OWNER.id);
    if (added === "exists") throw new Error("exists");
    expect(await removeAllowedAccount(added.id!, { id: "x", email: "Partner@example.test" })).toBe(
      "yourself",
    );
    expect(await isAllowedEmail("partner@example.test")).toBe(true);
  });

  it("are kept in lower case by the database too", async () => {
    await expect(
      db.allowedAccount.create({ data: { email: "Upper@example.test" } }),
    ).rejects.toThrow();
  });
});
