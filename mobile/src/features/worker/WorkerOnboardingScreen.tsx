import { useEffect, useRef, useState, type FormEvent } from "react";
import { Camera, LoaderCircle, MapPin, Search, UserRound } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { AuthLayout } from "../auth/AuthScreens";
import { useAuth, errorMessage } from "../auth/AuthProvider";
import { useLanguage } from "../auth/LanguageContext";
import { apiGet, apiPost, apiPut } from "../../lib/api";
import { getSupabaseClient } from "../../lib/supabase";

 type AvailabilityStatus = "AVAILABLE" | "ON_JOB" | "OFFLINE";
 type WorkerProfile = {
  trade_id?: string | null;
  experience_years?: number | null;
  expected_daily_wage?: number | null;
  availability_status?: AvailabilityStatus;
  city?: string | null;
  state?: string | null;
  address?: string | null;
  pincode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  location_source?: "PROFILE" | "GPS" | "SEARCH" | "MAP" | null;
  marital_status?: string | null;
  blood_group?: string | null;
  skills?: string[] | null;
};

type LocationSelection = {
  address: string;
  locality?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  latitude: number;
  longitude: number;
  location_source: "SEARCH" | "MAP" | "PROFILE" | "GPS";
};

type DetectedLocation = LocationSelection & { accuracy_m: number };

function getCurrentPosition(options: PositionOptions): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, options));
}

const emptyProfile: WorkerProfile = { availability_status: "OFFLINE", skills: [] };

export default function WorkerOnboardingScreen() {
  const auth = useAuth();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [profile, setProfile] = useState<WorkerProfile>(emptyProfile);
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");
  const [skillsText, setSkillsText] = useState("");
  const [locationQuery, setLocationQuery] = useState("");
  const [locationResults, setLocationResults] = useState<LocationSelection[]>([]);
  const [locationLoading, setLocationLoading] = useState(false);
  const [detectedLocation, setDetectedLocation] = useState<DetectedLocation | null>(null);
  const [detectingLocation, setDetectingLocation] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [error, setError] = useState("");
  const photoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    if (auth.isLoading) return () => { active = false; };
    if (!auth.user || auth.user.role !== "WORKER") {
      navigate("/auth/signin", { replace: true });
      return () => { active = false; };
    }
    setName(auth.user.name || "");
    setMobile(auth.user.mobile || "");
    setEmail(auth.user.email || "");
    void apiGet<WorkerProfile>("/api/v1/workers/me").then((result) => {
      if (!active) return;
      setProfile({ ...emptyProfile, ...result });
      setSkillsText((result.skills || []).join(", "));
      setLocationQuery(result.address || [result.city, result.state].filter(Boolean).join(", "));
    }).catch((loadError) => {
      if (active) setError(errorMessage(loadError));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [auth.isLoading, auth.user, navigate]);

  const change = <K extends keyof WorkerProfile>(key: K, value: WorkerProfile[K]) => {
    setProfile((current) => ({ ...current, [key]: value }));
  };

  const searchLocations = async () => {
    if (locationQuery.trim().length < 2) {
      setError("Enter at least 2 characters to search for a location.");
      return;
    }
    setError("");
    setLocationLoading(true);
    try {
      const result = await apiGet<{ locations: LocationSelection[] }>("/api/v1/locations/search?q=" + encodeURIComponent(locationQuery.trim()));
      setLocationResults(result.locations || []);
      if (!result.locations?.length) setError("No matching locations found. Enter your city or address manually.");
    } catch (searchError) {
      setError(errorMessage(searchError));
    } finally {
      setLocationLoading(false);
    }
  };

  const selectLocation = (location: LocationSelection) => {
    setProfile((current) => ({
      ...current,
      address: location.address,
      city: location.city ?? current.city,
      state: location.state ?? current.state,
      pincode: location.pincode ?? current.pincode,
      latitude: Number(location.latitude),
      longitude: Number(location.longitude),
      location_source: "SEARCH",
    }));
    setLocationQuery(location.address);
    setLocationResults([]);
    setError("");
  };

  const detectLocation = async () => {
    if (!navigator.geolocation) {
      setError("Location services are not available on this device. You can enter your address manually.");
      return;
    }
    setError("");
    setDetectingLocation(true);
    try {
      let position: GeolocationPosition;
      try {
        position = await getCurrentPosition({ enableHighAccuracy: false, maximumAge: 300000, timeout: 30000 });
      } catch (positionError) {
        const code = (positionError as GeolocationPositionError).code;
        if (code !== 2 && code !== 3) throw positionError;
        position = await getCurrentPosition({ enableHighAccuracy: true, maximumAge: 0, timeout: 45000 });
      }
      const { latitude, longitude, accuracy } = position.coords;
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || accuracy <= 0 || accuracy > 1000) {
        throw new Error(`Location accuracy is too low (${Math.round(accuracy)}m). Enable device location services or search for your address.`);
      }
      const result = await apiGet<LocationSelection>(`/api/v1/locations/reverse?latitude=${latitude}&longitude=${longitude}`);
      setDetectedLocation({
        ...result,
        address: result.address || [result.city, result.state].filter(Boolean).join(", "),
        latitude,
        longitude,
        accuracy_m: accuracy,
        location_source: "GPS",
      });
    } catch (locationError) {
      const code = (locationError as GeolocationPositionError).code;
      setError(code === 1
        ? "Location permission was denied. Enable location access or enter your address manually."
        : errorMessage(locationError));
    } finally {
      setDetectingLocation(false);
    }
  };

  const confirmDetectedLocation = async () => {
    if (!detectedLocation) return;
    setError("");
    try {
      await apiPut("/api/v1/workers/me/location", {
        latitude: detectedLocation.latitude,
        longitude: detectedLocation.longitude,
        accuracy_m: detectedLocation.accuracy_m,
      });
      const updatedProfile = await apiPut<WorkerProfile>("/api/v1/workers/me", {
        address: detectedLocation.address,
        city: detectedLocation.city,
        state: detectedLocation.state,
        pincode: detectedLocation.pincode,
        latitude: detectedLocation.latitude,
        longitude: detectedLocation.longitude,
        location_source: "GPS",
      });
      setProfile((current) => ({ ...current, ...updatedProfile }));
      setLocationQuery(detectedLocation.address);
      setDetectedLocation(null);
      await auth.refreshAuth();
    } catch (locationError) {
      setError(errorMessage(locationError));
    }
  };

  const uploadProfilePhoto = async (file?: File) => {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Only JPG, PNG, and WEBP images are allowed.");
      return;
    }
    if (file.size === 0 || file.size > 5 * 1024 * 1024) {
      setError("Profile photo must be between 1 byte and 5MB.");
      return;
    }

    setError("");
    setPhotoUploading(true);
    try {
      const request = {
        original_filename: file.name,
        mime_type: file.type,
        file_size_bytes: file.size,
      };
      const { storage_path: storagePath } = await apiPost<{ storage_path: string }>("/api/v1/workers/me/profile-photo/upload-start", request);
      const { error: uploadError } = await getSupabaseClient().storage.from("profile-photos").upload(storagePath, file, {
        cacheControl: "3600",
        upsert: false,
      });
      if (uploadError) throw new Error(`Profile photo upload failed: ${uploadError.message}`);
      await apiPost("/api/v1/workers/me/profile-photo/upload-complete", {
        ...request,
        storage_path: storagePath,
      });
      await auth.refreshAuth();
    } catch (uploadError) {
      setError(errorMessage(uploadError));
    } finally {
      setPhotoUploading(false);
      if (photoInputRef.current) photoInputRef.current.value = "";
    }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (!name.trim() || mobile.replace(/\D/g, "").length < 10 || !email.trim()) {
      setError("Name, mobile number, and email are required to complete your Worker profile.");
      return;
    }
    if (!profile.trade_id?.trim()) {
      setError("Enter your trade or profession.");
      return;
    }
    if (profile.experience_years === null || profile.experience_years === undefined || !Number.isInteger(profile.experience_years) || profile.experience_years < 0) {
      setError("Enter a whole number of years of experience (0 or more).");
      return;
    }
    if (profile.expected_daily_wage === null || profile.expected_daily_wage === undefined || profile.expected_daily_wage < 0 || profile.expected_daily_wage > 1000000) {
      setError("Enter an expected daily wage between ₹0 and ₹10,00,000.");
      return;
    }
    if (!profile.city?.trim() && !profile.address?.trim()) {
      setError("Enter a city or address.");
      return;
    }
    if (!profile.availability_status || profile.availability_status === "OFFLINE") {
      setError("Choose an available status to complete your profile.");
      return;
    }
    if (profile.pincode && !/^\d{6}$/.test(profile.pincode)) {
      setError("Enter a valid 6-digit PIN code.");
      return;
    }

    setSaving(true);
    try {
      await apiPut<WorkerProfile>("/api/v1/workers/me", {
        ...profile,
        name: name.trim(),
        mobile: mobile.trim(),
        email: email.trim().toLowerCase(),
        trade_id: profile.trade_id.trim(),
        skills: skillsText.split(",").map((skill) => skill.trim()).filter(Boolean),
      });
      const state = await auth.refreshAuth();
      if (state.user.role === "WORKER" && state.next_step === "DASHBOARD") {
        navigate("/worker/dashboard", { replace: true });
      } else {
        setError("Your profile was saved. Complete the required details to continue.");
      }
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  if (loading || auth.isLoading || !auth.user || auth.user.role !== "WORKER") {
    return <main className="auth-loading"><LoaderCircle size={28} className="spin" /><p>{t("auth.loading")}</p></main>;
  }

  return <AuthLayout>
    <main className="auth-content auth-content-wide">
      <section className="auth-card onboarding-card">
        <p className="auth-eyebrow">Worker profile</p>
        <h1>Complete your profile</h1>
        <p className="auth-description">Your profile information is saved to GLESKA and used to determine your onboarding status.</p>
        <section className="onboarding-photo-section" aria-label="Profile photo">
          <div className="onboarding-photo-preview">
            {auth.user.profile_photo_url ? <img src={auth.user.profile_photo_url} alt="Worker profile" /> : <UserRound size={34} />}
          </div>
          <div className="onboarding-photo-copy">
            <strong>Profile photo</strong>
            <span>JPG, PNG or WEBP, up to 5MB</span>
            <input ref={photoInputRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void uploadProfilePhoto(event.target.files?.[0])} />
            <button className="text-link onboarding-photo-button" type="button" disabled={photoUploading} onClick={() => photoInputRef.current?.click()}>{photoUploading ? <LoaderCircle size={16} className="spin" /> : <Camera size={16} />}{photoUploading ? "Uploading..." : "Change photo"}</button>
          </div>
        </section>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <form className="onboarding-form" onSubmit={(event) => void save(event)}>
          <div className="onboarding-grid">
            <label className="auth-field"><span>Full name *</span><input className="auth-input" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required /></label>
            <label className="auth-field"><span>Mobile number *</span><input className="auth-input" autoComplete="tel" value={mobile} onChange={(event) => setMobile(event.target.value)} maxLength={32} required /></label>
            <label className="auth-field"><span>Email *</span><input className="auth-input" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
            <label className="auth-field"><span>Trade or profession *</span><input className="auth-input" value={profile.trade_id || ""} onChange={(event) => change("trade_id", event.target.value)} maxLength={120} required /></label>
            <label className="auth-field"><span>Experience (years) *</span><input className="auth-input" type="number" min={0} step={1} value={profile.experience_years ?? ""} onChange={(event) => change("experience_years", event.target.value === "" ? null : Number(event.target.value))} required /></label>
            <label className="auth-field"><span>Expected daily wage (₹) *</span><input className="auth-input" type="number" min={0} max={1000000} step="any" value={profile.expected_daily_wage ?? ""} onChange={(event) => change("expected_daily_wage", event.target.value === "" ? null : Number(event.target.value))} required /></label>
            <div className="auth-field onboarding-full"><span>Find your location</span><div className="location-search-row"><input className="auth-input" value={locationQuery} onChange={(event) => { setLocationQuery(event.target.value); setLocationResults([]); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void searchLocations(); } }} placeholder="Search your area, city or PIN code" /><button className="auth-secondary location-search-button" type="button" onClick={() => void searchLocations()} disabled={locationLoading}>{locationLoading ? <LoaderCircle size={16} className="spin" /> : <Search size={16} />}<span>Search</span></button></div><button className="location-detect-button" type="button" onClick={() => void detectLocation()} disabled={detectingLocation}>{detectingLocation ? <LoaderCircle size={16} className="spin" /> : <MapPin size={16} />}<span>Use my current location</span></button>{locationResults.length > 0 && <div className="location-results">{locationResults.map((location) => <button className="location-result" key={`${location.latitude}-${location.longitude}-${location.address}`} type="button" onClick={() => selectLocation(location)}><MapPin size={17} /><span><strong>{location.locality || location.city || location.state || location.address}</strong><small>{[location.city, location.state, location.pincode].filter(Boolean).join(", ") || location.address}</small></span></button>)}</div>}{detectedLocation && <div className="detected-location"><p>Detected current location: {detectedLocation.address}</p><button type="button" className="text-link" onClick={() => void confirmDetectedLocation()}>Confirm GPS location</button><button type="button" className="text-link" onClick={() => setDetectedLocation(null)}>Cancel</button></div>}</div>
            <label className="auth-field"><span>City *</span><input className="auth-input" autoComplete="address-level2" value={profile.city || ""} onChange={(event) => change("city", event.target.value)} /></label>
            <label className="auth-field"><span>State</span><input className="auth-input" autoComplete="address-level1" value={profile.state || ""} onChange={(event) => change("state", event.target.value)} /></label>
            <label className="auth-field onboarding-full"><span>Address</span><textarea className="auth-input auth-textarea" autoComplete="street-address" value={profile.address || ""} onChange={(event) => change("address", event.target.value)} maxLength={500} rows={3} /></label>
            <label className="auth-field"><span>PIN code</span><input className="auth-input" inputMode="numeric" autoComplete="postal-code" value={profile.pincode || ""} onChange={(event) => change("pincode", event.target.value.replace(/\D/g, "").slice(0, 6))} maxLength={6} /></label>
            <label className="auth-field"><span>Availability *</span><select className="auth-input" value={profile.availability_status || "OFFLINE"} onChange={(event) => change("availability_status", event.target.value as AvailabilityStatus)}><option value="OFFLINE">Offline</option><option value="AVAILABLE">Available</option><option value="ON_JOB">On job</option></select></label>
            <label className="auth-field onboarding-full"><span>Skills (comma-separated)</span><input className="auth-input" value={skillsText} onChange={(event) => setSkillsText(event.target.value)} /></label>
            <label className="auth-field"><span>Marital status</span><select className="auth-input" value={profile.marital_status || ""} onChange={(event) => change("marital_status", event.target.value || null)}><option value="">Select</option><option>Unmarried</option><option>Married</option><option>Divorced</option><option>Widowed</option><option>Separated</option></select></label>
            <label className="auth-field"><span>Blood group</span><select className="auth-input" value={profile.blood_group || ""} onChange={(event) => change("blood_group", event.target.value || null)}><option value="">Select</option>{["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((value) => <option key={value}>{value}</option>)}</select></label>
          </div>
          <button className="auth-primary onboarding-submit" type="submit" disabled={saving}>{saving && <LoaderCircle size={17} className="spin" />}Save profile</button>
        </form>
      </section>
    </main>
  </AuthLayout>;
}
