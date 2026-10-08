/**
 * Runs before every test file. The jest-dom matchers (`toBeInTheDocument`,
 * ...) only matter to component tests, but registering them is cheap.
 */
import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library only unmounts automatically when test globals are enabled,
// which they are not here.
afterEach(cleanup);
