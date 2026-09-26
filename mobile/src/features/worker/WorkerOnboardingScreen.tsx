import { useEffect, useState, type FormEvent } from "react";
import { LoaderCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { AuthLayout } from "../auth/AuthScreens";
import { useAuth, errorMessage } from "../auth/AuthProvider";
import { useLanguage } from "../auth/LanguageContext";
import { apiGet, apiPut } from "../../lib/api";

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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

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
    if (profile.experience_years === null || profile.experience_years === undefined || profile.experience_years < 0) {
      setError("Enter your years of experience.");
      return;
    }
    if (profile.expected_daily_wage === null || profile.expected_daily_wage === undefined || profile.expected_daily_wage < 0) {
      setError("Enter your expected daily wage.");
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
        {error && <p className="auth-error" role="alert">{error}</p>}
        <form className="onboarding-form" onSubmit={(event) => void save(event)}>
          <div className="onboarding-grid">
            <label className="auth-field"><span>Full name *</span><input className="auth-input" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required /></label>
            <label className="auth-field"><span>Mobile number *</span><input className="auth-input" autoComplete="tel" value={mobile} onChange={(event) => setMobile(event.target.value)} maxLength={32} required /></label>
            <label className="auth-field"><span>Email *</span><input className="auth-input" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
            <label className="auth-field"><span>Trade or profession *</span><input className="auth-input" value={profile.trade_id || ""} onChange={(event) => change("trade_id", event.target.value)} maxLength={120} required /></label>
            <label className="auth-field"><span>Experience (years) *</span><input className="auth-input" type="number" min={0} step={1} value={profile.experience_years ?? ""} onChange={(event) => change("experience_years", event.target.value === "" ? null : Number(event.target.value))} required /></label>
            <label className="auth-field"><span>Expected daily wage (₹) *</span><input className="auth-input" type="number" min={0} max={1000000} step="any" value={profile.expected_daily_wage ?? ""} onChange={(event) => change("expected_daily_wage", event.target.value === "" ? null : Number(event.target.value))} required /></label>
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
