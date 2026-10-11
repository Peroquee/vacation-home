// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { toastSuccess } from "@/components/toast";
import { Button } from "@/components/ui/button";
import type { PropertyDto } from "@/lib/properties/service";

import { PropertyFormDialog } from "./property-form-dialog";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/components/toast", () => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => vi.clearAllMocks());

const property: PropertyDto = {
  id: "6f1c2a52-6f0c-4c4e-9d43-3a0e4f1b9a11",
  name: "Casa Azul",
  address: null,
  timezone: "Europe/Lisbon",
  currency: "EUR",
  defaultNightlyRateMinor: 18000,
  defaultCleaningFeeMinor: 6000,
  color: "#0f766e",
  slug: null,
  publiclyListed: false,
  archived: false,
  archivedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function renderDialog(props: { property?: PropertyDto } = {}) {
  render(<PropertyFormDialog {...props} trigger={<Button>Open</Button>} />);
  return userEvent.setup();
}

function lastBody() {
  return JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body));
}

describe("PropertyFormDialog", () => {
  it("creates a property, sending amounts in minor units", async () => {
    fetchMock.mockResolvedValue(Response.json({ ...property }, { status: 201 }));
    const user = renderDialog();

    await user.click(screen.getByRole("button", { name: "Open" }));
    await user.type(screen.getByLabelText("Name"), "Casa Azul");
    await user.selectOptions(screen.getByLabelText("Timezone"), "Europe/Lisbon");
    await user.type(screen.getByLabelText("Nightly rate"), "180.5");
    await user.type(screen.getByLabelText("Cleaning fee"), "0.29");
    await user.click(screen.getByRole("button", { name: "Add property" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/properties",
      expect.objectContaining({ method: "POST" }),
    );
    expect(lastBody()).toMatchObject({
      name: "Casa Azul",
      timezone: "Europe/Lisbon",
      currency: "EUR",
      defaultNightlyRateMinor: 18050,
      defaultCleaningFeeMinor: 29,
    });
    expect(toastSuccess).toHaveBeenCalledWith("Property added");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("edits a property with every field, so a currency change restates the defaults", async () => {
    fetchMock.mockResolvedValue(Response.json(property));
    const user = renderDialog({ property });

    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByLabelText("Nightly rate")).toHaveValue("180.00");
    await user.selectOptions(screen.getByLabelText("Currency"), "USD");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/properties/${property.id}`,
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(lastBody()).toMatchObject({
      currency: "USD",
      defaultNightlyRateMinor: 18000,
      defaultCleaningFeeMinor: 6000,
    });
  });

  it("lists a property on the public site under its slug", async () => {
    fetchMock.mockResolvedValue(Response.json(property));
    const user = renderDialog({ property });

    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(
      screen.getByRole("checkbox", { name: "Show on the public booking site" }),
    ).not.toBeChecked();
    await user.type(screen.getByLabelText("Web address"), "casa-azul");
    expect(screen.getByText(/Its page: \/stay\/casa-azul\./)).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Show on the public booking site" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(lastBody()).toMatchObject({ slug: "casa-azul", publiclyListed: true });
  });

  it("shows why a property cannot be listed next to the switch", async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        {
          error: {
            code: "validation_failed",
            message: "The request has invalid fields.",
            fields: { publiclyListed: ["needs a web address (slug) first"] },
          },
        },
        { status: 422 },
      ),
    );
    const user = renderDialog({ property });

    await user.click(screen.getByRole("button", { name: "Open" }));
    await user.click(screen.getByRole("checkbox", { name: "Show on the public booking site" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText("Show on the public booking site needs a web address (slug) first"),
    ).toBeInTheDocument();
  });

  it("refuses an amount it would have to round, without calling the API", async () => {
    const user = renderDialog({ property });

    await user.click(screen.getByRole("button", { name: "Open" }));
    await user.clear(screen.getByLabelText("Nightly rate"));
    await user.type(screen.getByLabelText("Nightly rate"), "180.555");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(/Nightly rate must be an amount/)).toBeInTheDocument();
    expect(screen.getByLabelText("Nightly rate")).toHaveAttribute("aria-invalid", "true");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the API's per-field messages next to the fields and stays open", async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        {
          error: {
            code: "validation_failed",
            message: "The request has invalid fields.",
            fields: { name: ["is required"] },
          },
        },
        { status: 422 },
      ),
    );
    const user = renderDialog();

    await user.click(screen.getByRole("button", { name: "Open" }));
    await user.click(screen.getByRole("button", { name: "Add property" }));

    expect(await screen.findByText("Name is required")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});
