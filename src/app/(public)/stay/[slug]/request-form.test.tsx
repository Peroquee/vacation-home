// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import messages from "../../../../../messages/en-GB.json";
import { RequestForm } from "./request-form";

const solvedChallenge = vi.hoisted(() => vi.fn());
vi.mock("@/lib/booking-requests/solve", () => ({ solvedChallenge }));

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

let solved = 0;
beforeEach(() => {
  solved = 0;
  solvedChallenge.mockImplementation(async () => ({
    challenge: { parameters: { n: ++solved }, signature: `sig-${solved}` },
    solution: { counter: 1, derivedKey: "ab" },
  }));
  // The form waits until a challenge is a few seconds old; let that be so.
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

const SENT = {
  reference: "K7QD9MXA",
  checkIn: "2026-08-10",
  checkOut: "2026-08-14",
  nights: 4,
  guestCount: 2,
  totalAmountMinor: 45_000,
  currency: "EUR",
};

const PRICING = {
  currency: "EUR",
  defaultNightlyRateMinor: 10_000,
  defaultCleaningFeeMinor: 5_000,
  seasons: [],
  discounts: [],
  touristTax: null,
};

function renderForm(pricing: React.ComponentProps<typeof RequestForm>["pricing"] = PRICING) {
  const onSent = vi.fn();
  const onDatesRefused = vi.fn();
  render(
    <NextIntlClientProvider locale="en-GB" messages={messages}>
      <RequestForm
        slug="lake-house"
        checkIn="2026-08-10"
        checkOut="2026-08-14"
        maxGuests={4}
        pricing={pricing}
        onSent={onSent}
        onDatesRefused={onDatesRefused}
      />
    </NextIntlClientProvider>,
  );
  return { user: userEvent.setup(), onSent, onDatesRefused };
}

async function fillAndSend(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Name"), "Ada Lovelace");
  await user.type(screen.getByLabelText("Email"), "ada@example.test");
  await user.clear(screen.getByLabelText("Guests"));
  await user.type(screen.getByLabelText("Guests"), "2");
  await user.type(screen.getByLabelText("Message to the owner"), "Hello!");
  await user.click(screen.getByRole("checkbox", { name: /I agree/ }));
  vi.setSystemTime(Date.now() + 5_000);
  await user.click(screen.getByRole("button", { name: "Send request" }));
}

const sentBodies = () =>
  fetchMock.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)));

describe("the booking request form", () => {
  it("sends what the guest typed, the consent and the solved spam check", async () => {
    fetchMock.mockResolvedValue(Response.json(SENT, { status: 201 }));
    const { user, onSent } = renderForm();
    expect(screen.getByRole("link", { name: "privacy policy" })).toHaveAttribute(
      "href",
      "/stay/legal/privacy",
    );
    await fillAndSend(user);

    await waitFor(() => expect(onSent).toHaveBeenCalledWith(SENT));
    expect(fetchMock).toHaveBeenCalledWith("/api/public/properties/lake-house/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: expect.any(String),
    });
    expect(sentBodies()[0]).toEqual({
      checkIn: "2026-08-10",
      checkOut: "2026-08-14",
      guestCount: 2,
      name: "Ada Lovelace",
      email: "ada@example.test",
      phone: "",
      message: "Hello!",
      consent: true,
      locale: "en-GB",
      homepage: "",
      altcha: {
        challenge: { parameters: { n: 1 }, signature: "sig-1" },
        solution: { counter: 1, derivedKey: "ab" },
      },
    });
  });

  it("asks for children by the Kurtaxe's age groups and shows the price with it", async () => {
    fetchMock.mockResolvedValue(Response.json(SENT, { status: 201 }));
    const { user, onSent } = renderForm({
      ...PRICING,
      touristTax: {
        adultRateMinor: 300,
        childGroups: [
          { fromAge: 0, toAge: 5, rateMinor: 0 },
          { fromAge: 6, toAge: 15, rateMinor: 150 },
        ],
        periods: [],
        maxNights: null,
        included: false,
      },
    });
    await user.type(screen.getByLabelText("Name"), "Ada Lovelace");
    await user.type(screen.getByLabelText("Email"), "ada@example.test");
    await user.clear(screen.getByLabelText("Adults"));
    await user.type(screen.getByLabelText("Adults"), "2");
    await user.clear(screen.getByLabelText("Children aged 6–15"));
    await user.type(screen.getByLabelText("Children aged 6–15"), "1");
    expect(screen.getByLabelText("Children aged 0–5")).toHaveValue(0);

    // 4 nights: 2 x 4 x 3.00 + 1 x 4 x 1.50 = 30.00, on top of 450.00.
    const price = screen.getByTestId("request-price");
    expect(price).toHaveTextContent("Kurtaxe: 2 adults × 4 nights × €3.00€24.00");
    expect(price).toHaveTextContent("Kurtaxe: 1 child aged 6–15 × 4 nights × €1.50€6.00");
    expect(price).toHaveTextContent("Total€480.00");

    await user.click(screen.getByRole("checkbox", { name: /I agree/ }));
    vi.setSystemTime(Date.now() + 5_000);
    await user.click(screen.getByRole("button", { name: "Send request" }));
    await waitFor(() => expect(onSent).toHaveBeenCalled());
    expect(sentBodies()[0]).toMatchObject({
      guestCount: 3,
      guestSplit: { adults: 2, children: [{ fromAge: 6, toAge: 15, count: 1 }] },
    });
  });

  it("shows the server's refusals by field, and dates taken meanwhile above the button", async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        {
          error: {
            code: "validation_failed",
            message: "The request has invalid fields.",
            fields: {
              guestCount: ["this home sleeps at most 4 guests"],
              checkIn: ["these dates are not available"],
            },
          },
        },
        { status: 422 },
      ),
    );
    const { user, onSent, onDatesRefused } = renderForm();
    await fillAndSend(user);

    expect(await screen.findByText("Guests this home sleeps at most 4 guests")).toBeVisible();
    expect(screen.getByText("Arrival these dates are not available")).toBeVisible();
    expect(onDatesRefused).toHaveBeenCalled();
    expect(onSent).not.toHaveBeenCalled();
  });

  it(
    "solves a new spam check and sends again, once, when the first is refused",
    { timeout: 10_000 },
    async () => {
      fetchMock
        .mockResolvedValueOnce(
          Response.json(
            {
              error: {
                code: "validation_failed",
                message: "The request has invalid fields.",
                fields: {
                  altcha: ["the automatic spam check failed; please send the request again"],
                },
              },
            },
            { status: 422 },
          ),
        )
        .mockResolvedValueOnce(Response.json(SENT, { status: 201 }));
      const { user, onSent } = renderForm();
      await fillAndSend(user);

      // The new challenge is fresh: the form waits until it is old enough.
      await waitFor(() => expect(onSent).toHaveBeenCalledWith(SENT), { timeout: 6_000 });
      expect(sentBodies().map((body) => body.altcha.challenge.signature)).toEqual([
        "sig-1",
        "sig-2",
      ]);
    },
  );
});
