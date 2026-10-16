import { useEffect, useState, type FormEvent } from "react";
import { AlertCircle, ArrowLeft, CheckCircle2, FileText, LoaderCircle, Save, ShieldCheck, UserRound } from "lucide-react";
import { Link, Navigate } from "react-router-dom";
import { ApiError, apiGet, apiPut } from "../../lib/api";
import { useRefreshOnFocus } from "../../lib/useRefreshOnFocus";
import type { EmployerType } from "../../types/auth";
import { useAuth } from "../auth/AuthProvider";
import EmployerMobileShell from "./EmployerMobileShell";

type DirectorForm = {
  director_name: string;
  director_email: string;
  director_phone: string;
  director_address: string;
  director_aadhaar: string;
  director_pan: string;
  director_din: string;
  director_blood_group: string;
};

type EmployerResponse = {
  employer: {
    id: string;
    employer_type: EmployerType;
    onboarding_status: string;
    verification_status: string;
    contact_person_name: string;
    created_at?: string;
  };
  account: { name: string; email?: string | null; mobile?: string | null };
  profile: Record<string, unknown>;
  profile_photo_url?: string | null;
};

const emptyForm: DirectorForm = {
  director_name: "",
  director_email: "",
  director_phone: "",
  director_address: "",
  director_aadhaar: "",
  director_pan: "",
  director_din: "",
  director_blood_group: "",
};

function valueOf(value: unknown) {
  return value == null ? "" : String(value);
}

function formFromResponse(response: EmployerResponse): DirectorForm {
  const unregistered = response.employer.employer_type === "UNREGISTERED_BUSINESS";
  const details = response.profile || {};
  const metadata = Array.isArray(details.director_data) &&
    details.director_data[0] && typeof details.director_data[0] === "object"
    ? details.director_data[0] as Record<string, unknown>
    : {};
  const proprietorNames = Array.isArray(details.proprietor_names) ? details.proprietor_names : [];
  return {
    director_name: valueOf(unregistered
      ? details.proprietor_name ?? proprietorNames[0] ?? response.employer.contact_person_name
      : details.director_name ?? response.employer.contact_person_name ?? response.account.name),
    director_email: valueOf(details.director_email ?? details.company_email ?? response.account.email),
    director_phone: valueOf(details.director_phone ?? details.company_phone ?? response.account.mobile),
    director_address: valueOf(details.director_address ?? details.address ?? details.registered_address),
    director_aadhaar: valueOf(unregistered ? details.proprietor_aadhaar : details.director_aadhaar),
    director_pan: valueOf(details.director_pan ?? details.pan_number),
    director_din: valueOf(details.director_din ?? metadata.din),
    director_blood_group: valueOf(details.director_blood_group ?? metadata.blood_group),
  };
}

function errorMessage(error: unknown) {
  return error instanceof ApiError || error instanceof Error
    ? error.message
    : "Unable to load director profile.";
}

function masked(value: string) {
  if (!value) return "Not set";
  if (value.length <= 4) return "•".repeat(value.length);
  return `${"•".repeat(value.length - 4)}${value.slice(-4)}`;
}

function DirectorField({
  label,
  value,
  onChange,
  locked,
  sensitive = false,
  inputMode,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  locked: boolean;
  sensitive?: boolean;
  inputMode?: "text" | "tel" | "email";
  required?: boolean;
}) {
  return (
    <label className="employer-profile-field">
      <span>{label}</span>
      <input
        value={value}
        type={inputMode === "email" ? "email" : inputMode === "tel" ? "tel" : "text"}
        inputMode={inputMode}
        onChange={(event) => onChange(event.target.value)}
        disabled={locked}
        required={required}
        autoComplete="off"
        aria-label={sensitive ? `${label}; sensitive information` : undefined}
      />
    </label>
  );
}

export default function EmployerDirectorProfileScreen() {
  const { user, isLoading: authLoading, nextStep } = useAuth();
  const [response, setResponse] = useState<EmployerResponse | null>(null);
  const [form, setForm] = useState<DirectorForm>(emptyForm);
  const [baseline, setBaseline] = useState<DirectorForm>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (authLoading || user?.role !== "EMPLOYER" || nextStep !== "DASHBOARD") return;
    let active = true;
    void apiGet<EmployerResponse>("/api/v1/employers/me")
      .then((data) => {
        if (!active) return;
        setResponse(data);
        const values = formFromResponse(data);
        setForm(values);
        setBaseline(values);
        setLoadError("");
      })
      .catch((loadFailure: unknown) => {
        if (active) setLoadError(errorMessage(loadFailure));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [authLoading, nextStep, reload, user]);

  useRefreshOnFocus(
    () => setReload((current) => current + 1),
    !authLoading && user?.role === "EMPLOYER" && nextStep === "DASHBOARD" && !editing && !saving,
  );

  if (authLoading) return null;
  if (!user) return <Navigate to="/auth/signin?role=EMPLOYER" replace />;
  if (user.role !== "EMPLOYER") return <Navigate to={user.role === "WORKER" ? "/worker/dashboard" : "/"} replace />;
  if (nextStep !== "DASHBOARD") return <Navigate to="/employer/onboarding" replace />;
  if (response?.employer.employer_type === "INDIVIDUAL") return <Navigate to="/employer/company-profile" replace />;

  const employer = response?.employer;
  const unregistered = employer?.employer_type === "UNREGISTERED_BUSINESS";
  const industry = employer?.employer_type === "REGISTERED_INDUSTRY";
  const identityLocked = employer?.onboarding_status === "COMPLETED";
  const supportedFields: (keyof DirectorForm)[] = unregistered
    ? ["director_name", "director_aadhaar"]
    : [
      "director_name",
      "director_email",
      "director_phone",
      "director_address",
      "director_aadhaar",
      "director_pan",
      ...(industry ? ["director_din", "director_blood_group"] as const : []),
    ];

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!response || saving) return;
    const payload: Record<string, string | null> = {};
    for (const field of supportedFields) {
      if (identityLocked && ["director_name", "director_aadhaar", "director_pan"].includes(field)) continue;
      if (form[field].trim() !== baseline[field].trim()) payload[field] = form[field].trim() || null;
    }
    if (!Object.keys(payload).length) {
      setNotice("There are no profile changes to save.");
      setEditing(false);
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      await apiPut("/api/v1/employers/director-profile", payload);
      setLoading(true);
      setReload((current) => current + 1);
      setEditing(false);
      setNotice(`${unregistered ? "Proprietor" : "Director"} profile saved successfully.`);
    } catch (saveError: unknown) {
      setError(errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  const set = (field: keyof DirectorForm, next: string) => setForm((current) => ({ ...current, [field]: next }));
  const directorLabel = unregistered ? "Proprietor" : "Director";
  const profileTitle = `${directorLabel} Profile`;
  const retry = () => {
    setLoading(true);
    setLoadError("");
    setReload((current) => current + 1);
  };

  return (
    <EmployerMobileShell
      name={employer?.contact_person_name || response?.account.name || user.name}
      employerType={employer?.employer_type}
      profilePhotoUrl={response?.profile_photo_url}
    >
      <main className="employer-dashboard employer-profile-page">
        <Link className="employer-profile-back-link" to="/employer/company-profile">
          <ArrowLeft size={15} /> Back to Company Profile
        </Link>
        {loading && !response ? (
          <div className="employer-profile-state" role="status"><LoaderCircle size={20} className="spin" /> Loading {profileTitle.toLowerCase()}...</div>
        ) : loadError && !response ? (
          <div className="employer-profile-error" role="alert">
            <AlertCircle size={20} /><p>{loadError}</p>
            <button type="button" className="employer-primary-button" onClick={retry}>Try again</button>
          </div>
        ) : employer && response ? (
          <>
            <section className="employer-profile-banner">
              <div className="employer-profile-banner-top">
                <span className="employer-profile-type"><UserRound size={14} />{unregistered ? "Unregistered Business" : employer.employer_type === "REGISTERED_INDUSTRY" ? "Registered Industry" : "Registered Business"}</span>
                <span className={`employer-profile-verification${employer.verification_status === "VERIFIED" ? " is-verified" : ""}`}>
                  <ShieldCheck size={14} />{employer.verification_status === "VERIFIED" ? "Verified Enterprise" : unregistered ? "Proprietor Record" : "Director Record"}
                </span>
              </div>
              <div className="employer-profile-banner-content">
                <div className="employer-profile-banner-copy">
                  <h1>{form.director_name || employer.contact_person_name || profileTitle}</h1>
                  <p>{unregistered ? "Manage proprietor identity details for your business." : "Manage the authorized director's contact and verification details."}</p>
                </div>
                <div className="employer-profile-avatar">{(form.director_name || employer.contact_person_name || "D").charAt(0).toUpperCase()}</div>
              </div>
            </section>

            {notice && <p className="employer-profile-notice" role="status"><CheckCircle2 size={17} />{notice}</p>}
            {error && <p className="employer-profile-inline-error" role="alert"><AlertCircle size={16} />{error}</p>}
            {loadError && <p className="employer-profile-inline-error" role="alert">{loadError}</p>}

            <form className="employer-profile-form" onSubmit={(event) => void save(event)}>
              <section className="employer-section-card employer-profile-section">
                <div className="employer-profile-section-heading">
                  <span className="employer-profile-section-icon"><UserRound size={20} /></span>
                  <div><h2>{unregistered ? "Proprietor Information" : "Director Information"}</h2><p>Contact and personal information for the authorized representative</p></div>
                  <button className="employer-profile-edit-button" type="button" onClick={() => {
                    if (editing) {
                      setForm(baseline);
                      setEditing(false);
                      setError("");
                    } else {
                      setEditing(true);
                      setError("");
                      setNotice("");
                    }
                  }}>{editing ? "Cancel" : "Edit"}</button>
                </div>
                {editing ? (
                  <div className="employer-profile-fields">
                    <DirectorField label={`${directorLabel} name`} value={form.director_name} onChange={(next) => set("director_name", next)} locked={identityLocked} required />
                    {!unregistered && <>
                      <div className="employer-profile-fields-two">
                        <DirectorField label="Email address" value={form.director_email} onChange={(next) => set("director_email", next)} locked={false} inputMode="email" required />
                        <DirectorField label="Phone number" value={form.director_phone} onChange={(next) => set("director_phone", next)} locked={false} inputMode="tel" required />
                      </div>
                      <DirectorField label="Address" value={form.director_address} onChange={(next) => set("director_address", next)} locked={false} required />
                    </>}
                    <DirectorField label="Aadhaar number" value={form.director_aadhaar} onChange={(next) => set("director_aadhaar", next)} locked={identityLocked} sensitive />
                    {!unregistered && <>
                      <DirectorField label="PAN number" value={form.director_pan} onChange={(next) => set("director_pan", next)} locked={identityLocked} sensitive />
                      {industry && <div className="employer-profile-fields-two">
                        <DirectorField label="DIN" value={form.director_din} onChange={(next) => set("director_din", next)} locked={false} />
                        <DirectorField label="Blood group" value={form.director_blood_group} onChange={(next) => set("director_blood_group", next)} locked={false} />
                      </div>}
                    </>}
                    {identityLocked && <p className="employer-profile-hint">Verified identity fields are locked after onboarding is complete.</p>}
                  </div>
                ) : (
                  <div className="employer-profile-details-grid">
                    <div className="employer-profile-detail"><UserRound size={15} /><div><span>{directorLabel} name</span><strong>{form.director_name || "Not set"}</strong></div></div>
                    {!unregistered && <>
                      <div className="employer-profile-detail"><FileText size={15} /><div><span>Email address</span><strong>{form.director_email || "Not set"}</strong></div></div>
                      <div className="employer-profile-detail"><FileText size={15} /><div><span>Phone number</span><strong>{form.director_phone || "Not set"}</strong></div></div>
                      <div className="employer-profile-detail"><FileText size={15} /><div><span>Address</span><strong>{form.director_address || "Not set"}</strong></div></div>
                    </>}
                    <div className="employer-profile-detail"><ShieldCheck size={15} /><div><span>Aadhaar number</span><strong>{masked(form.director_aadhaar)}</strong></div></div>
                    {!unregistered && <>
                      <div className="employer-profile-detail"><ShieldCheck size={15} /><div><span>PAN number</span><strong>{masked(form.director_pan)}</strong></div></div>
                      {industry && <>
                        <div className="employer-profile-detail"><FileText size={15} /><div><span>DIN</span><strong>{form.director_din || "Not set"}</strong></div></div>
                        <div className="employer-profile-detail"><FileText size={15} /><div><span>Blood group</span><strong>{form.director_blood_group || "Not set"}</strong></div></div>
                      </>}
                    </>}
                  </div>
                )}
              </section>
              {editing && (
                <div className="employer-profile-save-row">
                  <button className="employer-primary-button" type="submit" disabled={saving}>
                    {saving ? <LoaderCircle size={16} className="spin" /> : <Save size={16} />}
                    {saving ? "Saving profile..." : "Save changes"}
                  </button>
                </div>
              )}
            </form>
          </>
        ) : null}
      </main>
    </EmployerMobileShell>
  );
}
