import { describe, expect, it } from "vitest";

import { seedRefusal } from "@/lib/seed/guard";

const dev = "postgresql://vacation:vacation@localhost:5433/vacation_home";

describe("seedRefusal", () => {
  it("allows the local development database", () => {
    expect(seedRefusal(dev, "development")).toBeNull();
    expect(seedRefusal(dev, undefined)).toBeNull();
    expect(
      seedRefusal("postgresql://vacation:vacation@db:5432/vacation_home", undefined),
    ).toBeNull();
  });

  it("refuses production, remote hosts and test databases", () => {
    expect(seedRefusal(dev, "production")).toMatch(/production/);
    expect(seedRefusal("postgresql://u:p@db.example.com/vacation_home", undefined)).toMatch(
      /not local/,
    );
    expect(seedRefusal("postgresql://u:p@localhost/vacation_home_test", undefined)).toMatch(
      /test database/,
    );
    expect(seedRefusal("postgresql://u:p@localhost/vacation_home_e2e", undefined)).toMatch(
      /test database/,
    );
    expect(seedRefusal(undefined, undefined)).toMatch(/not set/);
    // Looks local, but the driver would connect where the parameter says.
    expect(seedRefusal(`${dev}?host=prod.example.com`, undefined)).toMatch(/overrides/);
    expect(seedRefusal(`${dev}?dbname=vacation_home_test`, undefined)).toMatch(/overrides/);
    expect(seedRefusal("not a url", undefined)).toMatch(/not a valid URL/);
  });
});
