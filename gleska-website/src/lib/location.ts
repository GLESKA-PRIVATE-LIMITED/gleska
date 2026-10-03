export const MAX_LOCATION_ACCURACY_METERS = 1000;
// Address selection is neighborhood-scale; broader uncertainty can point to another town.
export const MAX_ADDRESS_ACCURACY_METERS = 1000;
export const LIVE_LOCATION_UPDATE_INTERVAL_MS = 15000;
export const MIN_LOCATION_UPDATE_INTERVAL_MS = LIVE_LOCATION_UPDATE_INTERVAL_MS;
export const MIN_LOCATION_MOVEMENT_METERS = 25;
export const LOCATION_HEARTBEAT_MS = 60000;
export const LOCATION_ACQUISITION_TIMEOUT_MS = 60000;

const BROWSER_LOCATION_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 30000,
};

export type LocationAccuracyPolicy = "ADDRESS" | "MATCHING";

export type LiveLocationSnapshot = {
  latitude: number;
  longitude: number;
  accuracy_m: number;
  updated_at: number;
};

export type NormalizedLocation = {
  latitude: number;
  longitude: number;
  accuracy: number;
  altitude: number | null;
  altitudeAccuracy: number | null;
  heading: number | null;
  speed: number | null;
};

export type LocationErrorCategory =
  | "PERMISSION_DENIED"
  | "POSITION_UNAVAILABLE"
  | "TIMEOUT"
  | "LOCATION_UNAVAILABLE"
  | "INVALID_COORDINATES"
  | "INACCURATE_LOCATION";

export class InaccurateLocationError extends Error {
  code = "INACCURATE";
  accuracy: number;

  constructor(accuracy: number) {
    const accuracyLabel = accuracy >= 10000 ? `${Math.round(accuracy / 1000)}km` : `${Math.round(accuracy)}m`;
    super(`Your device couldn't determine your precise current location (${accuracyLabel}). Please enable device location/GPS and try again, or search for your location manually.`);
    this.accuracy = accuracy;
  }
}

export class LocationUnavailableError extends Error {
  code = "LOCATION_UNAVAILABLE";

  constructor() {
    super("Location services are not available on this device.");
  }
}

export class InvalidCoordinatesError extends Error {
  code = "INVALID_COORDINATES";

  constructor() {
    super("Unable to determine a valid location.");
  }
}

export function getLocationErrorCategory(error: unknown): LocationErrorCategory {
  if (error instanceof InvalidCoordinatesError) return "INVALID_COORDINATES";
  if (error instanceof InaccurateLocationError) return "INACCURATE_LOCATION";

  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  if (code === "INVALID_COORDINATES") return "INVALID_COORDINATES";
  if (code === "INACCURATE") return "INACCURATE_LOCATION";
  if (code === "LOCATION_UNAVAILABLE") return "LOCATION_UNAVAILABLE";
  if (code === 1) return "PERMISSION_DENIED";
  if (code === 2) return "POSITION_UNAVAILABLE";
  if (code === 3) return "TIMEOUT";
  if (error instanceof Error && error.message === "Location unavailable") return "LOCATION_UNAVAILABLE";
  return "POSITION_UNAVAILABLE";
}

export function getLocationErrorMessage(error: unknown): string {
  if (error instanceof InaccurateLocationError) return error.message;
  if (typeof error === "object" && error !== null && "code" in error && error.code === "INACCURATE" && "accuracy" in error && typeof error.accuracy === "number") {
    return new InaccurateLocationError(error.accuracy).message;
  }
  if (error instanceof LocationUnavailableError || (error instanceof Error && error.message === "Location unavailable")) {
    return "Location services are not available on this device. You can continue with your saved or manual location.";
  }
  if (error instanceof InvalidCoordinatesError) return error.message;

  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  if (code === 1) return "Location permission was denied. You can continue with your saved or manual location.";
  if (code === 2) return "Your location could not be determined. Please try again or use your saved or manual location.";
  if (code === 3) return "Location request timed out. Please try again or use your saved or manual location.";
  return "Unable to determine your current location. You can continue with your saved or manual location.";
}

export function startBrowserLocationWatch(
  onPosition: PositionCallback,
  onError: PositionErrorCallback,
): number {
  if (typeof navigator === "undefined" || !navigator.geolocation) throw new LocationUnavailableError();
  return navigator.geolocation.watchPosition(onPosition, onError, BROWSER_LOCATION_OPTIONS);
}

export type WatchBrowserLocationOptions = {
  policy: LocationAccuracyPolicy;
  signal?: AbortSignal;
  onPosition?: (location: NormalizedLocation) => void;
};

export function watchBrowserLocation({ policy, signal, onPosition: onLocation }: WatchBrowserLocationOptions): Promise<NormalizedLocation> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.reject(new LocationUnavailableError());
  if (signal?.aborted) return Promise.reject(new DOMException("Location request cancelled", "AbortError"));

  return new Promise((resolve, reject) => {
    const acquisitionTimeoutMs = LOCATION_ACQUISITION_TIMEOUT_MS;
    let watcherId: number | null = null;
    let settled = false;
    let lastInaccurateAccuracy: number | null = null;
    let lastPositionError: GeolocationPositionError | null = null;

    const clearAcquisition = () => {
      window.clearTimeout(timeoutId);
      if (watcherId !== null) navigator.geolocation.clearWatch(watcherId);
      signal?.removeEventListener("abort", onAbort);
    };
    const finish = (complete: () => void) => {
      if (settled) return;
      settled = true;
      clearAcquisition();
      complete();
    };
    const timeoutId = window.setTimeout(() => {
      finish(() => {
        if (lastInaccurateAccuracy !== null) {
          reject(new InaccurateLocationError(lastInaccurateAccuracy));
        } else if (lastPositionError) {
          reject(lastPositionError);
        } else {
          reject({ code: 3, message: "Location acquisition timed out" });
        }
      });
    }, acquisitionTimeoutMs);
    const onAbort = () => finish(() => reject(new DOMException("Location request cancelled", "AbortError")));

    const onPosition: PositionCallback = (position) => {
      if (settled) return;
      const { latitude, longitude, accuracy } = position.coords;
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        finish(() => reject(new InvalidCoordinatesError()));
        return;
      }
      if (!Number.isFinite(accuracy) || accuracy <= 0) {
        finish(() => reject(new InvalidCoordinatesError()));
        return;
      }

      const addressLocation = normalizeCoordinates(latitude, longitude, accuracy, "ADDRESS");
      const matchingLocation = normalizeCoordinates(latitude, longitude, accuracy, "MATCHING");

      if (policy === "ADDRESS" && !addressLocation) {
        lastInaccurateAccuracy = accuracy;
        return;
      }
      if (policy === "MATCHING" && !matchingLocation) {
        lastInaccurateAccuracy = accuracy;
        return;
      }

      const acceptedLocation = policy === "ADDRESS" ? addressLocation! : matchingLocation!;
      try {
        onLocation?.(acceptedLocation);
      } catch (error) {
        finish(() => reject(error));
        return;
      }
      finish(() => resolve(acceptedLocation));
    };
    const onError: PositionErrorCallback = (error) => {
      if (settled) return;
      if (error.code === error.PERMISSION_DENIED) {
        finish(() => reject(error));
        return;
      }
      lastPositionError = error;
    };

    try {
      signal?.addEventListener("abort", onAbort, { once: true });
      const startWatch = () => {
        if (settled) return;
        try {
          watcherId = startBrowserLocationWatch(onPosition, onError);
          if (settled && watcherId !== null) navigator.geolocation.clearWatch(watcherId);
        } catch (error) {
          finish(() => reject(error));
        }
      };
      if (typeof navigator.permissions?.query === "function") {
        void navigator.permissions.query({ name: "geolocation" }).then((permission) => {
          if (settled) return;
          if (permission.state === "denied") {
            finish(() => reject({ code: 1, message: "Location permission was denied" }));
            return;
          }
          startWatch();
        }).catch(startWatch);
      } else {
        startWatch();
      }
    } catch (error) {
      finish(() => reject(error));
    }
  });
}

export function normalizeCoordinates(
  latitude: number,
  longitude: number,
  accuracy: number,
  policy: LocationAccuracyPolicy = "MATCHING",
): NormalizedLocation | null {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(accuracy)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 || (latitude === 0 && longitude === 0)) return null;
  if (
    accuracy <= 0
    || (policy === "MATCHING" && accuracy > MAX_LOCATION_ACCURACY_METERS)
    || (policy === "ADDRESS" && accuracy > MAX_ADDRESS_ACCURACY_METERS)
  ) return null;
  return { latitude, longitude, accuracy, altitude: null, altitudeAccuracy: null, heading: null, speed: null };
}

export function retainAccurateLocationSnapshot(
  current: LiveLocationSnapshot | null,
  latitude: number,
  longitude: number,
  accuracy: number,
  updatedAt: number,
): LiveLocationSnapshot | null {
  const normalized = normalizeCoordinates(latitude, longitude, accuracy, "MATCHING");
  if (!normalized) return current;
  return {
    latitude: normalized.latitude,
    longitude: normalized.longitude,
    accuracy_m: normalized.accuracy,
    updated_at: updatedAt,
  };
}

export function shouldSendLiveLocationUpdate(current: LiveLocationSnapshot | null, next: LiveLocationSnapshot, now = Date.now()): boolean {
  if (!current) return true;

  const timeDeltaMs = now - current.updated_at;
  const hasHeartbeat = timeDeltaMs >= LOCATION_HEARTBEAT_MS;
  const latitudeDeltaMeters = Math.abs((next.latitude - current.latitude) * 111_000);
  const longitudeDeltaMeters = Math.abs((next.longitude - current.longitude) * 111_000 * Math.cos((next.latitude * Math.PI) / 180));
  const movementMeters = Math.max(latitudeDeltaMeters, longitudeDeltaMeters);

  if (movementMeters < MIN_LOCATION_MOVEMENT_METERS && timeDeltaMs < MIN_LOCATION_UPDATE_INTERVAL_MS && !hasHeartbeat) {
    return false;
  }

  return hasHeartbeat || movementMeters >= MIN_LOCATION_MOVEMENT_METERS;
}

export function getBrowserLocation(policy: LocationAccuracyPolicy = "MATCHING"): Promise<NormalizedLocation> {
  return watchBrowserLocation({ policy });
}
