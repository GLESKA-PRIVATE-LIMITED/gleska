import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WorkerDashboard from "@/app/worker/dashboard/page";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPut: vi.fn(),
  routerReplace: vi.fn(),
  watchPosition: vi.fn(),
  clearWatch: vi.fn(),
  onPosition: null as PositionCallback | null,
  onError: null as PositionErrorCallback | null,
  user: { id: "worker-id", role: "WORKER", name: "Worker Example" },
}));

vi.mock("@/lib/api", () => ({
  default: { get: mocks.apiGet, put: mocks.apiPut },
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: mocks.user,
    isLoading: false,
    nextStep: "DASHBOARD",
    logout: vi.fn(),
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.routerReplace }),
}));

vi.mock("next/image", () => ({
  default: () => null,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/components/AccountManagementShell", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

function position(latitude: number, longitude: number, accuracy: number): GeolocationPosition {
  return {
    coords: {
      latitude,
      longitude,
      accuracy,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
      toJSON: () => ({}),
    },
    timestamp: Date.now(),
    toJSON: () => ({}),
  };
}

const originalGeolocation = Object.getOwnPropertyDescriptor(navigator, "geolocation");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.onPosition = null;
  mocks.onError = null;
  mocks.watchPosition.mockImplementation((success, error) => {
    mocks.onPosition = success;
    mocks.onError = error;
    return 1;
  });
  mocks.apiGet.mockImplementation(async (path: string) => {
    if (path === "/api/v1/workers/me") {
      return {
        data: {
          profile_completed: true,
          availability_status: "AVAILABLE",
          address: "Nanded permanent address",
          city: "Nanded",
          state: "Maharashtra",
        },
      };
    }
    if (path === "/api/v1/workers/me/available-jobs") return { data: { jobs: [] } };
    throw new Error(`Unexpected GET ${path}`);
  });
  mocks.apiPut.mockResolvedValue({ data: { address: "Hyderabad current location" } });
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: { watchPosition: mocks.watchPosition, clearWatch: mocks.clearWatch },
  });
});

afterEach(() => {
  cleanup();
  if (originalGeolocation) {
    Object.defineProperty(navigator, "geolocation", originalGeolocation);
  } else {
    Reflect.deleteProperty(navigator, "geolocation");
  }
});

describe("Worker Dashboard current location", () => {
  it("waits for a fresh accurate location before saving it and loading nearby jobs", async () => {
    render(<WorkerDashboard />);

    expect(await screen.findByText(/Detecting your current location/)).not.toBeNull();
    await waitFor(() => expect(mocks.watchPosition).toHaveBeenCalledOnce());
    expect(mocks.watchPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 },
    );
    expect(mocks.apiGet).not.toHaveBeenCalledWith("/api/v1/workers/me/available-jobs");
    expect(screen.queryByText("Nanded permanent address")).toBeNull();

    await act(async () => {
      mocks.onPosition?.(position(19.1, 72.9, 200000));
    });
    expect(mocks.apiPut).not.toHaveBeenCalled();
    expect(mocks.apiGet).not.toHaveBeenCalledWith("/api/v1/workers/me/available-jobs");

    await act(async () => {
      mocks.onPosition?.(position(17.385, 78.4867, 500));
    });

    await waitFor(() => expect(mocks.apiPut).toHaveBeenCalledWith(
      "/api/v1/workers/me/location",
      { latitude: 17.385, longitude: 78.4867, accuracy_m: 500 },
    ));
    await waitFor(() => expect(mocks.apiGet).toHaveBeenCalledWith("/api/v1/workers/me/available-jobs"));
    expect(mocks.apiPut.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.apiGet.mock.invocationCallOrder.find((_callOrder, index) =>
        mocks.apiGet.mock.calls[index][0] === "/api/v1/workers/me/available-jobs",
      )!,
    );
    expect(await screen.findByText("Hyderabad current location")).not.toBeNull();
    expect(screen.queryByText("Nanded permanent address")).toBeNull();

    await act(async () => {
      mocks.onPosition?.(position(19.1, 72.9, 200000));
    });
    expect(mocks.apiPut).toHaveBeenCalledOnce();
    expect(await screen.findByText("Hyderabad current location")).not.toBeNull();
  });
});
