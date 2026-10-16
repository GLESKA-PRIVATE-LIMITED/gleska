import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { AlertCircle, BriefcaseBusiness, CheckCircle2, Eye, LoaderCircle, MapPin, Plus, RefreshCw, RotateCcw, Send, Sparkles, Users, X } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { ApiError, apiDelete, apiGet, apiPost } from "../../lib/api";
import { useRefreshOnFocus } from "../../lib/useRefreshOnFocus";
import type { EmployerType } from "../../types/auth";
import { useAuth } from "../auth/AuthProvider";
import EmployerMobileShell from "./EmployerMobileShell";

declare global {
  interface Window {
    Cashfree?: (options: { mode: "sandbox" | "production" }) => {
      checkout: (options: { paymentSessionId: string; redirectTarget: "_self" }) => Promise<void> | void;
    };
  }
}

type EmployerProfile = {
  employer_type?: EmployerType | null;
  contact_person_name: string;
  trial_active: boolean;
  subscription_active: boolean;
  payment_required: boolean;
  trial_ends_at?: string | null;
  subscription_valid_until?: string | null;
  free_worker_limit: number;
  free_workers_used: number;
  free_workers_remaining: number;
  commission_required_for_next_worker: boolean;
  commission_amount: number;
};
type Job = {
  id: string;
  job_site_id: string;
  title: string;
  headcount_required: number;
  max_daily_salary?: number | string | null;
  min_experience?: number | string | null;
  work_duration_days?: number | null;
  work_timing?: string | null;
  required_skills: string[];
  status: string;
  created_at: string;
};
type JobSite = {
  id: string;
  name: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  latitude: number;
  longitude: number;
};
type JobMatchSummary = { job_id: string; current_match_count: number; accepted_count: number; matching_status: string };
type WorkerMatch = {
  worker_profile_id: string;
  name?: string | null;
  trade_id?: string | null;
  skills: string[];
  experience_years?: number | null;
  expected_daily_wage?: number | string | null;
  availability_status?: string | null;
  distance_m?: number | null;
  status: string;
};
type JobMatches = { matching_status: string; matches: WorkerMatch[]; selected_workers: WorkerMatch[]; headcount_required: number; selected_count: number; remaining_count: number };
type JobDetails = Job & { job_site: Pick<JobSite, "id" | "name" | "address" | "latitude" | "longitude"> };
type LocationResult = { address: string; city?: string | null; state?: string | null; pincode?: string | null; latitude: number; longitude: number };
type PendingCommission = { orderId: string; jobId: string; workerProfileId: string };
type HiringAgentConversation = {
  conversation_id: string;
  job_id: string | null;
  state_revision: number;
  history: { role: "user" | "assistant"; content: string }[];
  candidate_results: { candidate_ref: string; name?: string | null; trade?: string | null; skills: string[]; experience_years?: number | null; expected_daily_wage?: number | null; availability_status?: string | null; projected_distance_m?: number | null }[];
  candidate_result_status: "FOUND" | "NO_MATCHES" | "NOT_RETRIEVED" | "FAILED";
  candidate_result_note?: string | null;
  job_draft: { title?: string | null; headcount_required?: number | null; max_daily_salary?: number | null; min_experience?: number | null; work_duration_days?: number | null; work_timing?: string | null; trade_id?: string | null; required_skills: string[] };
  job_site_id?: string | null;
  job_site_name?: string | null;
  job_confirmation_token?: string | null;
  created_job_id?: string | null;
};

const PENDING_COMMISSION_KEY = "gleska_pending_commission";

function errorText(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

async function loadCashfree() {
  if (window.Cashfree) return window.Cashfree;
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://sdk.cashfree.com/js/v3/cashfree.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Unable to load secure Cashfree checkout."));
    document.head.appendChild(script);
  });
  if (!window.Cashfree) throw new Error("Cashfree checkout is unavailable.");
  return window.Cashfree;
}

function statusLabel(status: string) {
  return status.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function money(value?: number | string | null) {
  if (value == null) return "Not specified";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(value));
}

function distanceLabel(value?: number | null) {
  if (value == null) return null;
  return value < 1000 ? `${Math.round(value)} m away` : `${(value / 1000).toFixed(1)} km away`;
}

export default function EmployerDashboardScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isLoading: authLoading, nextStep } = useAuth();
  const [profile, setProfile] = useState<EmployerProfile | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [sites, setSites] = useState<JobSite[]>([]);
  const [summaries, setSummaries] = useState<Record<string, JobMatchSummary>>({});
  const [workerCount, setWorkerCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [showJobForm, setShowJobForm] = useState(() => location.hash === "#create-job");
  const [jobCreationMode, setJobCreationMode] = useState<"manual" | "assistant">("manual");
  const [showSiteForm, setShowSiteForm] = useState(false);
  const [jobTitle, setJobTitle] = useState("");
  const [headcount, setHeadcount] = useState("1");
  const [dailyWage, setDailyWage] = useState("");
  const [duration, setDuration] = useState("");
  const [experience, setExperience] = useState("0");
  const [workTiming, setWorkTiming] = useState("");
  const [siteId, setSiteId] = useState("");
  const [skills, setSkills] = useState<string[]>([]);
  const [skillInput, setSkillInput] = useState("");
  const [siteName, setSiteName] = useState("");
  const [locationQuery, setLocationQuery] = useState("");
  const [locationResults, setLocationResults] = useState<LocationResult[]>([]);
  const [chosenLocation, setChosenLocation] = useState<LocationResult | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [selectedJob, setSelectedJob] = useState<JobDetails | null>(null);
  const [jobMatches, setJobMatches] = useState<JobMatches | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [recovery, setRecovery] = useState<PendingCommission | null>(null);
  const [paymentStatus, setPaymentStatus] = useState("");
  const [assistantConversation, setAssistantConversation] = useState<HiringAgentConversation | null>(null);
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [assistantError, setAssistantError] = useState("");
  const searchTimer = useRef<number | undefined>(undefined);
  const locationSearchSequence = useRef(0);
  const submitting = useRef(false);
  const scrollToJobAfterLoad = useRef(location.hash === "#create-job");

  const refresh = useCallback(async () => {
    if (!user || user.role !== "EMPLOYER") return;
    setLoading(true);
    setLoadError("");
    const results = await Promise.allSettled([
      apiGet<EmployerProfile>("/api/v1/employers/me"),
      apiGet<Job[]>("/api/v1/jobs"),
      apiGet<JobSite[]>("/api/v1/job-sites/me"),
      apiGet<JobMatchSummary[]>("/api/v1/jobs/match-summary"),
      apiGet<{ count: number }>("/api/v1/employers/me/available-worker-count"),
    ]);
    const failures: string[] = [];
    if (results[0].status === "fulfilled") setProfile(results[0].value);
    else failures.push(`Employer profile: ${errorText(results[0].reason)}`);
    if (results[1].status === "fulfilled") setJobs(results[1].value);
    else failures.push(`Jobs: ${errorText(results[1].reason)}`);
    if (results[2].status === "fulfilled") setSites(results[2].value);
    else failures.push(`Work sites: ${errorText(results[2].reason)}`);
    if (results[3].status === "fulfilled") setSummaries(Object.fromEntries(results[3].value.map((item) => [item.job_id, item])));
    else failures.push(`Worker matches: ${errorText(results[3].reason)}`);
    if (results[4].status === "fulfilled") setWorkerCount(results[4].value.count);
    else failures.push(`Available workers: ${errorText(results[4].reason)}`);
    setLoadError(failures.join(" "));
    setLoading(false);
  }, [user]);

  useRefreshOnFocus(refresh, !authLoading && user?.role === "EMPLOYER" && nextStep === "DASHBOARD");

  useEffect(() => {
    if (authLoading) return;
    if (!user) navigate("/auth/signin?role=EMPLOYER", { replace: true });
    else if (user.role !== "EMPLOYER") navigate(user.role === "WORKER" ? "/worker/dashboard" : "/", { replace: true });
    else if (nextStep !== "DASHBOARD") navigate("/employer/onboarding", { replace: true });
    else void Promise.resolve().then(() => refresh());
  }, [authLoading, navigate, nextStep, refresh, user]);

  useEffect(() => () => window.clearTimeout(searchTimer.current), []);

  useEffect(() => {
    if (location.pathname !== "/employer/dashboard" || location.hash !== "#create-job") return;
    navigate("/employer/dashboard", { replace: true });
  }, [location.hash, location.pathname, navigate]);

  useEffect(() => {
    if (loading || !scrollToJobAfterLoad.current) return;
    scrollToJobAfterLoad.current = false;
    window.setTimeout(() => document.getElementById("create-job")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }, [loading]);

  useEffect(() => {
    if (authLoading || user?.role !== "EMPLOYER" || !user.id) return;
    const savedId = localStorage.getItem(`gleska_hiring_agent_conversation:${user.id}`);
    if (!savedId) return;
    let active = true;
    void apiGet<HiringAgentConversation>(`/api/v1/jobs/assistant/agent/${encodeURIComponent(savedId)}`)
      .then((conversation) => {
        if (active) setAssistantConversation(conversation);
      })
      .catch((loadError) => {
        if (!active) return;
        setAssistantError(`Couldn't reload the saved AI assistant conversation: ${errorText(loadError)}`);
      });
    return () => { active = false; };
  }, [authLoading, user]);

  const resetAssistantConversation = () => {
    if (assistantLoading) return;
    if (user?.id) localStorage.removeItem(`gleska_hiring_agent_conversation:${user.id}`);
    setAssistantConversation(null);
    setAssistantInput("");
    setAssistantError("");
  };

  const sendAssistantMessage = async (event: FormEvent) => {
    event.preventDefault();
    const message = assistantInput.trim();
    if (!message || assistantLoading) return;
    setAssistantLoading(true);
    setAssistantError("");
    setAssistantInput("");
    try {
      const conversation = await apiPost<HiringAgentConversation>("/api/v1/jobs/assistant/agent/message", {
        message,
        conversation_id: assistantConversation?.conversation_id,
        job_id: assistantConversation?.job_id || undefined,
        selected_job_site_id: siteId || undefined,
        state_revision: assistantConversation?.state_revision,
      });
      setAssistantConversation(conversation);
      if (user?.id) localStorage.setItem(`gleska_hiring_agent_conversation:${user.id}`, conversation.conversation_id);
    } catch (requestError) {
      setAssistantInput(message);
      setAssistantError(errorText(requestError));
    } finally {
      setAssistantLoading(false);
    }
  };

  const confirmAssistantJob = async () => {
    if (!assistantConversation?.job_confirmation_token || assistantLoading) return;
    setAssistantLoading(true);
    setAssistantError("");
    try {
      const conversation = await apiPost<HiringAgentConversation>("/api/v1/jobs/assistant/agent/create", {
        conversation_id: assistantConversation.conversation_id,
        state_revision: assistantConversation.state_revision,
        confirmation_token: assistantConversation.job_confirmation_token,
      });
      setAssistantConversation(conversation);
      setNotice("AI-assisted job created successfully.");
      await refresh();
    } catch (requestError) {
      setAssistantError(errorText(requestError));
    } finally {
      setAssistantLoading(false);
    }
  };

  const reloadSummaries = async () => {
    const [summaryList, jobList] = await Promise.all([
      apiGet<JobMatchSummary[]>("/api/v1/jobs/match-summary"),
      apiGet<Job[]>("/api/v1/jobs"),
    ]);
    setSummaries(Object.fromEntries(summaryList.map((item) => [item.job_id, item])));
    setJobs(jobList);
  };

  const submitJob = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setNotice("");
    if (submitting.current) return;
    if (!jobTitle.trim() || jobTitle.trim().length > 120 || !siteId || Number(headcount) < 1 || Number(headcount) > 1000
      || Number(dailyWage) <= 0 || Number(dailyWage) > 1000000 || Number(duration) < 1 || Number(duration) > 365
      || Number(experience) < 0 || Number(experience) > 100 || !workTiming.trim()) {
      setError("Check each required field. Title, site, workers (1–1,000), pay, duration (1–365 days), experience (0–100 years), and work timing are required.");
      return;
    }
    submitting.current = true;
    setBusy("job");
    try {
      const created = await apiPost<Job>("/api/v1/jobs", {
        job_site_id: siteId,
        title: jobTitle.trim(),
        headcount_required: Number(headcount),
        max_daily_salary: Number(dailyWage),
        work_duration_days: Number(duration),
        work_timing: workTiming.trim(),
        min_experience: Number(experience),
        required_skills: skills,
      });
      setJobs((current) => [created, ...current]);
      setJobTitle("");
      setHeadcount("1");
      setDailyWage("");
      setDuration("");
      setExperience("0");
      setWorkTiming("");
      setSkills([]);
      setSkillInput("");
      setShowJobForm(false);
      setNotice("Job posted successfully.");
      try { await reloadSummaries(); } catch (refreshError) { setError(`Job was created, but dashboard refresh failed: ${errorText(refreshError)}`); }
    } catch (requestError) {
      setError(errorText(requestError));
    } finally {
      setBusy("");
      submitting.current = false;
    }
  };

  const searchLocations = (query: string) => {
    window.clearTimeout(searchTimer.current);
    const requestSequence = ++locationSearchSequence.current;
    setLocationQuery(query);
    setChosenLocation(null);
    setLocationResults([]);
    if (query.trim().length < 2) {
      setLocationLoading(false);
      return;
    }
    searchTimer.current = window.setTimeout(async () => {
      setLocationLoading(true);
      setError("");
      try {
        const result = await apiGet<{ locations: LocationResult[] }>(`/api/v1/locations/search?q=${encodeURIComponent(query.trim())}`);
        if (requestSequence === locationSearchSequence.current) setLocationResults(result.locations);
      } catch (requestError) {
        if (requestSequence === locationSearchSequence.current) setError(errorText(requestError));
      } finally {
        if (requestSequence === locationSearchSequence.current) setLocationLoading(false);
      }
    }, 350);
  };

  const submitSite = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (submitting.current) return;
    if (!siteName.trim() || !chosenLocation) {
      setError("Enter a work-site name and select a location from the search results.");
      return;
    }
    submitting.current = true;
    setBusy("site");
    try {
      const created = await apiPost<JobSite>("/api/v1/job-sites/", {
        name: siteName.trim(),
        address: chosenLocation.address,
        city: chosenLocation.city || null,
        state: chosenLocation.state || null,
        pincode: chosenLocation.pincode || null,
        latitude: chosenLocation.latitude,
        longitude: chosenLocation.longitude,
        location_source: "SEARCH",
      });
      setSites((current) => [created, ...current]);
      setSiteId(created.id);
      setSiteName("");
      setLocationQuery("");
      setLocationResults([]);
      setChosenLocation(null);
      setShowSiteForm(false);
      setNotice("Work site added.");
    } catch (requestError) {
      setError(errorText(requestError));
    } finally {
      setBusy("");
      submitting.current = false;
    }
  };

  const deleteSite = async (id: string) => {
    if (!window.confirm("Remove this work site? Sites linked to jobs cannot be removed.")) return;
    setError("");
    setBusy(`delete-site-${id}`);
    try {
      await apiDelete<void>(`/api/v1/job-sites/${id}`);
      setSites((current) => current.filter((site) => site.id !== id));
      if (siteId === id) setSiteId("");
      setNotice("Work site removed.");
    } catch (requestError) {
      setError(errorText(requestError));
    } finally {
      setBusy("");
    }
  };

  const openJob = async (job: Job, mode: "details" | "matches") => {
    setSelectedJob(null);
    setJobMatches(null);
    setError("");
    setModalLoading(true);
    try {
      const details = await apiGet<JobDetails>(`/api/v1/jobs/${job.id}`);
      setSelectedJob(details);
      if (mode === "matches") setJobMatches(await apiGet<JobMatches>(`/api/v1/jobs/${job.id}/matches`));
    } catch (requestError) {
      setError(errorText(requestError));
      setSelectedJob(job as JobDetails);
    } finally {
      setModalLoading(false);
    }
  };

  const closeJob = () => {
    setSelectedJob(null);
    setJobMatches(null);
    setPaymentStatus("");
  };

  const acceptWorker = async (jobId: string, workerProfileId: string) => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(`accept-${workerProfileId}`);
    setError("");
    try {
      await apiPost(`/api/v1/jobs/${jobId}/matches/accept`, { worker_profile_id: workerProfileId });
      setNotice("Worker selected successfully.");
      await refresh();
      const job = jobs.find(({ id }) => id === jobId);
      if (job) await openJob(job, "matches");
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.status === 402
        && typeof requestError.detail === "object" && requestError.detail !== null
        && "code" in requestError.detail && requestError.detail.code === "COMMISSION_REQUIRED") {
        await startCommissionPayment(jobId, workerProfileId);
      } else if (requestError instanceof ApiError && requestError.status === 402 && requestError.message.includes("SUBSCRIPTION_REQUIRED")) {
        setError("An active business subscription is required to select this worker.");
      } else {
        setError(errorText(requestError));
      }
    } finally {
      setBusy("");
      submitting.current = false;
    }
  };

  const startCommissionPayment = async (jobId: string, workerProfileId: string) => {
    try {
      setPaymentStatus("Creating secure commission payment...");
      const order = await apiPost<{ order_id: string; payment_session_id: string }>("/api/v1/payments/employer/create-commission-order", {
        job_id: jobId,
        worker_profile_id: workerProfileId,
      });
      const pending = { orderId: order.order_id, jobId, workerProfileId };
      localStorage.setItem(PENDING_COMMISSION_KEY, JSON.stringify(pending));
      setRecovery(pending);
      const cashfree = await loadCashfree();
      const mode = import.meta.env.VITE_CASHFREE_ENV === "production" ? "production" : "sandbox";
      await cashfree({ mode }).checkout({ paymentSessionId: order.payment_session_id, redirectTarget: "_self" });
      setRecovery(pending);
      setPaymentStatus("Payment is processing. Use Verify payment below when checkout returns.");
    } catch (paymentError) {
      setError(errorText(paymentError));
      setPaymentStatus("");
    }
  };

  const verifyCommission = useCallback(async (pending: PendingCommission) => {
    setBusy("payment");
    setError("");
    setPaymentStatus("Verifying commission payment...");
    try {
      const verification = await apiPost<{ status: string }>(`/api/v1/payments/verify/${encodeURIComponent(pending.orderId)}`, {});
      if (verification.status !== "SUCCESS") {
        setPaymentStatus(`Payment status: ${statusLabel(verification.status)}. Verify again when payment completes.`);
        return;
      }
      await apiPost(`/api/v1/jobs/${pending.jobId}/matches/accept`, { worker_profile_id: pending.workerProfileId });
      localStorage.removeItem(PENDING_COMMISSION_KEY);
      setRecovery(null);
      setPaymentStatus("Payment verified and worker selected.");
      setNotice("Payment verified and worker selected.");
      await refresh();
    } catch (verificationError) {
      setError(errorText(verificationError));
      setPaymentStatus("Payment or dispatch needs attention. Retry verification; do not pay again until the order status is checked.");
    } finally {
      setBusy("");
    }
  }, [refresh]);

  useEffect(() => {
    if (authLoading || user?.role !== "EMPLOYER") return;
    const stored = localStorage.getItem(PENDING_COMMISSION_KEY);
    if (!stored) return;
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      let pending: PendingCommission;
      try {
        pending = JSON.parse(stored) as PendingCommission;
        if (!pending.orderId || !pending.jobId || !pending.workerProfileId) throw new Error("Invalid pending payment record.");
      } catch (parseError) {
        setError(errorText(parseError));
        return;
      }
      setRecovery(pending);
      const returnedOrderId = new URLSearchParams(window.location.search).get("order_id");
      if (returnedOrderId && returnedOrderId === pending.orderId) {
        window.history.replaceState({}, document.title, window.location.pathname);
        void verifyCommission(pending);
      }
    });
    return () => { active = false; };
  }, [authLoading, user, verifyCommission]);

  const cancelJob = async (job: Job) => {
    if (job.status !== "SEARCHING" || !window.confirm("Stop searching for workers and cancel this job?")) return;
    setBusy(`cancel-${job.id}`);
    setError("");
    try {
      await apiPost(`/api/v1/jobs/${job.id}/cancel`, {});
      setNotice("Job search cancelled.");
      await refresh();
    } catch (requestError) {
      setError(errorText(requestError));
    } finally {
      setBusy("");
    }
  };

  if (authLoading || loading) return <EmployerMobileShell><main className="employer-dashboard"><div className="employer-dashboard-state"><LoaderCircle className="spin" size={24} /><span>Loading employer dashboard…</span></div></main></EmployerMobileShell>;
  if (!user || user.role !== "EMPLOYER" || nextStep !== "DASHBOARD") return null;

  const activeJobCount = jobs.filter((job) => !["CANCELLED", "COMPLETED"].includes(job.status)).length;
  const employerName = profile?.contact_person_name || user.name || "Employer";
  const scrollToCreateJob = () => {
    setShowJobForm(true);
    setJobCreationMode("manual");
    window.setTimeout(() => document.getElementById("create-job")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  };

  return <EmployerMobileShell name={employerName} employerType={profile?.employer_type} profilePhotoUrl={user.profile_photo_url} onPostJob={scrollToCreateJob}>
    <main className="employer-dashboard">
      <header className="employer-dashboard-heading">
        <div><p className="employer-eyebrow">Employer workspace</p><h1>Welcome back, {employerName}</h1><p>{statusLabel(profile?.employer_type || "employer")} account</p></div>
        <button className="employer-refresh-button" type="button" onClick={() => void refresh()} disabled={loading}><RefreshCw size={17} className={loading ? "spin" : ""} /><span>Refresh</span></button>
      </header>

      {loadError && <div className="employer-alert is-error" role="alert"><AlertCircle size={18} /><span>{loadError}</span><button type="button" onClick={() => void refresh()}>Retry</button></div>}
      {error && <div className="employer-alert is-error" role="alert"><AlertCircle size={18} /><span>{error}</span><button type="button" onClick={() => setError("")} aria-label="Dismiss error"><X size={18} /></button></div>}
      {notice && <div className="employer-alert is-success" role="status"><CheckCircle2 size={18} /><span>{notice}</span><button type="button" onClick={() => setNotice("")} aria-label="Dismiss message"><X size={18} /></button></div>}

      {recovery && <section className="employer-payment-recovery">
        <div><strong>Commission payment needs verification</strong><p>Worker selection is not confirmed until payment is verified and the backend accepts the dispatch.</p>{paymentStatus && <small>{paymentStatus}</small>}</div>
        <button type="button" disabled={busy === "payment"} onClick={() => void verifyCommission(recovery)}>{busy === "payment" ? "Checking…" : "Verify payment"}</button>
      </section>}

      <section className="employer-summary-grid" aria-label="Employer summary">
        <article className="employer-summary-card"><span className="employer-summary-icon"><CheckCircle2 size={20} /></span><h2>{profile?.employer_type === "INDIVIDUAL" ? "Worker entitlement" : "Subscription"}</h2>
          {profile?.employer_type === "INDIVIDUAL" ? <><strong>{profile.commission_required_for_next_worker ? "Commission due for next worker" : "Free-worker entitlement available"}</strong><p>{profile.free_workers_used} of {profile.free_worker_limit} free workers used · {profile.free_workers_remaining} remaining</p>{profile.commission_required_for_next_worker && <small>₹{profile.commission_amount} per additional unique worker</small>}</>
            : <><strong>{profile?.trial_active ? "Free trial active" : profile?.subscription_active ? "Active" : profile?.payment_required ? "Payment required" : "Not active"}</strong><p>Business subscription status from your employer profile.</p></>}</article>
        <article className="employer-summary-card"><span className="employer-summary-icon"><BriefcaseBusiness size={20} /></span><h2>Active jobs</h2><strong>{activeJobCount}</strong><p>{jobs.length === 0 ? "Post a job to get started." : "Current jobs not cancelled or completed."}</p></article>
        <article className="employer-summary-card"><span className="employer-summary-icon"><Users size={20} /></span><h2>Available matches</h2><strong>{workerCount ?? "—"}</strong><p>Eligible workers across your current jobs.</p></article>
      </section>

      <section className="employer-section-card" id="create-job">
        <div className="employer-section-heading"><div><p className="employer-eyebrow">Hiring</p><h2>Create a job</h2></div><button className="employer-primary-button" type="button" onClick={() => { setShowJobForm((value) => !value); setShowSiteForm(false); }}><Plus size={17} />{showJobForm ? "Close form" : "New job"}</button></div>
        {showJobForm && <>
          <div className="employer-mode-tabs" role="tablist" aria-label="Job creation method">
            <button type="button" role="tab" aria-selected={jobCreationMode === "manual"} className={jobCreationMode === "manual" ? "is-active" : ""} onClick={() => setJobCreationMode("manual")}>Manual form</button>
            <button type="button" role="tab" aria-selected={jobCreationMode === "assistant"} className={jobCreationMode === "assistant" ? "is-active" : ""} onClick={() => setJobCreationMode("assistant")}><Sparkles size={15} />AI assistant</button>
          </div>
          {jobCreationMode === "assistant" ? <div className="employer-assistant">
            <div className="employer-assistant-heading"><div><Sparkles size={18} /><strong>AI hiring assistant</strong></div><button className="employer-subtle-button" type="button" disabled={assistantLoading} onClick={resetAssistantConversation}><RotateCcw size={15} />New chat</button></div>
            <label className="employer-field">Work site for the draft<select value={siteId} onChange={(event) => setSiteId(event.target.value)}><option value="">Select a work site</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
            {!sites.length && <p className="employer-inline-note">Add a work site before confirming a job.</p>}
            {assistantError && <div className="employer-alert is-error" role="alert"><AlertCircle size={17} /><span>{assistantError}</span><button type="button" onClick={() => setAssistantError("")} aria-label="Dismiss assistant error"><X size={17} /></button></div>}
            <div className="employer-assistant-messages" aria-live="polite">
              {(assistantConversation?.history?.length ? assistantConversation.history : [{ role: "assistant" as const, content: "Tell me what kind of job you need. I can help shape a job draft and discuss current candidates." }]).map((message, index) =>
                <div key={`${index}-${message.role}`} className={`employer-chat-message ${message.role}`}><span>{message.content}</span></div>)}
              {assistantLoading && <p className="employer-inline-note"><LoaderCircle size={15} className="spin" />Assistant is working…</p>}
            </div>
            <form className="employer-assistant-compose" onSubmit={(event) => void sendAssistantMessage(event)}>
              <input maxLength={4000} value={assistantInput} onChange={(event) => setAssistantInput(event.target.value)} placeholder="Describe the job, wage, workers, or timing…" disabled={assistantLoading} />
              <button className="employer-primary-button" type="submit" disabled={assistantLoading || !assistantInput.trim()} aria-label="Send message"><Send size={17} /></button>
            </form>
            {assistantConversation && <div className="employer-assistant-draft">
              <div><p className="employer-eyebrow">Draft preview</p><h3>{assistantConversation.job_draft.title || "Job details are being gathered"}</h3></div>
              <dl>
                <div><dt>Workers</dt><dd>{assistantConversation.job_draft.headcount_required ?? "Not specified"}</dd></div>
                <div><dt>Daily wage</dt><dd>{assistantConversation.job_draft.max_daily_salary == null ? "Not specified" : money(assistantConversation.job_draft.max_daily_salary)}</dd></div>
                <div><dt>Duration</dt><dd>{assistantConversation.job_draft.work_duration_days == null ? "Not specified" : `${assistantConversation.job_draft.work_duration_days} days`}</dd></div>
                <div><dt>Experience</dt><dd>{assistantConversation.job_draft.min_experience == null ? "Not specified" : `${assistantConversation.job_draft.min_experience} years`}</dd></div>
                <div><dt>Work timing</dt><dd>{assistantConversation.job_draft.work_timing || "Not specified"}</dd></div>
                <div><dt>Work site</dt><dd>{sites.find((site) => site.id === (assistantConversation.job_site_id || siteId))?.name || assistantConversation.job_site_name || "Select a work site"}</dd></div>
              </dl>
              {!!assistantConversation.job_draft.required_skills.length && <p><strong>Skills:</strong> {assistantConversation.job_draft.required_skills.join(", ")}</p>}
              {assistantConversation.created_job_id ? <p className="employer-inline-note"><CheckCircle2 size={16} />Job created.</p>
                : assistantConversation.job_confirmation_token && <button className="employer-primary-button" type="button" disabled={assistantLoading || !siteId} onClick={() => void confirmAssistantJob()}>{assistantLoading ? "Creating…" : <><CheckCircle2 size={17} />Confirm &amp; create job</>}</button>}
            </div>}
            {assistantConversation?.candidate_result_status === "NO_MATCHES" && <p className="employer-inline-note">{assistantConversation.candidate_result_note || "No matching workers were found yet."}</p>}
            {assistantConversation?.candidate_result_status === "FOUND" && <div className="employer-assistant-candidates"><h3>Candidate matches</h3>{assistantConversation.candidate_results.map((candidate) => <article key={candidate.candidate_ref}><strong>{candidate.name || "Worker"}</strong><p>{[candidate.trade, candidate.experience_years != null ? `${candidate.experience_years} years` : null].filter(Boolean).join(" · ")}</p><p>{candidate.skills.join(", ") || "No skills listed"} · {money(candidate.expected_daily_wage)} / day</p></article>)}</div>}
          </div> : <form className="employer-form-grid" onSubmit={(event) => void submitJob(event)}>
          <label className="employer-field employer-field-wide">Job title<input required maxLength={120} value={jobTitle} onChange={(event) => setJobTitle(event.target.value)} placeholder="e.g. Construction worker" /></label>
          <label className="employer-field">Work site<select required value={siteId} onChange={(event) => setSiteId(event.target.value)}><option value="">Select a work site</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
          <button className="employer-subtle-button" type="button" onClick={() => { setShowSiteForm(true); document.getElementById("employer-sites")?.scrollIntoView({ behavior: "smooth" }); }}>Add work site</button>
          <label className="employer-field">Workers needed<input required type="number" min="1" max="1000" value={headcount} onChange={(event) => setHeadcount(event.target.value)} /></label>
          <label className="employer-field">Daily wage (₹)<input required type="number" min="1" max="1000000" value={dailyWage} onChange={(event) => setDailyWage(event.target.value)} /></label>
          <label className="employer-field">Duration (days)<input required type="number" min="1" max="365" value={duration} onChange={(event) => setDuration(event.target.value)} /></label>
          <label className="employer-field">Minimum experience (years)<input required type="number" min="0" max="100" step="0.1" value={experience} onChange={(event) => setExperience(event.target.value)} /></label>
          <label className="employer-field employer-field-wide">Work timing<input required maxLength={120} value={workTiming} onChange={(event) => setWorkTiming(event.target.value)} placeholder="e.g. 9 AM to 6 PM" /></label>
          <div className="employer-field employer-field-wide"><label htmlFor="employer-skills">Required skills (optional)</label><div className="employer-skill-input"><input id="employer-skills" value={skillInput} onChange={(event) => setSkillInput(event.target.value)} placeholder="Add a skill" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); const value = skillInput.trim(); if (value && !skills.includes(value)) setSkills((current) => [...current, value]); setSkillInput(""); } }} /><button type="button" onClick={() => { const value = skillInput.trim(); if (value && !skills.includes(value)) setSkills((current) => [...current, value]); setSkillInput(""); }}>Add</button></div><div className="employer-skill-list">{skills.map((skill) => <button key={skill} type="button" onClick={() => setSkills((current) => current.filter((value) => value !== skill))}>{skill} ×</button>)}</div></div>
          <button className="employer-primary-button employer-field-wide" type="submit" disabled={busy === "job"}>{busy === "job" ? <><LoaderCircle className="spin" size={17} />Posting…</> : <><Plus size={17} />Post job</>}</button>
          </form>}
        </>}
      </section>

      <section className="employer-section-card" id="employer-jobs">
        <div className="employer-section-heading"><div><p className="employer-eyebrow">Your hiring activity</p><h2>Created jobs <span className="employer-count">{jobs.length}</span></h2></div></div>
        {jobs.length === 0 ? <div className="employer-empty-state"><BriefcaseBusiness size={25} /><strong>No jobs yet</strong><p>Create a job to find eligible workers.</p><button className="employer-primary-button" type="button" onClick={() => setShowJobForm(true)}><Plus size={17} />Create your first job</button></div>
          : <div className="employer-job-list">{jobs.map((job) => {
            const summary = summaries[job.id];
            return <article className="employer-job-item" key={job.id}>
              <div className="employer-job-copy"><div className="employer-job-title-row"><h3>{job.title}</h3><span className={`employer-status-badge status-${job.status.toLowerCase()}`}>{statusLabel(job.status)}</span></div>
                <p>{job.headcount_required} worker{job.headcount_required === 1 ? "" : "s"} needed · {money(job.max_daily_salary)} / day</p>
                <p>{summary ? `${summary.accepted_count} selected · ${summary.current_match_count} suitable matches` : "Match count unavailable"}</p>
              </div>
              <div className="employer-job-actions">
                {job.status !== "CANCELLED" && job.status !== "COMPLETED" && <button className="employer-secondary-button" type="button" onClick={() => void openJob(job, "matches")}><Users size={16} />Workers</button>}
                <button className="employer-secondary-button" type="button" onClick={() => void openJob(job, "details")}><Eye size={16} />Details</button>
                {job.status === "SEARCHING" && <button className="employer-danger-button" type="button" disabled={busy === `cancel-${job.id}`} onClick={() => void cancelJob(job)}><X size={16} />Stop search</button>}
              </div>
            </article>;
          })}</div>}
      </section>

      <section className="employer-section-card" id="employer-sites">
        <div className="employer-section-heading"><div><p className="employer-eyebrow">Locations</p><h2>Work sites <span className="employer-count">{sites.length}</span></h2></div><button className="employer-primary-button" type="button" onClick={() => setShowSiteForm((value) => !value)}><Plus size={17} />{showSiteForm ? "Close" : "Add site"}</button></div>
        {showSiteForm && <form className="employer-form-grid" onSubmit={(event) => void submitSite(event)}>
          <label className="employer-field employer-field-wide">Site name<input required maxLength={160} value={siteName} onChange={(event) => setSiteName(event.target.value)} placeholder="Enter work site name" /></label>
          <label className="employer-field employer-field-wide">Search location<input value={locationQuery} onChange={(event) => searchLocations(event.target.value)} placeholder="Search an address (at least 3 characters)" /></label>
          {locationLoading && <p className="employer-inline-note employer-field-wide">Searching locations…</p>}
          {locationResults.length > 0 && <div className="employer-location-results employer-field-wide" role="listbox" aria-label="Location results">{locationResults.map((location) => <button key={`${location.latitude}-${location.longitude}`} type="button" onClick={() => { setChosenLocation(location); setLocationQuery(location.address); setLocationResults([]); }}><MapPin size={16} /><span>{location.address}{location.city ? `, ${location.city}` : ""}{location.state ? `, ${location.state}` : ""}</span></button>)}</div>}
          {chosenLocation && <p className="employer-location-selected employer-field-wide"><CheckCircle2 size={16} />Selected: {chosenLocation.address}</p>}
          <button className="employer-primary-button employer-field-wide" type="submit" disabled={busy === "site"}>{busy === "site" ? <><LoaderCircle className="spin" size={17} />Saving…</> : "Save work site"}</button>
        </form>}
        {sites.length === 0 ? <div className="employer-empty-state"><MapPin size={25} /><strong>No work sites yet</strong><p>Add a verified location before creating a job.</p></div>
          : <div className="employer-site-list">{sites.map((site) => <article key={site.id} className="employer-site-item"><MapPin size={19} /><div><strong>{site.name}</strong><p>{[site.address, site.city, site.state].filter(Boolean).join(", ")}</p></div><button className="employer-danger-button" type="button" disabled={busy === `delete-site-${site.id}`} onClick={() => void deleteSite(site.id)} aria-label={`Remove ${site.name}`}><X size={16} />Remove</button></article>)}</div>}
      </section>

      {selectedJob && <div className="employer-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeJob(); }}>
        <section className="employer-job-modal" role="dialog" aria-modal="true" aria-labelledby="employer-modal-title">
          <header><div><p className="employer-eyebrow">{jobMatches ? "Suitable workers" : "Job details"}</p><h2 id="employer-modal-title">{selectedJob.title}</h2></div><button type="button" onClick={closeJob} aria-label="Close job details"><X size={22} /></button></header>
          {modalLoading ? <div className="employer-dashboard-state"><LoaderCircle className="spin" size={22} />Loading job details…</div> : <>
            {!jobMatches ? <div className="employer-detail-grid"><p><strong>Status</strong>{statusLabel(selectedJob.status)}</p><p><strong>Work site</strong>{selectedJob.job_site?.name || "Unknown"}</p><p><strong>Address</strong>{selectedJob.job_site?.address || "Not provided"}</p><p><strong>Workers</strong>{selectedJob.headcount_required}</p><p><strong>Daily wage</strong>{money(selectedJob.max_daily_salary)}</p><p><strong>Duration</strong>{selectedJob.work_duration_days ?? "Not specified"} days</p><p><strong>Experience</strong>{selectedJob.min_experience ?? "Not specified"} years</p><p><strong>Work timing</strong>{selectedJob.work_timing || "Not specified"}</p></div>
              : <><div className="employer-match-summary"><strong>{jobMatches.matching_status.replaceAll("_", " ")}</strong><span>{jobMatches.selected_count} selected · {jobMatches.remaining_count} slots remaining</span></div>
                {jobMatches.matches.length === 0 ? <div className="employer-empty-state"><Users size={24} /><strong>No suitable workers right now</strong><p>Check back later for refreshed matches.</p></div> : <div className="employer-worker-list">{jobMatches.matches.map((worker) => <article key={worker.worker_profile_id} className="employer-worker-item"><div className="employer-worker-avatar">{worker.name?.charAt(0).toUpperCase() || "W"}</div><div className="employer-worker-copy"><strong>{worker.name || "Worker"}</strong><p>{[worker.trade_id, worker.experience_years != null ? `${worker.experience_years} years experience` : null, distanceLabel(worker.distance_m)].filter(Boolean).join(" · ")}</p><p>{worker.skills.join(", ") || "No skills listed"} · {money(worker.expected_daily_wage)} / day</p><small>{statusLabel(worker.status)}{worker.availability_status ? ` · ${statusLabel(worker.availability_status)}` : ""}</small></div>{worker.status === "PENDING" && <button type="button" className="employer-primary-button" disabled={busy === `accept-${worker.worker_profile_id}`} onClick={() => void acceptWorker(selectedJob.id, worker.worker_profile_id)}>{busy === `accept-${worker.worker_profile_id}` ? "Selecting…" : "Select worker"}</button>}</article>)}</div>}
                {jobMatches.selected_workers.length > 0 && <section className="employer-selected-workers"><h3>Selected workers</h3>{jobMatches.selected_workers.map((worker) => <p key={worker.worker_profile_id}><CheckCircle2 size={16} />{worker.name || "Worker"} · {statusLabel(worker.status)}</p>)}</section>}
              </>}
          </>}
        </section>
      </div>}
    </main>
  </EmployerMobileShell>;
}
