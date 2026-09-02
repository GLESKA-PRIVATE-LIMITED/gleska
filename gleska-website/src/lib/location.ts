export const MAX_LOCATION_ACCURACY_METERS = 1000;
export const LIVE_LOCATION_UPDATE_INTERVAL_MS = 15000;
export const MIN_LOCATION_UPDATE_INTERVAL_MS = LIVE_LOCATION_UPDATE_INTERVAL_MS;
export const MIN_LOCATION_MOVEMENT_METERS = 25;
export const LOCATION_HEARTBEAT_MS = 60000;

export type LiveLocationSnapshot = {
  latitude: number;
  longitude: number;
  accuracy_m: number;
  updated_at: number;
};

export class InaccurateLocationError extends Error {
  code = "INACCURATE";
  accuracy: number;

  constructor(accuracy: number) {
    super(`Location accuracy is too low (${Math.round(accuracy / 1000)}km). Please enable device location services or try from a device with GPS.`);
    this.accuracy = accuracy;
  }
}

function getBrowserPosition(options: PositionOptions): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}

export function normalizeCoordinates(latitude: number, longitude: number, accuracy: number): GeolocationCoordinates | null {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(accuracy)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  if (accuracy <= 0 || accuracy > MAX_LOCATION_ACCURACY_METERS) return null;
  return { latitude, longitude, accuracy, altitude: null, altitudeAccuracy: null, heading: null, speed: null };
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

export async function getBrowserLocation(): Promise<GeolocationCoordinates> {
  if (!navigator.geolocation) throw new Error("Location unavailable");

  let position: GeolocationPosition;
  try {
    position = await getBrowserPosition({ enableHighAccuracy: false, maximumAge: 300000, timeout: 30000 });
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    if (code !== 2 && code !== 3) throw error;
    // Retry with higher accuracy for position unavailable or timeout
    position = await getBrowserPosition({ enableHighAccuracy: true, maximumAge: 0, timeout: 45000 });
  }

  const { latitude, longitude, accuracy } = position.coords;
  const validated = normalizeCoordinates(latitude, longitude, accuracy);
  if (!validated) {
    // Return raw accuracy for better error message
    throw new InaccurateLocationError(accuracy);
  }
  return validated;
}
