import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getBrowserLocation,
  getLocationErrorCategory,
  InaccurateLocationError,
  LOCATION_ACQUISITION_TIMEOUT_MS,
  MAX_ADDRESS_ACCURACY_METERS,
  normalizeCoordinates,
  retainAccurateLocationSnapshot,
  type LiveLocationSnapshot,
  watchBrowserLocation,
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

function mockBrowserWatch(permissionState?: PermissionState) {
  let onPosition: PositionCallback | undefined;
  let onError: PositionErrorCallback | null | undefined;
  const watchPosition = vi.fn((success: PositionCallback, error?: PositionErrorCallback | null, _options?: PositionOptions) => {
    onPosition = success;
    onError = error;
    return 17;
  });
  const clearWatch = vi.fn();
  const query = permissionState === undefined
    ? undefined
    : vi.fn(async () => ({ state: permissionState } as PermissionStatus));
  vi.stubGlobal("navigator", {
    geolocation: { watchPosition, clearWatch },
    ...(query ? { permissions: { query } } : {}),
  });
  return {
    watchPosition,
    clearWatch,
    query,
    emitPosition: (reading: GeolocationPosition) => onPosition?.(reading),
    emitError: (error: GeolocationPositionError) => onError?.(error),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("browser location acquisition policies", () => {
  it("accepts a valid accurate location for matching and address use", async () => {
    const browser = mockBrowserWatch();
    const matching = watchBrowserLocation({ policy: "MATCHING" });
    browser.emitPosition(position(19.1, 72.9, 500));
    await expect(matching).resolves.toMatchObject({ latitude: 19.1, longitude: 72.9, accuracy: 500 });

    const addressBrowser = mockBrowserWatch();
    const address = watchBrowserLocation({ policy: "ADDRESS" });
    addressBrowser.emitPosition(position(19.1, 72.9, 500));
    await expect(address).resolves.toMatchObject({ latitude: 19.1, longitude: 72.9, accuracy: 500 });
  });

  it("accepts a good GPS reading for address assistance", async () => {
    const browser = mockBrowserWatch();
    const result = watchBrowserLocation({ policy: "ADDRESS" });
    browser.emitPosition(position(18.51, 73.8567, 500));
    await expect(result).resolves.toMatchObject({
      latitude: 18.51,
      longitude: 73.8567,
      accuracy: 500,
    });
    expect(browser.clearWatch).toHaveBeenCalledWith(17);
  });

  it.each([200000, 500000])("does not accept %i m accuracy for address selection", async (accuracy) => {
    vi.useFakeTimers();
    const browser = mockBrowserWatch();
    const onPosition = vi.fn();
    const result = watchBrowserLocation({ policy: "ADDRESS", onPosition });
    browser.emitPosition(position(18.51, 73.8567, accuracy));

    const rejection = expect(result).rejects.toBeInstanceOf(InaccurateLocationError);
    await vi.advanceTimersByTimeAsync(LOCATION_ACQUISITION_TIMEOUT_MS);
    await rejection;
    expect(onPosition).not.toHaveBeenCalled();
    expect(browser.clearWatch).toHaveBeenCalledWith(17);
  });

  it("does not resolve matching policy from a coarse reading, then accepts a later accurate reading once", async () => {
    const browser = mockBrowserWatch();
    const result = watchBrowserLocation({ policy: "MATCHING" });
    browser.emitPosition(position(18.51, 73.8567, 500000));
    browser.emitPosition(position(19.1, 72.9, 1000));
    browser.emitPosition(position(19.2, 73, 500));

    await expect(result).resolves.toMatchObject({ latitude: 19.1, longitude: 72.9, accuracy: 1000 });
    expect(browser.clearWatch).toHaveBeenCalledTimes(1);
    expect(normalizeCoordinates(18.51, 73.8567, 500000, "MATCHING")).toBeNull();
  });

  it("reports the last coarse reading when no matching-grade reading arrives before the deadline", async () => {
    vi.useFakeTimers();
    const browser = mockBrowserWatch();
    const result = watchBrowserLocation({ policy: "MATCHING" });
    browser.emitPosition(position(18.51, 73.8567, 500000));

    const rejection = expect(result).rejects.toMatchObject({
      code: "INACCURATE",
      accuracy: 500000,
    });
    await vi.advanceTimersByTimeAsync(LOCATION_ACQUISITION_TIMEOUT_MS);
    await rejection;
    expect(browser.clearWatch).toHaveBeenCalledWith(17);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("accepts matching accuracy at or below 1000 m and rejects over the threshold", () => {
    expect(normalizeCoordinates(19.1, 72.9, 1000, "MATCHING")).not.toBeNull();
    expect(normalizeCoordinates(19.1, 72.9, 1000.1, "MATCHING")).toBeNull();
    expect(MAX_ADDRESS_ACCURACY_METERS).toBe(1000);
  });

  it("rejects invalid latitude and longitude", async () => {
    const latitudeBrowser = mockBrowserWatch();
    const invalidLatitude = watchBrowserLocation({ policy: "ADDRESS" });
    latitudeBrowser.emitPosition(position(91, 72, 20));
    await expect(invalidLatitude).rejects.toMatchObject({ code: "INVALID_COORDINATES" });

    const longitudeBrowser = mockBrowserWatch();
    const invalidLongitude = watchBrowserLocation({ policy: "ADDRESS" });
    longitudeBrowser.emitPosition(position(19, 181, 20));
    await expect(invalidLongitude).rejects.toMatchObject({ code: "INVALID_COORDINATES" });
  });

  it("checks supported geolocation permission and rejects denied permission", async () => {
    const browser = mockBrowserWatch("denied");
    await expect(watchBrowserLocation({ policy: "ADDRESS" })).rejects.toMatchObject({ code: 1 });
    expect(browser.query).toHaveBeenCalledWith({ name: "geolocation" });
    expect(browser.watchPosition).not.toHaveBeenCalled();
  });

  it("reports permission denied from the geolocation API", async () => {
    const browser = mockBrowserWatch();
    const result = watchBrowserLocation({ policy: "ADDRESS" });
    const denied = { code: 1, PERMISSION_DENIED: 1, message: "Permission denied" } as GeolocationPositionError;
    browser.emitError(denied);
    await expect(result).rejects.toBe(denied);
    expect(getLocationErrorCategory(denied)).toBe("PERMISSION_DENIED");
    expect(browser.clearWatch).toHaveBeenCalledWith(17);
  });

  it("preserves position unavailable and timeout errors", async () => {
    vi.useFakeTimers();
    const unavailableBrowser = mockBrowserWatch();
    const unavailable = watchBrowserLocation({ policy: "ADDRESS" });
    const unavailableError = { code: 2, POSITION_UNAVAILABLE: 2, message: "Unavailable" } as GeolocationPositionError;
    unavailableBrowser.emitError(unavailableError);
    const unavailableRejection = expect(unavailable).rejects.toBe(unavailableError);
    await vi.advanceTimersByTimeAsync(LOCATION_ACQUISITION_TIMEOUT_MS);
    await unavailableRejection;

    const timeoutBrowser = mockBrowserWatch();
    const timeout = watchBrowserLocation({ policy: "ADDRESS" });
    const timeoutRejection = expect(timeout).rejects.toMatchObject({ code: 3 });
    await vi.advanceTimersByTimeAsync(LOCATION_ACQUISITION_TIMEOUT_MS);
    await timeoutRejection;
    expect(timeoutBrowser.clearWatch).toHaveBeenCalledWith(17);
  });

  it("returns raw coordinates independently of reverse geocoding", async () => {
    const browser = mockBrowserWatch();
    const result = getBrowserLocation("ADDRESS");
    browser.emitPosition(position(19.1, 72.9, 200));
    await expect(result).resolves.toMatchObject({ latitude: 19.1, longitude: 72.9, accuracy: 200 });
  });

  it("clears the watch and acquisition timer on the first accepted location", async () => {
    vi.useFakeTimers();
    const browser = mockBrowserWatch();
    const result = watchBrowserLocation({ policy: "MATCHING" });
    browser.emitPosition(position(19.1, 72.9, 500));
    await expect(result).resolves.toMatchObject({ accuracy: 500 });
    expect(browser.clearWatch).toHaveBeenCalledWith(17);
    expect(vi.getTimerCount()).toBe(0);
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
