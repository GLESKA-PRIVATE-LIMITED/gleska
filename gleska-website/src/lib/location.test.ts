import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getBrowserLocation,
  InaccurateLocationError,
  retainAccurateLocationSnapshot,
  type LiveLocationSnapshot,
} from "@/lib/location";

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
    timestamp: 1,
    toJSON: () => ({}),
  };
}

function mockBrowserPositions(positions: GeolocationPosition[]) {
  const getCurrentPosition = vi.fn(
    (success: PositionCallback, error?: PositionErrorCallback | null, options?: PositionOptions) => {
      void error;
      void options;
      success(positions.shift()!);
    },
  );
  vi.stubGlobal("navigator", {
    geolocation: { getCurrentPosition },
  });
  return getCurrentPosition;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getBrowserLocation", () => {
  it("accepts an accurate first position without retrying", async () => {
    const getCurrentPosition = mockBrowserPositions([position(19.1, 72.9, 500)]);

    const result = await getBrowserLocation();

    expect(result).toMatchObject({ latitude: 19.1, longitude: 72.9, accuracy: 500 });
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(getCurrentPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.anything(),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 },
    );
  });

  it("retries a coarse first position with a fresh high-accuracy request", async () => {
    const getCurrentPosition = mockBrowserPositions([
      position(19.1, 72.9, 200000),
      position(19.2, 73, 500),
    ]);

    const result = await getBrowserLocation();

    expect(result).toMatchObject({ latitude: 19.2, longitude: 73, accuracy: 500 });
    expect(getCurrentPosition).toHaveBeenCalledTimes(2);
    expect(getCurrentPosition).toHaveBeenLastCalledWith(
      expect.any(Function),
      expect.anything(),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 45000 },
    );
  });

  it("returns the existing inaccurate-location error when the retry is still coarse", async () => {
    mockBrowserPositions([
      position(19.1, 72.9, 200000),
      position(19.2, 73, 150000),
    ]);

    await expect(getBrowserLocation()).rejects.toMatchObject({
      code: "INACCURATE",
      accuracy: 150000,
      message: new InaccurateLocationError(150000).message,
    });
  });
});

describe("retainAccurateLocationSnapshot", () => {
  it("does not replace a valid dashboard location with an inaccurate position", () => {
    const existing: LiveLocationSnapshot = {
      latitude: 19.1,
      longitude: 72.9,
      accuracy_m: 25,
      updated_at: 100,
    };

    const result = retainAccurateLocationSnapshot(existing, 21.2, 79.1, 200000, 200);

    expect(result).toBe(existing);
  });
});
