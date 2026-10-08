/**
 * `npm run seed`: replaces the app's data with the demo data planned in
 * src/lib/seed/plan.ts - the same content every run (the ids are new each
 * time). Also run by `prisma migrate reset`. Transactions are cleared too;
 * categories, users and the audit trail stay. Development databases only
 * (see src/lib/seed/guard.ts). Signed-in users and the audit trail are left
 * alone.
 */
import { loadEnvConfig } from "@next/env";

import { toUtcDate } from "../src/lib/calendar-date";
import { seedRefusal } from "../src/lib/seed/guard";
import { buildSeedPlan } from "../src/lib/seed/plan";

// The same env files `next dev` reads.
loadEnvConfig(process.cwd(), true);

async function main() {
  // Checked before anything loads @/env, which would validate the rest.
  const refusal = seedRefusal(process.env.DATABASE_URL, process.env.NODE_ENV);
  if (refusal) {
    console.error(`Refusing to seed: ${refusal}.`);
    process.exit(1);
  }

  const { db } = await import("../src/lib/db");
  const { toDbSource } = await import("../src/lib/bookings/service");
  const plan = buildSeedPlan();

  await db.$transaction(
    async (tx) => {
      await tx.transaction.deleteMany();
      await tx.booking.deleteMany();
      await tx.block.deleteMany();
      await tx.guest.deleteMany();
      await tx.property.deleteMany();

      // Row by row, to key each id to its plan entry: a bulk insert's
      // RETURNING order is not guaranteed, and guest names may repeat.
      const propertyIds = new Map<string, string>();
      for (const { key, ...property } of plan.properties) {
        propertyIds.set(key, (await tx.property.create({ data: property })).id);
      }
      const guestIds = new Map<string, string>();
      for (const { key, ...guest } of plan.guests) {
        guestIds.set(key, (await tx.guest.create({ data: guest })).id);
      }

      await tx.block.createMany({
        data: plan.blocks.map(({ property, startDate, endDate, ...block }) => ({
          ...block,
          propertyId: propertyIds.get(property)!,
          startDate: toUtcDate(startDate),
          endDate: toUtcDate(endDate),
        })),
      });
      // One by one rather than createMany, so a planning mistake surfaces as
      // the database's overlap refusal for that booking.
      for (const { property, guest, checkIn, checkOut, source, ...booking } of plan.bookings) {
        await tx.booking.create({
          data: {
            ...booking,
            propertyId: propertyIds.get(property)!,
            guestId: guestIds.get(guest)!,
            checkIn: toUtcDate(checkIn),
            checkOut: toUtcDate(checkOut),
            source: toDbSource(source),
          },
        });
      }
    },
    { timeout: 60_000 },
  );

  const byStatus = Object.groupBy(plan.bookings, (b) => b.status);
  console.log(
    `Seeded ${plan.properties.length} properties, ${plan.guests.length} guests, ` +
      `${plan.bookings.length} bookings (${byStatus.confirmed?.length ?? 0} confirmed, ` +
      `${byStatus.inquiry?.length ?? 0} inquiries, ${byStatus.cancelled?.length ?? 0} cancelled) ` +
      `and ${plan.blocks.length} blocks.`,
  );
  await db.$disconnect();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
