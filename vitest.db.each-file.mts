import pg from "pg";
import { beforeAll, inject } from "vitest";

/**
 * Runs before each database test file: every file starts from the database
 * the migrations produce, whatever the files before it left behind. The
 * files share one database and run one at a time, and each cleans up only
 * the tables it knows about, so without this a table added later (a new
 * foreign key, a new worker queue) breaks the files that run after it.
 *
 * - Every table but the migrations' own and `categories` is truncated.
 *   TRUNCATE fires no row triggers, so the append-only audit trail allows
 *   it; CASCADE takes along whatever references a truncated table.
 * - `categories` holds the system categories the migrations seed, which may
 *   be hidden or renamed but never deleted: user categories are deleted and
 *   the system ones restored to how the migrations left them.
 */
beforeAll(async () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query<{ name: string }>(
      `SELECT tablename AS name FROM pg_tables
       WHERE schemaname = 'public' AND tablename NOT IN ('_prisma_migrations', 'categories')`,
    );
    const tables = rows.map(({ name }) => `"public"."${name.replaceAll('"', '""')}"`);
    await client.query("BEGIN");
    if (tables.length > 0) {
      await client.query(`TRUNCATE ${tables.join(", ")} RESTART IDENTITY CASCADE`);
    }
    await client.query("DELETE FROM categories WHERE NOT is_system");
    for (const { systemKey, name, color } of inject("systemCategories")) {
      await client.query(
        "UPDATE categories SET name = $2, color = $3, hidden = false WHERE system_key = $1",
        [systemKey, name, color],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
});
