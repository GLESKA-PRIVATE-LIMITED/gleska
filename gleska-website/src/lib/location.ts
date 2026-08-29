export const MAX_LOCATION_ACCURACY_METERS = 1000;

export class InaccurateLocationError extends Error {
  code = "INACCURATE";
  accuracy: number;

  constructor(accuracy: number) {
    super("Couldn't determine your current location.");
    this.accuracy = accuracy;
  }
}

function getBrowserPosition(options: PositionOptions): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}

export async function getBrowserLocation(): Promise<GeolocationCoordinates> {
  if (!navigator.geolocation) throw new Error("Location unavailable");

  let position: GeolocationPosition;
  try {
    position = await getBrowserPosition({ enableHighAccuracy: false, maximumAge: 300000, timeout: 30000 });
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    if (code !== 2 && code !== 3) throw error;
    position = await getBrowserPosition({ enableHighAccuracy: true, maximumAge: 0, timeout: 45000 });
  }

  const { latitude, longitude, accuracy } = position.coords;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(accuracy) || accuracy <= 0 || accuracy > MAX_LOCATION_ACCURACY_METERS || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw new InaccurateLocationError(accuracy);
  }
  return position.coords;
}
