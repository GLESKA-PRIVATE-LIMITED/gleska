import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  AlertCircle,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  Camera,
  CheckCircle2,
  FileText,
  Hash,
  LoaderCircle,
  Mail,
  MapPin,
  Phone,
  Save,
  ShieldCheck,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { Navigate } from "react-router-dom";
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from "../../lib/api";
import { useRefreshOnFocus } from "../../lib/useRefreshOnFocus";
import { getSupabaseClient } from "../../lib/supabase";
import type { EmployerType } from "../../types/auth";
import { useAuth } from "../auth/AuthProvider";
import { Link } from "react-router-dom";
import EmployerMobileShell from "./EmployerMobileShell";
import "./EmployerProfileScreen.css";

type EmployerSummary = {
  id: string;
  employer_type: EmployerType;
  onboarding_status: string;
  verification_status: string;
  contact_person_name: string;
  created_at?: string;
};

type EmployerProfileResponse = {
  employer: EmployerSummary;
  profile_photo_url?: string | null;
  account: {
    name: string;
    email?: string | null;
    mobile?: string | null;
  };
  profile: Record<string, unknown>;
};

type ProfileForm = {
  business_name: string;
  company_phone: string;
  company_email: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  work_location: string;
  gstin: string;
  cin_number: string;
  pan_number: string;
};

type PhotoUploadStart = { storage_path: string };
type PhotoResponse = { profile_photo_url: string | null };

const MAX_PHOTO_SIZE = 5 * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const PROFILE_PHOTOS_BUCKET = "profile-photos";

const emptyForm: ProfileForm = {
  business_name: "",
  company_phone: "",
  company_email: "",
  address: "",
  city: "",
  state: "",
  pincode: "",
  work_location: "",
  gstin: "",
  cin_number: "",
  pan_number: "",
};

function stringValue(value: unknown) {
  return value == null ? "" : String(value);
}

function profileFormFromResponse(response: EmployerProfileResponse): ProfileForm {
  const employerType = response.employer.employer_type;
  const registered = employerType === "REGISTERED_BUSINESS" || employerType === "REGISTERED_INDUSTRY";
  const details = response.profile || {};
  const addressField = registered ? "registered_address" : "address";
  const existingAddress = details[addressField] ?? details.address ?? details.registered_address ?? details.work_location;
  return {
    business_name: employerType === "INDIVIDUAL"
      ? response.employer.contact_person_name || response.account.name
      : stringValue(details.business_name) || response.employer.contact_person_name || response.account.name,
    company_phone: stringValue(details.company_phone) || response.account.mobile || "",
    company_email: stringValue(details.company_email) || response.account.email || "",
    address: stringValue(existingAddress),
    city: stringValue(details.city),
    state: stringValue(details.state),
    pincode: stringValue(details.pincode),
    work_location: stringValue(details.work_location),
    gstin: stringValue(details.gstin),
    cin_number: stringValue(details.cin_number),
    pan_number: stringValue(details.pan_number),
  };
}

function employerTypeLabel(type?: EmployerType | null) {
  switch (type) {
    case "INDIVIDUAL": return "Individual Employer";
    case "REGISTERED_BUSINESS": return "Registered Business";
    case "REGISTERED_INDUSTRY": return "Registered Industry";
    case "UNREGISTERED_BUSINESS": return "Unregistered Business";
    default: return "Employer Account";
  }
}

function profileTitle(type?: EmployerType | null) {
  if (type === "INDIVIDUAL") return "Individual Profile";
  if (type === "UNREGISTERED_BUSINESS") return "Business Profile";
  return "Company Profile";
}

function profileDescription(type?: EmployerType | null) {
  if (type === "INDIVIDUAL") return "Manage your personal contact details, location, and account settings.";
  if (type === "UNREGISTERED_BUSINESS") return "Manage your business details, operating address, and proprietor information.";
  return "Manage your registered business identity, tax credentials, and company address.";
}

function formatMemberSince(value?: string) {
  if (!value) return "Recently joined";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently joined";
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric" }).format(date);
}

function displayValue(value: string) {
  return value.trim() || "Not set";
}

function requestError(error: unknown, fallback: string) {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : fallback;
}

function Detail({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: typeof Phone;
}) {
  const Icon = icon;
  return (
    <div className="employer-profile-detail">
      {Icon && <Icon size={15} aria-hidden="true" />}
      <div><span>{label}</span><strong>{displayValue(value)}</strong></div>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
  required = false,
  disabled = false,
  maxLength,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  disabled?: boolean;
  maxLength?: number;
  inputMode?: "numeric" | "tel" | "email" | "text";
}) {
  return (
    <label className="employer-profile-field">
      <span>{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        disabled={disabled}
        maxLength={maxLength}
        inputMode={inputMode}
      />
    </label>
  );
}

export default function EmployerProfileScreen() {
  const { user, isLoading: authLoading, nextStep, refreshAuth } = useAuth();
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [profile, setProfile] = useState<EmployerProfileResponse | null>(null);
  const [form, setForm] = useState<ProfileForm>(emptyForm);
  const [baseline, setBaseline] = useState<ProfileForm>(emptyForm);
  const [proprietorCount, setProprietorCount] = useState("");
  const [proprietorNames, setProprietorNames] = useState("");
  const [baselineProprietors, setBaselineProprietors] = useState({ count: "", names: "" });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState("");
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (authLoading || user?.role !== "EMPLOYER" || nextStep !== "DASHBOARD") return;
    let active = true;
    void apiGet<EmployerProfileResponse>("/api/v1/employers/me")
      .then((response) => {
        if (!active) return;
        const nextForm = profileFormFromResponse(response);
        const details = response.profile || {};
        const names = Array.isArray(details.proprietor_names)
          ? details.proprietor_names.map(stringValue)
          : details.proprietor_name
            ? [stringValue(details.proprietor_name)]
            : [];
        const proprietors = {
          count: stringValue(details.number_of_proprietors ?? (names.length ? names.length : "")),
          names: names.join("\n"),
        };
        setProfile(response);
        setForm(nextForm);
        setBaseline(nextForm);
        setProprietorCount(proprietors.count);
        setProprietorNames(proprietors.names);
        setBaselineProprietors(proprietors);
        setLoadError("");
      })
      .catch((error: unknown) => {
        if (active) setLoadError(requestError(error, "Unable to load employer profile."));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [authLoading, nextStep, reloadToken, user]);

  useRefreshOnFocus(
    () => setReloadToken((current) => current + 1),
    !authLoading && user?.role === "EMPLOYER" && nextStep === "DASHBOARD" && !editing && !saving && !photoBusy,
  );

  if (authLoading) return null;
  if (!user) return <Navigate to="/auth/signin?role=EMPLOYER" replace />;
  if (user.role !== "EMPLOYER") return <Navigate to={user.role === "WORKER" ? "/worker/dashboard" : "/"} replace />;
  if (nextStep !== "DASHBOARD") return <Navigate to="/employer/onboarding" replace />;

  const employer = profile?.employer;
  const employerType = employer?.employer_type ?? user.employer_type;
  const individual = employerType === "INDIVIDUAL";
  const unregistered = employerType === "UNREGISTERED_BUSINESS";
  const registered = employerType === "REGISTERED_BUSINESS" || employerType === "REGISTERED_INDUSTRY";
  const identityLocked = Boolean(
    registered &&
    (employer?.onboarding_status === "COMPLETED" || employer?.verification_status === "VERIFIED"),
  );
  const businessNameLocked = Boolean(
    !individual &&
    (employer?.onboarding_status === "COMPLETED" || (registered && employer?.verification_status === "VERIFIED")),
  );

  const updateForm = (field: keyof ProfileForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const cancelEdit = () => {
    setForm(baseline);
    setProprietorCount(baselineProprietors.count);
    setProprietorNames(baselineProprietors.names);
    setEditing(false);
    setSaveError("");
  };

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!profile || saving) return;
    const payload: Record<string, string | number | string[] | null> = {};
    const addChangedValue = (field: keyof ProfileForm, apiField: string, allowEdit = true) => {
      if (!allowEdit || form[field].trim() === baseline[field].trim()) return;
      payload[apiField] = form[field].trim() || null;
    };

    addChangedValue("business_name", individual ? "contact_person_name" : "business_name", !businessNameLocked);
    if (individual || !unregistered) {
      addChangedValue("gstin", "gstin", !identityLocked && registered);
      addChangedValue("cin_number", "cin_number", !identityLocked && registered);
      addChangedValue("pan_number", "pan_number", !identityLocked && registered);
    }
    addChangedValue("company_phone", "company_phone");
    addChangedValue("company_email", "company_email");
    addChangedValue("address", registered ? "registered_address" : "address");
    if (individual || unregistered) {
      addChangedValue("city", "city");
      addChangedValue("state", "state");
      addChangedValue("pincode", "pincode");
      addChangedValue("work_location", "work_location");
    }

    if (unregistered && (proprietorCount !== baselineProprietors.count || proprietorNames !== baselineProprietors.names)) {
      const count = Number(proprietorCount);
      const names = proprietorNames.split(/\r?\n/).map((name) => name.trim()).filter(Boolean);
      if (!Number.isInteger(count) || count < 1 || names.length !== count) {
        setSaveError("Enter a name for each proprietor and make the count match the list.");
        return;
      }
      payload.number_of_proprietors = count;
      payload.proprietor_names = names;
    }

    if (!Object.keys(payload).length) {
      setNotice("There are no profile changes to save.");
      setEditing(false);
      return;
    }

    setSaving(true);
    setSaveError("");
    setNotice("");
    try {
      await apiPut("/api/v1/employers/company-profile", payload);
      setLoading(true);
      setReloadToken((current) => current + 1);
      setEditing(false);
      setNotice(`${individual ? "Individual" : unregistered ? "Business" : "Company"} profile saved successfully.`);
      await refreshAuth();
    } catch (error: unknown) {
      setSaveError(requestError(error, "Unable to save employer profile."));
    } finally {
      setSaving(false);
    }
  };

  const uploadProfilePhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !profile) return;
    if (!ALLOWED_PHOTO_TYPES.has(file.type)) {
      setPhotoError("Only JPG, PNG, and WEBP images are allowed.");
      return;
    }
    if (file.size === 0 || file.size > MAX_PHOTO_SIZE) {
      setPhotoError("Profile photo must be between 1 byte and 5MB.");
      return;
    }

    setPhotoBusy(true);
    setPhotoError("");
    let storagePath: string | null = null;
    let completionRequested = false;
    try {
      const metadata = {
        original_filename: file.name,
        mime_type: file.type,
        file_size_bytes: file.size,
      };
      const start = await apiPost<PhotoUploadStart>("/api/v1/employers/me/profile-photo/upload-start", metadata);
      storagePath = start.storage_path;
      const { error: uploadError } = await getSupabaseClient().storage
        .from(PROFILE_PHOTOS_BUCKET)
        .upload(storagePath, file, { cacheControl: "3600", upsert: false });
      if (uploadError) throw new Error(`Profile photo upload failed: ${uploadError.message}`);

      completionRequested = true;
      const complete = await apiPost<PhotoResponse>("/api/v1/employers/me/profile-photo/upload-complete", {
        ...metadata,
        storage_path: storagePath,
      });
      if (!complete.profile_photo_url) throw new Error("The profile photo was uploaded but could not be retrieved.");
      setProfile((current) => current && { ...current, profile_photo_url: complete.profile_photo_url });
      await refreshAuth();
      setNotice("Profile image updated.");
    } catch (error: unknown) {
      const rejectedBeforePersistence = error instanceof ApiError && error.status >= 400 && error.status < 500;
      if (storagePath && (!completionRequested || rejectedBeforePersistence)) {
        const { error: cleanupError } = await getSupabaseClient().storage.from(PROFILE_PHOTOS_BUCKET).remove([storagePath]);
        if (cleanupError) console.error("Unable to clean up incomplete employer profile photo upload", cleanupError);
      }
      setPhotoError(requestError(error, "Unable to upload profile image."));
    } finally {
      setPhotoBusy(false);
    }
  };

  const removeProfilePhoto = async () => {
    if (!profile?.profile_photo_url || photoBusy) return;
    if (!window.confirm("Remove your employer profile image?")) return;
    setPhotoBusy(true);
    setPhotoError("");
    setNotice("");
    try {
      await apiDelete("/api/v1/employers/me/profile-photo");
      setProfile((current) => current && { ...current, profile_photo_url: null });
      await refreshAuth();
      setNotice("Profile image removed.");
    } catch (error: unknown) {
      setPhotoError(requestError(error, "Unable to remove profile image."));
    } finally {
      setPhotoBusy(false);
    }
  };

  const retryLoad = () => {
    setLoading(true);
    setLoadError("");
    setReloadToken((current) => current + 1);
  };

  const fieldValue = (key: keyof ProfileForm) => form[key];
  const fieldDisplay = (key: keyof ProfileForm) => baseline[key];

  return (
    <EmployerMobileShell
      name={employer?.contact_person_name || profile?.account.name || user.name}
      employerType={employerType}
      profilePhotoUrl={profile?.profile_photo_url ?? user.profile_photo_url}
    >
      <main className="employer-dashboard employer-profile-page">
        {loading && !profile ? (
          <div className="employer-profile-state" role="status"><LoaderCircle size={20} className="spin" /> Loading employer profile...</div>
        ) : loadError && !profile ? (
          <div className="employer-profile-error" role="alert">
            <AlertCircle size={20} />
            <p>{loadError}</p>
            <button type="button" className="employer-primary-button" onClick={retryLoad}>Try again</button>
          </div>
        ) : profile && employer && (
          <>
            <section className="employer-profile-banner">
              <div className="employer-profile-banner-top">
                <span className="employer-profile-type"><BriefcaseBusiness size={14} />{employerTypeLabel(employerType)}</span>
                <span className={`employer-profile-verification${employer.verification_status === "VERIFIED" ? " is-verified" : ""}`}>
                  {employer.verification_status === "VERIFIED" ? <CheckCircle2 size={14} /> : <ShieldCheck size={14} />}
                  {employer.verification_status === "VERIFIED"
                    ? individual ? "Verified Individual" : "Verified Enterprise"
                    : "Verification Pending"}
                </span>
              </div>
              <div className="employer-profile-banner-content">
                <div className="employer-profile-banner-copy">
                  <h1>{displayValue(baseline.business_name) === "Not set" ? profileTitle(employerType) : baseline.business_name}</h1>
                  <p>{profileDescription(employerType)}</p>
                </div>
                <div className="employer-profile-photo-area">
                  <div className="employer-profile-avatar">
                    {profile.profile_photo_url
                      ? <img src={profile.profile_photo_url} alt={individual ? "Profile photo" : "Business logo"} />
                      : (baseline.business_name || employer.contact_person_name || "E").charAt(0).toUpperCase()}
                  </div>
                  <input
                    ref={photoInputRef}
                    className="employer-profile-photo-input"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(event) => void uploadProfilePhoto(event)}
                  />
                  <div className="employer-profile-photo-actions">
                    <button type="button" onClick={() => photoInputRef.current?.click()} disabled={photoBusy}>
                      {photoBusy ? <LoaderCircle size={14} className="spin" /> : <Camera size={14} />}
                      {photoBusy ? "Saving" : profile.profile_photo_url ? "Edit" : "Add photo"}
                    </button>
                    {profile.profile_photo_url && (
                      <button type="button" onClick={() => void removeProfilePhoto()} disabled={photoBusy} aria-label="Delete profile image">
                        <Trash2 size={14} /> Delete
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </section>

            {notice && <p className="employer-profile-notice" role="status"><CheckCircle2 size={17} />{notice}</p>}
            {photoError && <p className="employer-profile-inline-error" role="alert">{photoError}</p>}
            {loadError && <p className="employer-profile-inline-error" role="alert">{loadError}</p>}

            <section className="employer-section-card employer-profile-summary">
              <h2>Account Summary</h2>
              <Detail label="Member since" value={formatMemberSince(employer.created_at)} icon={CalendarDays} />
              <Detail label="Account type" value={employerTypeLabel(employerType)} icon={BriefcaseBusiness} />
              <Detail label="Status" value={employer.verification_status || "Active"} icon={CheckCircle2} />
              {!individual && (
                <Link className="employer-profile-summary-link" to="/employer/director-profile">
                  <span>{unregistered ? "Proprietor Profile" : "Director Profile"}</span>
                  <span>View and update identity details</span>
                </Link>
              )}
            </section>

            <form className="employer-profile-form" onSubmit={(event) => void saveProfile(event)}>
              <section className="employer-section-card employer-profile-section">
                <div className="employer-profile-section-heading">
                  <span className="employer-profile-section-icon">{individual ? <UserRound size={20} /> : <Building2 size={20} />}</span>
                  <div>
                    <h2>{individual ? "Personal Information" : unregistered ? "Business Details" : "Company Details"}</h2>
                    <p>{individual ? "Your primary individual employer identity details" : unregistered ? "Identity and registration information for your unregistered business" : "Verified enterprise identity details and registration codes"}</p>
                  </div>
                  <button
                    className="employer-profile-edit-button"
                    type="button"
                    onClick={() => {
                      if (editing) {
                        cancelEdit();
                      } else {
                        setEditing(true);
                        setSaveError("");
                        setNotice("");
                      }
                    }}
                  >
                    {editing ? <X size={14} /> : <FileText size={14} />}
                    {editing ? "Cancel" : "Edit"}
                  </button>
                </div>
                {editing ? (
                  <div className="employer-profile-fields">
                    <TextField
                      label={individual ? "Full name" : unregistered ? "Business name" : "Company name"}
                      value={fieldValue("business_name")}
                      onChange={(value) => updateForm("business_name", value)}
                      required
                      disabled={businessNameLocked}
                      maxLength={255}
                    />
                    {businessNameLocked && <p className="employer-profile-hint">Completed business identity cannot be changed here. Contact support if this information needs correction.</p>}
                    {registered && (
                      <>
                        <TextField label="GSTIN" value={fieldValue("gstin")} onChange={(value) => updateForm("gstin", value)} disabled={identityLocked} maxLength={20} />
                        <TextField label="CIN Number" value={fieldValue("cin_number")} onChange={(value) => updateForm("cin_number", value)} disabled={identityLocked} maxLength={30} />
                        <TextField label="PAN Number" value={fieldValue("pan_number")} onChange={(value) => updateForm("pan_number", value)} disabled={identityLocked} maxLength={20} />
                        {identityLocked && <p className="employer-profile-hint">Verified legal identity is locked. Contact support to change registered identity details.</p>}
                      </>
                    )}
                    {unregistered && (
                      <>
                        <TextField label="Number of proprietors" value={proprietorCount} onChange={setProprietorCount} type="number" inputMode="numeric" />
                        <label className="employer-profile-field">
                          <span>Proprietor names (one per line)</span>
                          <textarea rows={Math.min(6, Math.max(2, Number(proprietorCount) || 2))} value={proprietorNames} onChange={(event) => setProprietorNames(event.target.value)} />
                        </label>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="employer-profile-details-grid">
                    <Detail label={individual ? "Full name" : unregistered ? "Business name" : "Company name"} value={fieldDisplay("business_name")} icon={individual ? UserRound : Building2} />
                    {registered && <>
                      <Detail label="GSTIN" value={fieldDisplay("gstin")} icon={Hash} />
                      <Detail label="CIN Number" value={fieldDisplay("cin_number")} icon={Hash} />
                      <Detail label="PAN Number" value={fieldDisplay("pan_number")} icon={Hash} />
                    </>}
                    {unregistered && <>
                      <Detail label="Number of proprietors" value={stringValue(profile.profile.number_of_proprietors)} icon={UserRound} />
                      <Detail label="Proprietor names" value={Array.isArray(profile.profile.proprietor_names) ? profile.profile.proprietor_names.map(stringValue).join(", ") : stringValue(profile.profile.proprietor_name)} icon={UserRound} />
                    </>}
                  </div>
                )}
              </section>

              <section className="employer-section-card employer-profile-section">
                <div className="employer-profile-section-heading">
                  <span className="employer-profile-section-icon"><Phone size={20} /></span>
                  <div><h2>Contact Information</h2><p>Primary phone and email for this account</p></div>
                </div>
                {editing ? (
                  <div className="employer-profile-fields employer-profile-fields-two">
                    <TextField label={individual ? "Phone number" : "Company phone"} value={fieldValue("company_phone")} onChange={(value) => updateForm("company_phone", value)} type="tel" inputMode="tel" required maxLength={32} />
                    <TextField label={individual ? "Email address" : "Company email"} value={fieldValue("company_email")} onChange={(value) => updateForm("company_email", value)} type="email" required maxLength={255} />
                  </div>
                ) : (
                  <div className="employer-profile-details-grid employer-profile-details-two">
                    <Detail label={individual ? "Phone number" : "Company phone"} value={fieldDisplay("company_phone")} icon={Phone} />
                    <Detail label={individual ? "Email address" : "Company email"} value={fieldDisplay("company_email")} icon={Mail} />
                  </div>
                )}
              </section>

              <section className="employer-section-card employer-profile-section">
                <div className="employer-profile-section-heading">
                  <span className="employer-profile-section-icon"><MapPin size={20} /></span>
                  <div><h2>Location &amp; Address</h2><p>Physical address and regional work location details</p></div>
                </div>
                {editing ? (
                  <div className="employer-profile-fields">
                    <TextField label={individual ? "Address" : unregistered ? "Business address" : "Registered office address"} value={fieldValue("address")} onChange={(value) => updateForm("address", value)} required maxLength={500} />
                    {(individual || unregistered) && (
                      <>
                        <div className="employer-profile-fields-two">
                          <TextField label="City" value={fieldValue("city")} onChange={(value) => updateForm("city", value)} maxLength={120} />
                          <TextField label="State" value={fieldValue("state")} onChange={(value) => updateForm("state", value)} maxLength={120} />
                          <TextField label="Pincode" value={fieldValue("pincode")} onChange={(value) => updateForm("pincode", value)} inputMode="numeric" maxLength={6} />
                        </div>
                        <TextField label="Work location" value={fieldValue("work_location")} onChange={(value) => updateForm("work_location", value)} maxLength={255} />
                      </>
                    )}
                  </div>
                ) : (
                  <div className="employer-profile-details-grid">
                    <Detail label={individual ? "Address" : unregistered ? "Business address" : "Registered office address"} value={fieldDisplay("address")} icon={MapPin} />
                    {(individual || unregistered) && <>
                      <Detail label="City" value={fieldDisplay("city")} />
                      <Detail label="State" value={fieldDisplay("state")} />
                      <Detail label="Pincode" value={fieldDisplay("pincode")} icon={Hash} />
                      <Detail label="Work location" value={fieldDisplay("work_location")} icon={MapPin} />
                    </>}
                  </div>
                )}
              </section>

              <section className="employer-section-card employer-profile-section">
                <div className="employer-profile-section-heading">
                  <span className="employer-profile-section-icon"><ShieldCheck size={20} /></span>
                  <div><h2>Account Details</h2><p>Account contact details and employer verification status</p></div>
                </div>
                <div className="employer-profile-details-grid employer-profile-details-two">
                  <Detail label="Account email" value={stringValue(profile.account.email)} icon={Mail} />
                  <Detail label="Account mobile" value={stringValue(profile.account.mobile)} icon={Phone} />
                  <Detail label="Verification status" value={employer.verification_status} icon={CheckCircle2} />
                  <Detail label="Onboarding status" value={employer.onboarding_status} icon={ShieldCheck} />
                </div>
              </section>

              {editing && (
                <div className="employer-profile-save-row">
                  {saveError && <p className="employer-profile-inline-error" role="alert"><AlertCircle size={16} />{saveError}</p>}
                  <button className="employer-primary-button" type="submit" disabled={saving}>
                    {saving ? <LoaderCircle size={16} className="spin" /> : <Save size={16} />}
                    {saving ? "Saving profile..." : "Save changes"}
                  </button>
                </div>
              )}
            </form>
          </>
        )}
      </main>
    </EmployerMobileShell>
  );
}
