import { describe, expect, it } from "vitest";

import { appRoutes, PUBLIC_ROUTES } from "../../e2e/app-routes";
import { decideAccess, isPublicPath, isPublicSitePath } from "./access";

const routes = appRoutes();

describe("the routes reachable without a session", () => {
  it("finds the app's routes", () => {
    // A guard against the walk silently finding nothing.
    expect(routes.length).toBeGreaterThan(50);
    expect(routes.map((r) => r.route)).toContain("/settings");
    expect(routes.map((r) => r.route)).toContain("/api/properties/[id]");
  });

  it("are exactly the allow-listed ones", () => {
    const open = routes.filter((r) => isPublicPath(r.path)).map((r) => r.route);
    expect(open.sort()).toEqual(PUBLIC_ROUTES);
  });

  it("send every other page to sign-in and answer every other API call with a 401", () => {
    for (const route of routes.filter((r) => !PUBLIC_ROUTES.includes(r.route))) {
      const decision = decideAccess({ pathname: route.path, search: "" }, false);
      expect({ route: route.route, kind: decision.kind }).toEqual({
        route: route.route,
        kind: route.kind === "api" ? "unauthorized" : "sign-in",
      });
    }
  });

  it("keep the public booking site's routes in its own folders", () => {
    // Its pages render in the (public) group's layout, without the app
    // shell; its API lives under api/public. Anything else under these
    // prefixes would be public by accident.
    for (const route of routes.filter((r) => isPublicSitePath(r.path))) {
      expect(route.file).toMatch(/^src\/app\/(\(public\)\/|api\/public\/|robots\.ts$)/);
    }
    for (const route of routes.filter((r) =>
      /^src\/app\/(\(public\)|api\/public)\//.test(r.file),
    )) {
      expect(isPublicSitePath(route.path), route.route).toBe(true);
    }
  });
});
