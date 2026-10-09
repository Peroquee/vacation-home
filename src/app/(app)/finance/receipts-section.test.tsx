// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { toastError } from "@/components/toast";

import { ReceiptsSection } from "./receipts-section";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/components/toast", () => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const receipt = (id: string, fileName: string, hasThumbnail: boolean) => ({
  id,
  transactionId: "t1",
  fileName,
  mediaType: hasThumbnail ? "image/jpeg" : "application/pdf",
  size: 1000,
  hasThumbnail,
  createdAt: "2026-07-14T10:00:00.000Z",
});

function serve(list: unknown[], upload: Response = Response.json({}, { status: 201 })) {
  const fetchMock = vi.fn<typeof fetch>(async (_url, init) =>
    init?.method === "POST" ? upload : Response.json(list),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("ReceiptsSection", () => {
  it("shows photos as thumbnails and PDFs as documents, each opening the file", async () => {
    serve([receipt("r1", "Quittung.jpg", true), receipt("r2", "Rechnung.pdf", false)]);
    render(<ReceiptsSection transactionId="t1" />);
    const photo = await screen.findByRole("link", { name: "Open Quittung.jpg" });
    expect(photo).toHaveAttribute("href", "/api/attachments/r1");
    expect(within(photo).getByRole("presentation")).toHaveAttribute(
      "src",
      "/api/attachments/r1/thumbnail",
    );
    expect(screen.getByRole("link", { name: "Open Rechnung.pdf" })).toHaveAttribute(
      "href",
      "/api/attachments/r2",
    );
    expect(screen.getByText(/HEIC and WebP photos keep theirs/)).toBeInTheDocument();
  });

  it("uploads the chosen file as form data", async () => {
    const fetchMock = serve([]);
    render(<ReceiptsSection transactionId="t1" />);
    expect(await screen.findByText("No receipts yet.")).toBeInTheDocument();
    const file = new File(["%PDF-1.7"], "Rechnung.pdf", { type: "application/pdf" });
    await userEvent
      .setup()
      .upload(screen.getByLabelText("Add receipts", { selector: "input" }), file);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(post[0]).toBe("/api/transactions/t1/attachments");
    expect((post[1]!.body as FormData).get("file")).toBeInstanceOf(File);
  });

  it("says why an upload was refused, in words", async () => {
    serve(
      [],
      Response.json(
        {
          error: {
            code: "validation_failed",
            message: "The request has invalid fields.",
            fields: { file: ["must be a PDF, JPEG, PNG, WebP or HEIC file"] },
          },
        },
        { status: 422 },
      ),
    );
    render(<ReceiptsSection transactionId="t1" />);
    await screen.findByText("No receipts yet.");
    const file = new File(["<html>"], "fake.pdf", { type: "application/pdf" });
    await userEvent
      .setup()
      .upload(screen.getByLabelText("Add receipts", { selector: "input" }), file);
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(String(vi.mocked(toastError).mock.calls[0]![0])).toContain(
      "fake.pdf: must be a PDF, JPEG, PNG, WebP or HEIC file",
    );
  });
});
