import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import LocationPicker, { type LocationSelection } from "@/components/LocationPicker";
import apiClient from "@/lib/api";

vi.mock("@/lib/api", () => ({
  default: {
    get: vi.fn(),
  },
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("LocationPicker", () => {
  it("keeps manual location search available when current-location acquisition fails", async () => {
    const location: LocationSelection = {
      address: "Barad, Nanded, Maharashtra",
      city: "Nanded",
      state: "Maharashtra",
      pincode: "431745",
      latitude: 19.1,
      longitude: 77.3,
      location_source: "SEARCH",
    };
    vi.mocked(apiClient.get).mockResolvedValue({ data: { locations: [location] } });
    const onSelect = vi.fn();

    render(
      <LocationPicker
        onSelect={onSelect}
        onUseCurrentLocation={() => Promise.reject(new Error("coarse location"))}
        getCurrentLocationErrorMessage={() => "Your device couldn't determine your precise current location. Search manually."}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Use my current location" }));
    expect(await screen.findByText(/couldn't determine your precise current location/i)).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Search your area, city or pincode"), {
      target: { value: "Barad" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    fireEvent.click(await screen.findByRole("button", { name: /Barad, Nanded/ }));
    expect(onSelect).toHaveBeenCalledWith(location);
  });

  it("keeps manual location search and selection available", async () => {
    const location: LocationSelection = {
      address: "1 Main Road, Pune",
      city: "Pune",
      state: "Maharashtra",
      pincode: "411001",
      latitude: 18.5204,
      longitude: 73.8567,
      location_source: "SEARCH",
    };
    vi.mocked(apiClient.get).mockResolvedValue({ data: { locations: [location] } });
    const onSelect = vi.fn();

    render(
      <LocationPicker
        label="Search location"
        onSelect={onSelect}
        clearQueryOnSelect
        placeholder="Search for an address..."
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Search for an address..."), {
      target: { value: "Main Road" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith(
      "/api/v1/locations/search",
      { params: { q: "Main Road" } },
    ));
    fireEvent.click(await screen.findByRole("button", { name: /1 Main Road, Pune/ }));

    expect(onSelect).toHaveBeenCalledWith(location);
    expect((screen.getByPlaceholderText("Search for an address...") as HTMLInputElement).value).toBe("");
  });
});
