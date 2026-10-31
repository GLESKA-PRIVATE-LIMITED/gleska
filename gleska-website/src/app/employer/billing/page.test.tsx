import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import EmployerBillingPage from "@/app/employer/billing/page";
import { formatCredits } from "@/lib/billing-api";

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  routerReplace: vi.fn(),
  user: { id: "employer-id", role: "EMPLOYER" as const, name: "Employer", employer_type: "REGISTERED_BUSINESS" },
}));

vi.mock("@/lib/api", () => ({ default: { get: mocks.apiGet, post: mocks.apiPost } }));
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mocks.user, isLoading: false, logout: vi.fn() }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.routerReplace }) }));
vi.mock("@/components/AccountManagementShell", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
  formatEmployerType: () => "Business",
}));

const wallet = {
  account_id: "acc", status: "active", available: "12.500000", reserved: "0.250000",
  total_purchased: "0", total_consumed: "1.100000", total_refunded: "0", total_adjusted: "13.850000",
  total_unrecovered: "0", credit_value_inr: "20.0000",
};
const usage = {
  totals: { requests: 2, failed_requests: 0, input_tokens: 10, output_tokens: 5, thinking_tokens: 0, total_tokens: 1500, customer_charge_inr: "22", credits_charged: "1.100000" },
  by_agent: [{ agent: "general_work", requests: 2, failed_requests: 0, input_tokens: 10, output_tokens: 5, thinking_tokens: 0, total_tokens: 1500, customer_charge_inr: "22", credits_charged: "1.100000" }],
  events: [{ id: "e1", started_at: "2026-10-30T10:00:00Z", executing_agent: "general_work", operation: "chat_reply", model: "m", status: "succeeded", total_tokens: 1500, credits_charged: 1.1, error_code: null }],
};
const ledger = [
  { id: 3, entry_type: "settle", delta_available: 0.15, available_after: 12.5, credits_consumed: 1.1, description: "AI request charged", created_at: "2026-10-30T10:00:01Z" },
  { id: 2, entry_type: "reserve", delta_available: -1.25, available_after: 11.25, credits_consumed: 0, description: "AI request reservation", created_at: "2026-10-30T10:00:00Z" },
  { id: 1, entry_type: "adjustment", delta_available: 13.6, available_after: 13.6, credits_consumed: 0, description: "internal note", created_at: "2026-10-29T10:00:00Z" },
];

const purchases = [
  { order_id: "cred_aaaaaaaaaaaaaaaa", credits: "25.000000", amount_inr: "500.00", currency: "INR", status: "PAID", receipt_number: "GLK-CR-000001", payment_method: "upi", paid_at: "2026-10-30T10:00:00Z", created_at: "2026-10-30T09:59:00Z" },
  { order_id: "cred_bbbbbbbbbbbbbbbb", credits: "5.000000", amount_inr: "100.00", currency: "INR", status: "EXPIRED", receipt_number: null, payment_method: null, paid_at: null, created_at: "2026-10-29T09:00:00Z" },
];

beforeEach(() => {
  window.history.replaceState(null, "", "/employer/billing");
  mocks.apiGet.mockReset();
  mocks.apiPost.mockReset();
  mocks.routerReplace.mockReset();
  mocks.apiGet.mockImplementation((url: string) => {
    if (url.endsWith("/billing/wallet")) return Promise.resolve({ data: wallet });
    if (url.endsWith("/billing/usage")) return Promise.resolve({ data: usage });
    if (url.endsWith("/billing/purchases")) return Promise.resolve({ data: { purchases } });
    if (url.endsWith("/billing/purchase-options")) return Promise.resolve({ data: { min_credits: 5, max_credits: 2500, credit_value_inr: "20.0000" } });
    return Promise.resolve({ data: { entries: ledger } });
  });
});

describe("EmployerBillingPage", () => {
  it("shows balance, usage by agent and credit history without holds by default", async () => {
    render(<EmployerBillingPage />);
    expect((await screen.findByTestId("available-credits")).textContent).toBe("12.5");
    expect(screen.getByText(/Worth ₹250\.00/)).toBeTruthy();
    expect(screen.getAllByText("General Work").length).toBeGreaterThan(0);

    const history = screen.getByRole("heading", { name: "Credit history" }).closest("section")!;
    expect(within(history).getByText("AI usage")).toBeTruthy();
    expect(within(history).getByText("-1.1")).toBeTruthy();
    expect(within(history).getByText("+13.6")).toBeTruthy();
    expect(within(history).queryByText("Held for AI request")).toBeNull();
    // Admin's internal reason is not shown to the employer.
    expect(within(history).queryByText("internal note")).toBeNull();

    fireEvent.click(within(history).getByLabelText("Show temporary holds"));
    expect(within(history).getByText("Held for AI request")).toBeTruthy();
  });

  it("reloads usage for the chosen period", async () => {
    render(<EmployerBillingPage />);
    await screen.findByTestId("available-credits");
    fireEvent.click(screen.getByRole("button", { name: "7 days" }));
    await waitFor(() => {
      const usageCalls = mocks.apiGet.mock.calls.filter(([url]) => String(url).endsWith("/billing/usage"));
      expect(usageCalls.length).toBe(2);
      const since = new Date(usageCalls[1][1].params.start).getTime();
      expect(Date.now() - since).toBeGreaterThan(6.9 * 86_400_000);
      expect(Date.now() - since).toBeLessThan(7.1 * 86_400_000);
    });
  });

  it("formats decimal strings without float maths surprises", () => {
    expect(formatCredits("12.500000")).toBe("12.5");
    expect(formatCredits("-0.004")).toBe("0");
    expect(formatCredits("2500")).toBe("2,500");
    expect(formatCredits(null)).toBe("0");
    // Supabase sends NUMERIC columns as JSON numbers (this crashed the live page once).
    expect(formatCredits(12.5)).toBe("12.5");
    expect(formatCredits(-1.25)).toBe("-1.25");
    expect(formatCredits(0)).toBe("0");
    expect(formatCredits(1e-7)).toBe("0");
  });
});

describe("Buying credits", () => {
  it("validates whole credits within limits and sends only the credit count", async () => {
    const checkout = vi.fn();
    (window as unknown as { Cashfree: unknown }).Cashfree = vi.fn(() => ({ checkout }));
    mocks.apiPost.mockResolvedValue({ data: { order_id: "cred_cccccccccccccccc", payment_session_id: "sess", credits: "25", amount_inr: "500.00" } });
    render(<EmployerBillingPage />);
    const input = await screen.findByLabelText("Credits");
    const pay = () => screen.getByRole("button", { name: /^Pay/ }) as HTMLButtonElement;

    for (const bad of ["4", "2501", "2.5", "abc"]) {
      fireEvent.change(input, { target: { value: bad } });
      expect(pay().disabled).toBe(true);
    }
    fireEvent.change(input, { target: { value: "25" } });
    expect(pay().textContent).toBe("Pay ₹500.00");
    fireEvent.click(pay());
    await waitFor(() => expect(checkout).toHaveBeenCalledWith({ paymentSessionId: "sess", redirectTarget: "_self" }));
    expect(mocks.apiPost).toHaveBeenCalledWith("/api/v1/billing/purchases", { credits: 25 });
  });

  it("lists purchases with receipt links only for paid ones", async () => {
    render(<EmployerBillingPage />);
    const section = (await screen.findByRole("heading", { name: "Purchases & receipts" })).closest("section")!;
    const links = within(section).getAllByRole("link", { name: "Receipt" });
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("/employer/billing/receipt/cred_aaaaaaaaaaaaaaaa");
    expect(within(section).getByText("Expired")).toBeTruthy();
  });

  it("confirms the order after Cashfree redirects back", async () => {
    window.history.replaceState(null, "", "/employer/billing?order_id=cred_aaaaaaaaaaaaaaaa");
    mocks.apiPost.mockResolvedValue({ data: { ...purchases[0] } });
    render(<EmployerBillingPage />);
    expect(await screen.findByText(/25 credits added/)).toBeTruthy();
    expect(mocks.apiPost).toHaveBeenCalledWith("/api/v1/billing/purchases/cred_aaaaaaaaaaaaaaaa/verify");
    expect(mocks.routerReplace).toHaveBeenCalledWith("/employer/billing", { scroll: false });
  });
});
