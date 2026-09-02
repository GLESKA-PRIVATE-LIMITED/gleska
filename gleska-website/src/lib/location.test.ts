import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getBrowserLocation,
  normalizeCoordinates,
  InaccurateLocationError,
  MAX_LOCATION_ACCURACY_METERS,
} from './location';

describe('location.ts - Error Handling', () => {
  beforeEach(() => {
    // Mock navigator.geolocation
    global.navigator.geolocation = {
      getCurrentPosition: vi.fn(),
      watchPosition: vi.fn(),
      clearWatch: vi.fn(),
    } as any;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('normalizeCoordinates', () => {
    it('accepts coordinates with accuracy <= 1000m', () => {
      const result = normalizeCoordinates(18.6013, 73.7815, 100);
      expect(result).not.toBeNull();
      expect(result?.accuracy).toBe(100);
    });

    it('accepts coordinates with accuracy exactly 1000m', () => {
      const result = normalizeCoordinates(18.6013, 73.7815, 1000);
      expect(result).not.toBeNull();
      expect(result?.accuracy).toBe(1000);
    });

    it('rejects coordinates with accuracy > 1000m', () => {
      const result = normalizeCoordinates(18.6013, 73.7815, 1001);
      expect(result).toBeNull();
    });

    it('rejects coordinates with accuracy = 200km (200000m)', () => {
      const result = normalizeCoordinates(18.6013, 73.7815, 200000);
      expect(result).toBeNull();
    });

    it('rejects invalid latitude', () => {
      const result = normalizeCoordinates(91, 73.7815, 100);
      expect(result).toBeNull();
    });

    it('rejects invalid longitude', () => {
      const result = normalizeCoordinates(18.6013, 181, 100);
      expect(result).toBeNull();
    });

    it('rejects zero or negative accuracy', () => {
      expect(normalizeCoordinates(18.6013, 73.7815, 0)).toBeNull();
      expect(normalizeCoordinates(18.6013, 73.7815, -100)).toBeNull();
    });
  });

  describe('InaccurateLocationError', () => {
    it('has code = "INACCURATE"', () => {
      const error = new InaccurateLocationError(5000);
      expect(error.code).toBe('INACCURATE');
    });

    it('stores the accuracy value', () => {
      const error = new InaccurateLocationError(5000);
      expect(error.accuracy).toBe(5000);
    });

    it('shows accuracy in km in message for 200km', () => {
      const error = new InaccurateLocationError(200000);
      expect(error.message).toContain('200km');
    });

    it('shows accuracy in km in message for 5km', () => {
      const error = new InaccurateLocationError(5000);
      expect(error.message).toContain('5km');
    });

    it('is an instance of Error', () => {
      const error = new InaccurateLocationError(5000);
      expect(error instanceof Error).toBe(true);
    });
  });

  describe('getBrowserLocation', () => {
    it('throws InaccurateLocationError when accuracy > 1000m', async () => {
      const mockGetCurrentPosition = vi.fn((success) => {
        success({
          coords: {
            latitude: 18.6013,
            longitude: 73.7815,
            accuracy: 200000, // 200km - too inaccurate
            altitude: null,
            altitudeAccuracy: null,
            heading: null,
            speed: null,
          },
        } as GeolocationPosition);
      });

      (navigator.geolocation.getCurrentPosition as any) = mockGetCurrentPosition;

      await expect(getBrowserLocation()).rejects.toThrow(InaccurateLocationError);
      await expect(getBrowserLocation()).rejects.toMatchObject({ code: 'INACCURATE', accuracy: 200000 });
    });

    it('succeeds with accuracy <= 1000m', async () => {
      const mockGetCurrentPosition = vi.fn((success) => {
        success({
          coords: {
            latitude: 18.6013,
            longitude: 73.7815,
            accuracy: 100, // Good accuracy
            altitude: null,
            altitudeAccuracy: null,
            heading: null,
            speed: null,
          },
        } as GeolocationPosition);
      });

      (navigator.geolocation.getCurrentPosition as any) = mockGetCurrentPosition;

      const result = await getBrowserLocation();
      expect(result.latitude).toBe(18.6013);
      expect(result.longitude).toBe(73.7815);
      expect(result.accuracy).toBe(100);
    });

    it('retries with enableHighAccuracy on position unavailable (code 2)', async () => {
      const mockGetCurrentPosition = vi.fn()
        .mockImplementationOnce((_success, error) => {
          error({ code: 2 } as GeolocationPositionError); // Position unavailable
        })
        .mockImplementationOnce((success) => {
          success({
            coords: {
              latitude: 18.6013,
              longitude: 73.7815,
              accuracy: 100,
              altitude: null,
              altitudeAccuracy: null,
              heading: null,
              speed: null,
            },
          } as GeolocationPosition);
        });

      (navigator.geolocation.getCurrentPosition as any) = mockGetCurrentPosition;

      const result = await getBrowserLocation();
      expect(result.latitude).toBe(18.6013);
      expect(mockGetCurrentPosition).toHaveBeenCalledTimes(2); // Called twice (retry)
    });

    it('retries with enableHighAccuracy on timeout (code 3)', async () => {
      const mockGetCurrentPosition = vi.fn()
        .mockImplementationOnce((_success, error) => {
          error({ code: 3 } as GeolocationPositionError); // Timeout
        })
        .mockImplementationOnce((success) => {
          success({
            coords: {
              latitude: 18.6013,
              longitude: 73.7815,
              accuracy: 100,
              altitude: null,
              altitudeAccuracy: null,
              heading: null,
              speed: null,
            },
          } as GeolocationPosition);
        });

      (navigator.geolocation.getCurrentPosition as any) = mockGetCurrentPosition;

      const result = await getBrowserLocation();
      expect(result.latitude).toBe(18.6013);
      expect(mockGetCurrentPosition).toHaveBeenCalledTimes(2); // Called twice (retry)
    });

    it('throws on permission denied (code 1) without retry', async () => {
      const mockGetCurrentPosition = vi.fn((_success, error) => {
        error({ code: 1 } as GeolocationPositionError); // Permission denied
      });

      (navigator.geolocation.getCurrentPosition as any) = mockGetCurrentPosition;

      await expect(getBrowserLocation()).rejects.toThrow();
      expect(mockGetCurrentPosition).toHaveBeenCalledTimes(1); // Only called once, no retry
    });

    it('throws when navigator.geolocation is unavailable', async () => {
      (navigator.geolocation as any) = undefined;

      await expect(getBrowserLocation()).rejects.toThrow('Location unavailable');
    });
  });
});
