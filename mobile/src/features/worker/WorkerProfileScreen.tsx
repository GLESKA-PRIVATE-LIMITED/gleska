import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { AlertCircle, BadgeCheck, Briefcase, Camera, CheckCircle2, Edit3, Home, LoaderCircle, MapPin, Plus, Save, Search, ShieldCheck, UserRound } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth, errorMessage } from "../auth/AuthProvider";
import { useLanguage } from "../auth/LanguageContext";
import { apiGet, apiPost, apiPut } from "../../lib/api";
import { getSupabaseClient } from "../../lib/supabase";
import WorkerMobileShell from "./WorkerMobileShell";

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
  profile_completed?: boolean;
  trial_active?: boolean;
  subscription_active?: boolean;
  payment_required?: boolean;
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

export default function WorkerProfileScreen() {
  const auth = useAuth();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [profile, setProfile] = useState<WorkerProfile | null>(null);
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");
  const [skills, setSkills] = useState<string[]>([]);
  const [newSkill, setNewSkill] = useState("");
  const [locationQuery, setLocationQuery] = useState("");
  const [locationResults, setLocationResults] = useState<LocationSelection[]>([]);
  const [locationLoading, setLocationLoading] = useState(false);
  const [detectedLocation, setDetectedLocation] = useState<DetectedLocation | null>(null);
  const [detectingLocation, setDetectingLocation] = useState(false);
  const [loading, setLoading] = useState(true);
  const [profileLoadError, setProfileLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [error, setError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [editingPersonal, setEditingPersonal] = useState(false);
  const [editingAddress, setEditingAddress] = useState(false);
  const [editingProfessional, setEditingProfessional] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const loadProfile = useCallback(async () => {
    if (!auth.user || auth.user.role !== "WORKER") return;
    setLoading(true);
    setProfileLoadError("");
    try {
      const result = await apiGet<WorkerProfile>("/api/v1/workers/me");
      setProfile({ ...result, skills: Array.isArray(result.skills) ? result.skills : [] });
      setName(auth.user.name || "");
      setMobile(auth.user.mobile || "");
      setEmail(auth.user.email || "");
      setSkills(Array.isArray(result.skills) ? result.skills : []);
      setLocationQuery(result.address || [result.city, result.state].filter(Boolean).join(", "));
    } catch (loadError) {
      setProfileLoadError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [auth.user]);

  useEffect(() => {
    if (auth.isLoading) return;
    if (!auth.user || auth.user.role !== "WORKER") {
      navigate("/auth/signin", { replace: true });
      return;
    }
    void Promise.resolve().then(loadProfile);
  }, [auth.isLoading, auth.user, loadProfile, navigate]);

  const change = <K extends keyof WorkerProfile>(key: K, value: WorkerProfile[K]) => {
    setProfile((current) => current ? { ...current, [key]: value } : current);
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
    setProfile((current) => current ? ({
      ...current,
      address: location.address,
      city: location.city ?? current.city,
      state: location.state ?? current.state,
      pincode: location.pincode ?? current.pincode,
      latitude: Number(location.latitude),
      longitude: Number(location.longitude),
      location_source: "SEARCH",
    }) : current);
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
      setProfile((current) => current ? ({ ...current, ...updatedProfile }) : updatedProfile);
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
    const currentProfile = profile;
    if (!currentProfile) return;
    setError("");
    setSaveMessage("");
    setSaving(true);
    try {
      const profileUpdate: Record<string, unknown> = {
        ...currentProfile,
        skills,
        marital_status: currentProfile.marital_status || null,
        blood_group: currentProfile.blood_group || null,
      };
      if (name.trim()) profileUpdate.name = name.trim();
      if (mobile.trim()) profileUpdate.mobile = mobile.trim();
      if (email.trim()) profileUpdate.email = email.trim().toLowerCase();
      if (currentProfile.trade_id?.trim()) profileUpdate.trade_id = currentProfile.trade_id.trim();
      else delete profileUpdate.trade_id;
      if (!currentProfile.pincode?.trim()) delete profileUpdate.pincode;
      const savedProfile = await apiPut<WorkerProfile>("/api/v1/workers/me", profileUpdate);
      setProfile(savedProfile);
      setSkills(Array.isArray(savedProfile.skills) ? savedProfile.skills : []);
      await auth.refreshAuth();
      setEditingPersonal(false);
      setEditingAddress(false);
      setEditingProfessional(false);
      setSaveMessage("Profile updated successfully.");
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  const addSkill = () => {
    const value = newSkill.trim();
    if (!value) return;
    if (!skills.some((skill) => skill.toLocaleLowerCase() === value.toLocaleLowerCase())) {
      setSkills((current) => [...current, value]);
    }
    setNewSkill("");
  };

  const removeSkill = (skillToRemove: string) => setSkills((current) => current.filter((skill) => skill !== skillToRemove));

  const profileStrength = (() => {
    const checks = [
      Boolean(name.trim()),
      Boolean(mobile.trim()),
      Boolean(email.trim()),
      Boolean(profile?.trade_id),
      profile?.experience_years != null,
      profile?.expected_daily_wage != null,
      Boolean(profile?.city || profile?.address),
      Boolean(profile?.availability_status && profile.availability_status !== "OFFLINE"),
    ];
    return Math.round((checks.filter(Boolean).length / checks.length) * 100);
  })();

  const membershipStatus = profile?.trial_active
    ? "Free Trial"
    : profile?.subscription_active
      ? "Active Subscription"
      : profile?.payment_required
        ? "Payment Required"
        : null;

  if (loading || auth.isLoading || !auth.user || auth.user.role !== "WORKER") {
    return <WorkerMobileShell><main className="auth-loading"><LoaderCircle size={28} className="spin" /><p>{t("auth.loading")}</p></main></WorkerMobileShell>;
  }

  if (profileLoadError || !profile) {
    return <WorkerMobileShell><main className="worker-profile-page"><section className="worker-profile-error" role="alert"><AlertCircle size={24} /><div><h1>Profile unavailable</h1><p>{profileLoadError || "Your profile could not be loaded."}</p><button type="button" className="worker-profile-button worker-profile-button--primary" onClick={() => void loadProfile()}><LoaderCircle size={17} />Try again</button></div></section></main></WorkerMobileShell>;
  }

  const displayValue = (value?: string | number | null) => value === null || value === undefined || value === "" ? "Not set" : String(value);
  const statusLabel = profile.availability_status === "AVAILABLE" ? "Available" : profile.availability_status === "ON_JOB" ? "On a job" : "Offline";

  return <WorkerMobileShell>
    <main className="worker-profile-page">
      <header className="worker-profile-page-header"><p className="worker-page-eyebrow">Worker workspace</p><h1>Your Profile</h1><p>Let others know who you are.</p></header>
      <form className="worker-profile-form" onSubmit={(event) => void save(event)}>
        <section className="worker-profile-hero">
          <div className="worker-profile-hero-main">
            <div className="worker-profile-strength" aria-label={`Profile strength ${profileStrength}%`}>
              <div className="worker-profile-strength-heading"><span>Profile Strength</span><strong>{profileStrength}%</strong></div>
              <div className="worker-profile-progress"><span style={{ width: `${profileStrength}%` }} /></div>
              <p>{profileStrength >= 100 ? "Profile 100% complete!" : "Complete your details for better job matches."}</p>
            </div>
          </div>
          <div className="worker-profile-identity">
            <div className="worker-profile-identity-copy"><div className="worker-profile-name-row"><h2>{name || "Worker"}</h2>{auth.user.is_mobile_verified && <BadgeCheck size={20} aria-label="Mobile verified" />}</div>
              <span className="worker-profile-status">{statusLabel}</span>
              {membershipStatus && <span className="worker-profile-membership">{membershipStatus}</span>}
            </div>
            <div className="worker-profile-avatar-wrap">
              <div className="worker-profile-avatar">{auth.user.profile_photo_url ? <img src={auth.user.profile_photo_url} alt={`${name || "Worker"} profile`} /> : <span>{(name || "W").charAt(0).toUpperCase()}</span>}</div>
              <input ref={photoInputRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void uploadProfilePhoto(event.target.files?.[0])} />
              <button className="worker-profile-camera" type="button" aria-label="Change profile photo" title="Change profile photo" disabled={photoUploading} onClick={() => photoInputRef.current?.click()}>{photoUploading ? <LoaderCircle size={17} className="spin" /> : <Camera size={17} />}</button>
            </div>
          </div>
        </section>

        {error && <p className="worker-profile-alert" role="alert"><AlertCircle size={18} />{error}</p>}
        {saveMessage && <p className="worker-profile-success" role="status"><CheckCircle2 size={18} />{saveMessage}</p>}

        <section className="worker-profile-card">
          <div className="worker-profile-card-heading"><span className="worker-profile-section-icon"><UserRound size={19} /></span><h2>Personal Information</h2><button className="worker-profile-edit" type="button" onClick={() => setEditingPersonal((value) => !value)}><Edit3 size={15} />{editingPersonal ? "Done" : "Edit"}</button></div>
          <div className="worker-profile-info-grid">
            <ProfileField label="Display Name" editing={editingPersonal}><input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} /></ProfileField>
            <ProfileField label="Phone Number" editing={editingPersonal}><input autoComplete="tel" value={mobile} onChange={(event) => setMobile(event.target.value)} maxLength={32} /></ProfileField>
            <ProfileField label="Email" editing={editingPersonal}><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></ProfileField>
            <ProfileField label="Marital Status" value={displayValue(profile.marital_status)} editing={editingPersonal}><select value={profile.marital_status || ""} onChange={(event) => change("marital_status", event.target.value || null)}><option value="">Not set</option>{["Unmarried", "Married", "Divorced", "Widowed", "Separated"].map((value) => <option key={value}>{value}</option>)}</select></ProfileField>
            <ProfileField label="Blood Group" value={displayValue(profile.blood_group)} editing={editingPersonal}><select value={profile.blood_group || ""} onChange={(event) => change("blood_group", event.target.value || null)}><option value="">Not set</option>{["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((value) => <option key={value}>{value}</option>)}</select></ProfileField>
          </div>
        </section>

        <section className="worker-profile-card">
          <div className="worker-profile-card-heading"><span className="worker-profile-section-icon"><MapPin size={19} /></span><h2>Addresses</h2><button className="worker-profile-edit" type="button" onClick={() => setEditingAddress((value) => !value)}><Edit3 size={15} />{editingAddress ? "Done" : "Add / Edit"}</button></div>
          <div className="worker-profile-address">
            <div className="worker-profile-address-icon"><Home size={18} /></div><div className="worker-profile-address-copy"><strong>Permanent Address</strong><p>{profile.address || [profile.city, profile.state].filter(Boolean).join(", ") || "Not configured yet"}</p>{profile.pincode && <small>PIN: {profile.pincode}</small>}</div>
          </div>
          <div className="worker-profile-address worker-profile-current-location">
            <div className="worker-profile-address-icon"><MapPin size={18} /></div><div className="worker-profile-address-copy"><strong>Current GPS Location</strong><p>{detectedLocation?.address || (profile.latitude != null && profile.longitude != null ? `Coordinates: ${profile.latitude.toFixed(4)}, ${profile.longitude.toFixed(4)}` : "Location not detected yet")}</p>{profile.location_source && <small>Source: {profile.location_source}</small>}</div><button type="button" className="worker-profile-text-action" onClick={() => void detectLocation()} disabled={detectingLocation}>{detectingLocation ? "Detecting..." : "Detect GPS"}</button>
          </div>
          {editingAddress && <div className="worker-profile-location-editor">
            <label className="worker-profile-label" htmlFor="worker-profile-location-search">Search address location</label>
            <div className="worker-profile-search-row"><input id="worker-profile-location-search" value={locationQuery} onChange={(event) => { setLocationQuery(event.target.value); setLocationResults([]); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void searchLocations(); } }} placeholder="Search your area, city or PIN code" /><button type="button" className="worker-profile-button worker-profile-button--secondary" onClick={() => void searchLocations()} disabled={locationLoading}>{locationLoading ? <LoaderCircle size={16} className="spin" /> : <Search size={16} />}Search</button></div>
            {locationResults.length > 0 && <div className="worker-profile-location-results">{locationResults.map((location) => <button type="button" key={`${location.latitude}-${location.longitude}-${location.address}`} onClick={() => selectLocation(location)}><MapPin size={17} /><span><strong>{location.locality || location.city || location.state || location.address}</strong><small>{[location.city, location.state, location.pincode].filter(Boolean).join(", ") || location.address}</small></span></button>)}</div>}
            <div className="worker-profile-info-grid worker-profile-address-fields"><ProfileField label="City" editing><input autoComplete="address-level2" value={profile.city || ""} onChange={(event) => change("city", event.target.value)} /></ProfileField><ProfileField label="State" editing><input autoComplete="address-level1" value={profile.state || ""} onChange={(event) => change("state", event.target.value)} /></ProfileField><ProfileField label="PIN Code" editing><input inputMode="numeric" autoComplete="postal-code" value={profile.pincode || ""} onChange={(event) => change("pincode", event.target.value.replace(/\D/g, "").slice(0, 6))} maxLength={6} /></ProfileField><ProfileField label="Address" editing><textarea autoComplete="street-address" value={profile.address || ""} onChange={(event) => change("address", event.target.value)} maxLength={500} rows={3} /></ProfileField></div>
            {detectedLocation && <div className="worker-profile-detected"><p>Detected current location: {detectedLocation.address}</p><button type="button" className="worker-profile-button worker-profile-button--primary" onClick={() => void confirmDetectedLocation()}>Confirm GPS location</button><button type="button" className="worker-profile-text-action" onClick={() => setDetectedLocation(null)}>Cancel</button></div>}
          </div>}
        </section>

        <section className="worker-profile-card">
          <div className="worker-profile-card-heading"><span className="worker-profile-section-icon"><Briefcase size={19} /></span><h2>Professional Details</h2><button className="worker-profile-edit" type="button" onClick={() => setEditingProfessional((value) => !value)}><Edit3 size={15} />{editingProfessional ? "Done" : "Edit"}</button></div>
          <div className="worker-profile-info-grid">
            <ProfileField label="Work Experience" value={profile.experience_years != null ? `${profile.experience_years}+ Years` : "Not set"} editing={editingProfessional}><input type="number" min="0" step="1" value={profile.experience_years ?? ""} onChange={(event) => change("experience_years", event.target.value === "" ? null : Number(event.target.value))} placeholder="Years" /></ProfileField>
            <ProfileField label="Current Profession / Trade" value={displayValue(profile.trade_id)} editing={editingProfessional}><input value={profile.trade_id || ""} onChange={(event) => change("trade_id", event.target.value)} maxLength={120} placeholder="Trade or profession" /></ProfileField>
            <ProfileField label="Expected Wage" value={profile.expected_daily_wage != null ? `₹${profile.expected_daily_wage.toLocaleString("en-IN")}/day` : "Not set"} editing={editingProfessional}><input type="number" min="0" max="1000000" step="any" value={profile.expected_daily_wage ?? ""} onChange={(event) => change("expected_daily_wage", event.target.value === "" ? null : Number(event.target.value))} placeholder="Daily wage" /></ProfileField>
            <ProfileField label="Availability" value={statusLabel} editing={editingProfessional}><select value={profile.availability_status || "OFFLINE"} onChange={(event) => change("availability_status", event.target.value as AvailabilityStatus)}><option value="AVAILABLE">Available</option><option value="ON_JOB">On a job</option><option value="OFFLINE">Offline</option></select></ProfileField>
          </div>
          <div className="worker-profile-skills"><p className="worker-profile-label">Skills / Expertise</p><div className="worker-profile-skill-list">{skills.length === 0 && <p className="worker-profile-empty">No skills added yet</p>}{skills.map((skill) => <span className="worker-profile-skill" key={skill}>{skill}{editingProfessional && <button type="button" aria-label={`Remove ${skill}`} onClick={() => removeSkill(skill)}>×</button>}</span>)}</div>{editingProfessional && <div className="worker-profile-add-skill"><input aria-label="Add skill" value={newSkill} onChange={(event) => setNewSkill(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addSkill(); } }} placeholder="Add skill" /><button type="button" className="worker-profile-button worker-profile-button--secondary" onClick={addSkill}><Plus size={16} />Add</button></div>}</div>
        </section>

        <section className="worker-profile-privacy"><span><ShieldCheck size={24} /></span><div><h2>Your information is safe with us</h2><p>We use enterprise-grade encryption to protect your data and privacy at all times.</p></div></section>
        <footer className="worker-profile-save-bar"><button className="worker-profile-button worker-profile-button--primary" type="submit" disabled={saving || photoUploading}>{saving ? <LoaderCircle size={18} className="spin" /> : <Save size={18} />}{saving ? "Saving..." : "Save Changes"}</button></footer>
      </form>
    </main>
  </WorkerMobileShell>;
}

function ProfileField({ label, value, editing, children }: { label: string; value?: string; editing: boolean; children: React.ReactNode }) {
  return <div className="worker-profile-field"><p className="worker-profile-label">{label}</p>{editing ? <div className="worker-profile-field-control">{children}</div> : <p className="worker-profile-value">{value || "Not set"}</p>}</div>;
}
