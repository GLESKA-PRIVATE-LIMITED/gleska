import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CompanyBrainWorkspace from "@/components/agents/company-brain/CompanyBrainWorkspace";

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }));

vi.mock("@/lib/api", () => ({ default: { get: mocks.get, post: mocks.post, patch: mocks.patch, delete: mocks.delete } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/agent-dashboard/AgentLayout", () => ({
  default: ({ children, sidebarContent }: { children: ReactNode; sidebarContent?: (h: { closeMobileSidebar: () => void }) => ReactNode }) => (
    <div>
      <aside>{sidebarContent?.({ closeMobileSidebar: () => undefined })}</aside>
      <main>{children}</main>
    </div>
  ),
}));

const answer = {
  conversation_id: "c1",
  message_id: "m1",
  answer: "Customers owe you ₹11,000.50 [E1].",
  answer_status: "validated",
  sources: [{
    id: "E1", label: "Outstanding receivables (owed to you) (INR)", value: "₹11,000.50", period: "as of 2026-10-31",
    source_agent: "financial", source_table: "financial_invoices", source_type: "table", record_count: 2, freshness: "live",
    retrieved_at: "2026-10-31T10:00:00Z", source_updated_at: null, calculation_id: "calc_1", document_id: null,
  }],
  limitations: ["Customers are grouped by the exact name typed on each invoice."],
  conflicts: [],
  generated_at: "2026-10-31T10:00:00Z",
};

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.get.mockImplementation((url: string) => {
    if (url.endsWith("/status")) return Promise.resolve({ data: { documents: {}, documents_without_embeddings: 0, last_indexed_at: null, sources: [] } });
    if (url.endsWith("/conversations")) return Promise.resolve({ data: { conversations: [] } });
    return Promise.resolve({ data: {} });
  });
});

describe("CompanyBrainWorkspace", () => {
  it("shows the welcome screen with suggested questions and no business figures", async () => {
    render(<CompanyBrainWorkspace />);
    expect(screen.getByRole("heading", { name: "Your Company. One Intelligence Layer." })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Give me today's company overview." })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/₹\d/);
  });

  it("asks a question and shows the verified answer with its sources", async () => {
    mocks.post.mockResolvedValue({ data: answer });
    render(<CompanyBrainWorkspace />);
    fireEvent.change(screen.getByLabelText("Ask Company Brain"), { target: { value: "What is pending from customers?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Verified against company records")).toBeTruthy();
    expect(mocks.post).toHaveBeenCalledWith("/api/v1/company-brain/ask", { question: "What is pending from customers?" });
    fireEvent.click(screen.getByRole("button", { name: /Sources \(1\)/ }));
    const source = screen.getByTestId("brain-source");
    expect(within(source).getByText("₹11,000.50")).toBeTruthy();
    expect(within(source).getByText("Live")).toBeTruthy();
  });

  it("continues the same conversation for follow-ups", async () => {
    mocks.post.mockResolvedValue({ data: answer });
    render(<CompanyBrainWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: "What are our pending payments?" }));
    await screen.findByText("Verified against company records");
    fireEvent.change(screen.getByLabelText("Ask Company Brain"), { target: { value: "Which customers?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(mocks.post).toHaveBeenLastCalledWith("/api/v1/company-brain/ask", { question: "Which customers?", conversation_id: "c1" }));
  });

  it("explains billing refusals instead of failing silently", async () => {
    mocks.post.mockRejectedValue({ response: { data: { detail: "INSUFFICIENT_CREDITS" } } });
    render(<CompanyBrainWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: "Show me our tender pipeline." }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/AI credits have run out/);
  });

  it("runs an executive summary for a period", async () => {
    mocks.post.mockResolvedValue({ data: { ...answer, answer_status: "fallback" } });
    render(<CompanyBrainWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: "This week's summary" }));
    await screen.findByText("Shown directly from company records");
    expect(mocks.post).toHaveBeenCalledWith("/api/v1/company-brain/summary", { period: { name: "this_week" } });
  });
});
