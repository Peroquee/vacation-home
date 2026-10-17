// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EMPTY_LEGAL, TEMPLATE_MARKER } from "@/lib/legal/legal";
import { COMPLETE_LEGAL } from "@/lib/legal/testing/complete-legal";

import { GoLiveChecklist } from "./go-live-checklist";
import { LegalSection } from "./legal-section";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/components/toast", () => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
// The fixture's module writes through Prisma; the test only needs its data.
vi.mock("@/lib/db", () => ({ db: {} }));

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => vi.clearAllMocks());

const templates = { de: `${TEMPLATE_MARKER}\n## Vorlage`, en: `${TEMPLATE_MARKER}\n## Template` };
const lastBody = () => JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body));

describe("LegalSection", () => {
  it("fills in the imprint, sending the whole set", async () => {
    fetchMock.mockResolvedValue(Response.json(EMPTY_LEGAL));
    render(<LegalSection legal={EMPTY_LEGAL} templates={templates} />);
    const user = userEvent.setup();
    expect(screen.getAllByText("Not filled in yet")).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Edit imprint" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "Ada Owner");
    await user.type(within(dialog).getByLabelText("Address"), "Seestraße 1");
    await user.type(within(dialog).getByLabelText("Email"), "owner@example.test");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("/api/legal");
    expect(lastBody()).toEqual({
      ...EMPTY_LEGAL,
      imprintName: "Ada Owner",
      imprintAddress: "Seestraße 1",
      imprintEmail: "owner@example.test",
      imprintPhone: "",
      imprintVatId: "",
      imprintExtra: "",
    });
  });

  it("starts an empty privacy policy from the template, in both languages", async () => {
    fetchMock.mockResolvedValue(Response.json(EMPTY_LEGAL));
    render(<LegalSection legal={EMPTY_LEGAL} templates={templates} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Edit privacy policy" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("note")).toHaveTextContent("not legal advice");
    expect(within(dialog).getByLabelText("German")).toHaveValue(templates.de);
    expect(within(dialog).getByLabelText("English")).toHaveValue(templates.en);

    await user.clear(within(dialog).getByLabelText("English"));
    await user.type(within(dialog).getByLabelText("English"), "Mine");
    await user.click(
      within(dialog).getByRole("button", {
        name: "Start the English text again from the template",
      }),
    );
    expect(within(dialog).getByLabelText("English")).toHaveValue(templates.en);
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(lastBody()).toMatchObject({
      privacyPolicyDe: templates.de,
      privacyPolicyEn: templates.en,
    });
  });

  it("shows why a required part cannot be emptied", async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        {
          error: {
            code: "validation_failed",
            message: "The request has invalid fields.",
            fields: { privacyPolicyDe: ["is required while a property is listed"] },
          },
        },
        { status: 422 },
      ),
    );
    render(<LegalSection legal={COMPLETE_LEGAL} templates={templates} />);
    const user = userEvent.setup();
    expect(screen.getByText("German and English")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit privacy policy" }));
    const dialog = screen.getByRole("dialog");
    await user.clear(within(dialog).getByLabelText("German"));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(
      await within(dialog).findByText("German is required while a property is listed"),
    ).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("GoLiveChecklist", () => {
  const items = () => screen.getAllByRole("listitem").map((item) => item.textContent);

  it("names what is missing before a property can be listed", async () => {
    render(
      await GoLiveChecklist({
        legal: { ...COMPLETE_LEGAL, privacyPolicyEn: null },
        withoutBankDetails: [],
      }),
    );
    expect(
      screen.getByText("Until the legal pages are filled in, no property can be listed."),
    ).toBeInTheDocument();
    expect(items()).toEqual([
      "Done: Imprint: name, address and email",
      "Done: Privacy policy in German",
      "Missing: Privacy policy in English",
    ]);
  });

  it("warns, without holding back, about the template note and missing bank details", async () => {
    render(
      await GoLiveChecklist({
        legal: { ...COMPLETE_LEGAL, privacyPolicyDe: `${TEMPLATE_MARKER}\nText` },
        withoutBankDetails: ["Lake House"],
      }),
    );
    expect(screen.getByText(/has what it needs/)).toBeInTheDocument();
    expect(items().slice(3)).toEqual([
      "Warning: The privacy policy still has the template's note: have it checked, then remove the note.",
      "Warning: Lake House: no bank details, so guests are not told where to transfer.",
    ]);
    expect(screen.getByRole("link", { name: /Lake House/ })).toHaveAttribute(
      "href",
      "#bank-details",
    );
  });
});
