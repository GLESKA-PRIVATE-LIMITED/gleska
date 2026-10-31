import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CreditReceiptPage from "@/app/employer/billing/receipt/[orderId]/page";

const mocks = vi.hoisted(() => ({ apiGet: vi.fn(), replace: vi.fn() }));

vi.mock("@/lib/api", () => ({ default: { get: mocks.apiGet } }));
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u", role: "EMPLOYER" }, isLoading: false }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
  useParams: () => ({ orderId: "cred_aaaaaaaaaaaaaaaa" }),
}));

beforeEach(() => {
  mocks.apiGet.mockReset();
});

describe("CreditReceiptPage", () => {
  it("renders the paid receipt", async () => {
    mocks.apiGet.mockResolvedValue({ data: {
      receipt_number: "GLK-CR-000007", order_id: "cred_aaaaaaaaaaaaaaaa", seller_name: "GLESKA PRIVATE LIMITED",
      buyer_name: "Alpha Traders", buyer_email: "a@example.com", credits: "25.000000", credit_value_inr: "20.0000",
      amount_inr: "500.00", currency: "INR", payment_method: "upi", cf_payment_id: "pay-1",
      paid_at: "2026-10-31T10:00:00Z", note: "No GST charged: the seller is not GST-registered.",
    } });
    render(<CreditReceiptPage />);
    expect((await screen.findByTestId("receipt-number")).textContent).toBe("GLK-CR-000007");
    expect(screen.getByTestId("receipt-total").textContent).toBe("₹500.00");
    expect(screen.getByText("Alpha Traders")).toBeTruthy();
    expect(mocks.apiGet).toHaveBeenCalledWith("/api/v1/billing/purchases/cred_aaaaaaaaaaaaaaaa/receipt");
  });

  it("shows a safe message when the receipt is not available", async () => {
    mocks.apiGet.mockRejectedValue({ response: { status: 404 } });
    render(<CreditReceiptPage />);
    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});
