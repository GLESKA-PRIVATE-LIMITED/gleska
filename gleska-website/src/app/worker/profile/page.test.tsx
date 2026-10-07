import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WorkerProfilePage from "@/app/worker/profile/page";
import { InaccurateLocationError } from "@/lib/location";

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPut: vi.fn(),
  getBrowserLocation: vi.fn(),
  refreshUser: vi.fn(),
  routerReplace: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  user: {
    id: "worker-id",
    role: "WORKER" as const,
    name: "Worker Example",
    mobile: "919876543210",
    email: "worker@example.com",
    is_mobile_verified: true,
  },
}));

vi.mock("@/lib/api", () => ({
  default: { get: mocks.apiGet, put: mocks.apiPut },
}));

vi.mock("@/lib/location", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/location")>();
  return { ...actual, getBrowserLocation: mocks.getBrowserLocation };
});

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: mocks.user,
    isLoading: false,
    refreshUser: mocks.refreshUser,
    logout: vi.fn(),
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.routerReplace }),
}));

vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

vi.mock("@/components/AccountManagementShell", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/lib/useWorkerProfilePhoto", () => ({
  useWorkerProfilePhoto: () => ({ isUploading: false, uploadPhoto: vi.fn() }),
}));

vi.mock("@/components/worker/WorkspaceUI", () => ({
  WorkerErrorState: () => null,
  WorkerPageFrame: ({ children }: { children: ReactNode }) => <>{children}</>,
  WorkerPageHeader: () => null,
}));

const permanentAddress = {
  address: "Nanded, Maharashtra, India",
  city: "Nanded",
  state: "Maharashtra",
  pincode: "431745",
  latitude: 19.15,
  longitude: 77.32,
  location_source: "SEARCH",
};

const currentLocation = {
  latitude: 17.385,
  longitude: 78.4867,
  accuracy_m: 45,
  address: "Hyderabad, Telangana, India",
  updated_at: new Date().toISOString(),
};

function setupProfile() {
  mocks.apiGet.mockImplementation(async (path: string) => {
    if (path === "/api/v1/workers/me") {
      return {
        data: {
          ...permanentAddress,
          current_location: null,
          availability_status: "AVAILABLE",
          trade_id: "Electrician",
          skills: [],
        },
      };
    }
    if (path === "/api/v1/locations/search") {
      return { data: { locations: [permanentAddress] } };
    }
    throw new Error(`Unexpected GET ${path}`);
  });
  mocks.apiPut.mockImplementation(async (path: string, payload: Record<string, unknown>) => {
    if (path === "/api/v1/workers/me/location") return { data: { ...payload, ...currentLocation } };
    if (path === "/api/v1/workers/me") return { data: { ...payload } };
    throw new Error(`Unexpected PUT ${path}`);
  });

  render(<WorkerProfilePage />);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Worker Profile location", () => {
  it("saves a searched address as permanent profile data without writing current GPS", async () => {
    setupProfile();

    await screen.findByText("Nanded, Maharashtra, India");
    fireEvent.click(screen.getByRole("button", { name: "Edit address" }));
    fireEvent.change(screen.getByPlaceholderText("Search your area, city or pincode"), {
      target: { value: "Nanded" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.click(await screen.findByRole("button", { name: /Nanded, Maharashtra, India/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(mocks.apiPut).toHaveBeenCalledWith(
      "/api/v1/workers/me",
      expect.objectContaining({
        address: permanentAddress.address,
        city: permanentAddress.city,
        state: permanentAddress.state,
        pincode: permanentAddress.pincode,
        location_source: "SEARCH",
      }),
    ));
    expect(mocks.apiPut).not.toHaveBeenCalledWith(
      "/api/v1/workers/me/location",
      expect.anything(),
    );
  });

  it("writes detected GPS only to current-location data and preserves permanent address fields", async () => {
    mocks.getBrowserLocation.mockResolvedValue({
      latitude: currentLocation.latitude,
      longitude: currentLocation.longitude,
      accuracy: currentLocation.accuracy_m,
    });
    setupProfile();

    await screen.findByText("Nanded, Maharashtra, India");
    fireEvent.click(screen.getByRole("button", { name: "Refresh current location" }));
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith("Current location updated"));
    await screen.findByText("Hyderabad, Telangana, India");
    expect(mocks.apiPut).toHaveBeenCalledTimes(1);
    expect(mocks.apiPut).toHaveBeenCalledWith("/api/v1/workers/me/location", {
      latitude: currentLocation.latitude,
      longitude: currentLocation.longitude,
      accuracy_m: currentLocation.accuracy_m,
    });
    expect(mocks.apiPut).not.toHaveBeenCalledWith("/api/v1/workers/me", expect.anything());
    expect(screen.getByText("Nanded, Maharashtra, India")).toBeTruthy();
    expect(screen.getByText("PIN: 431745")).toBeTruthy();
    expect(screen.getByText(/Accuracy: 45 m/)).toBeTruthy();
  });

  it("shows a retryable accuracy error and does not persist an inaccurate position", async () => {
    mocks.getBrowserLocation.mockRejectedValue(new InaccurateLocationError(200000));
    setupProfile();

    await screen.findByText("Nanded, Maharashtra, India");
    fireEvent.click(screen.getByRole("button", { name: "Refresh current location" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Location accuracy is too low (200km)");
    expect(screen.getByRole("button", { name: "Refresh current location" }).hasAttribute("disabled")).toBe(false);
    expect(mocks.apiPut).not.toHaveBeenCalled();
    expect(screen.getByText("Nanded, Maharashtra, India")).toBeTruthy();
  });
});
