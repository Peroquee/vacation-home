/**
 * The Prisma client. Server-side only.
 *
 * One instance per server process. In development Next re-evaluates modules on
 * every hot reload, and a fresh client each time would open a fresh connection
 * pool until PostgreSQL runs out of connections. The instance is therefore
 * parked on `globalThis`, which survives reloads. Production evaluates this
 * module once, so it never needs the cache.
 *
 * The client is created on first use rather than on import: `next build`
 * imports route modules to collect page data, and must not need DATABASE_URL
 * to do so.
 */
import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";

import { env } from "@/env";
import { type Prisma, PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as typeof globalThis & {
  prisma?: PrismaClient;
};

function client(): PrismaClient {
  if (globalForPrisma.prisma) return globalForPrisma.prisma;

  const created = new PrismaClient({
    adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
  });

  // NODE_ENV is one of the two documented literal reads - see eslint.config.mjs.
  // eslint-disable-next-line no-restricted-properties
  if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = created;
  return created;
}

let instance: PrismaClient | undefined;

/** Use exactly like a `PrismaClient`; it connects on first query. */
export const db = new Proxy({} as PrismaClient, {
  get: (_target, name) => {
    instance ??= client();
    const value = Reflect.get(instance, name, instance);
    // Methods such as `$transaction` depend on `this`.
    return typeof value === "function" ? value.bind(instance) : value;
  },
});

/**
 * `db` itself, or the client inside a `db.$transaction(async (tx) => ...)`.
 * Functions that may run inside a caller's transaction take one of these.
 */
export type DbClient = Prisma.TransactionClient | typeof db;
