"use client";

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import {
  LogOut,
  Zap,
  Building2,
  Users,
  Briefcase,
  Clock,
  Loader2,
  MapPin,
  Plus,
  Sparkles,
  Trash2,
  CreditCard,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import apiClient from "@/lib/api";
import LocationPicker, { LocationSelection } from "@/components/LocationPicker";

/**
 * Supported languages for job description input.
 * Mapped to browser Web Speech Recognition language codes.
 */
const SUPPORTED_LANGUAGES = {
  MARATHI: { label: "Marathi", code: "mr-IN" as const },
  HINDI: { label: "Hindi", code: "hi-IN" as const },
  TAMIL: { label: "Tamil", code: "ta-IN" as const },
  ENGLISH: { label: "English", code: "en-IN" as const },
  HINGLISH: { label: "Hinglish", code: "en-IN" as const },
};

const LANGUAGE_OPTIONS = Object.values(SUPPORTED_LANGUAGES);
const DEFAULT_LANGUAGE: string = "en-IN";

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

declare global {
  interface Window {
    Cashfree?: (options: { mode: "sandbox" | "production" }) => {
      checkout: (options: { paymentSessionId: string; redirectTarget: "_self" }) => Promise<void> | void;
    };
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  }
}

interface EmployerProfile {
  employer_type?: string | null;
  onboarding_status?: string;
  verification_status?: string;
  contact_person_name?: string;
  created_at?: string;
  subscription_valid_until?: string | null;
  has_availed_free_dispatch?: boolean;
}

interface JobSite {
  id: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
}

interface Job {
  id: string;
  job_site_id: string;
  title: string;
  headcount_required: number;
  max_daily_salary?: number | string | null;
  min_experience?: number | null;
  status: string;
}

interface JobExtractionResponse {
  parsed_data: {
    title: string;
    headcount_required: number;
    max_daily_salary: number | null;
    min_experience: number;
  };
}

function isActiveSubscription(subscriptionValidUntil?: string | null) {
  return Boolean(subscriptionValidUntil && new Date(subscriptionValidUntil).getTime() > Date.now());
}

function formatSubscriptionDate(subscriptionValidUntil: string) {
  const date = new Date(subscriptionValidUntil);
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${date.getUTCFullYear()}`;
}

export default function EmployerDashboard() {
  const router = useRouter();
  const { user, isLoading, nextStep, logout } = useAuth();
  const [employerProfile, setEmployerProfile] = React.useState<EmployerProfile | null>(null);
  const [profileError, setProfileError] = React.useState("");
  const [jobSites, setJobSites] = React.useState<JobSite[]>([]);
  const [siteForm, setSiteForm] = React.useState({ name: "", address: "", latitude: "", longitude: "" });
  const [siteError, setSiteError] = React.useState("");
  const [isSiteLoading, setIsSiteLoading] = React.useState(false);
  const [isSiteSaving, setIsSiteSaving] = React.useState(false);
  const [jobs, setJobs] = React.useState<Job[]>([]);
  const [jobForm, setJobForm] = React.useState({ job_site_id: "", title: "", headcount_required: "1", max_daily_salary: "", min_experience: "" });
  const [jobError, setJobError] = React.useState("");
  const [isJobSaving, setIsJobSaving] = React.useState(false);
  const [aiPrompt, setAiPrompt] = React.useState("");
  const [aiError, setAiError] = React.useState("");
  const [isExtracting, setIsExtracting] = React.useState(false);
  const [selectedLanguageCode, setSelectedLanguageCode] = React.useState(DEFAULT_LANGUAGE);
  const [isListening, setIsListening] = React.useState(false);
  const [voiceError, setVoiceError] = React.useState("");
  const speechRecognitionRef = React.useRef<SpeechRecognitionLike | null>(null);
  const [isPaymentLoading, setIsPaymentLoading] = React.useState(false);
  const [paymentMessage, setPaymentMessage] = React.useState("");

  const scrollToJobForm = () => {
    document.getElementById("create-job")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/employer/auth");
    }

    if (!isLoading && user && user.role !== "EMPLOYER") {
      router.push("/");
    }

    // If onboarding is not complete, redirect to onboarding
    if (!isLoading && nextStep !== "DASHBOARD") {
      router.push("/employer/onboarding");
    }
  }, [user, isLoading, nextStep, router]);

  useEffect(() => {
    if (isLoading || !user || user.role !== "EMPLOYER") return;

    const loadEmployerProfile = async () => {
      try {
        const response = await apiClient.get("/api/v1/employers/me", {
          withCredentials: true,
        });
        setEmployerProfile(response.data);
      } catch (err: any) {
        setProfileError(err.response?.data?.detail || "Unable to load employer profile");
      }
    };

    loadEmployerProfile();

    const loadJobSites = async () => {
      setIsSiteLoading(true);
      try {
        const response = await apiClient.get<JobSite[]>("/api/v1/job-sites/me", {
          withCredentials: true,
        });
        setJobSites(response.data);
        setSiteError("");
      } catch (err: any) {
        setSiteError(err.response?.data?.detail || "Unable to load work sites");
      } finally {
        setIsSiteLoading(false);
      }
    };

    loadJobSites();

    const loadJobs = async () => {
      try {
        const response = await apiClient.get<Job[]>("/api/v1/jobs", {
          withCredentials: true,
        });
        setJobs(response.data);
        setJobError("");
      } catch (err: any) {
        setJobError(err.response?.data?.detail || "Unable to load jobs");
      }
    };

    loadJobs();
  }, [isLoading, user]);

  useEffect(() => {
    if (isLoading || !user || user.role !== "EMPLOYER") return;
    const orderId = new URLSearchParams(window.location.search).get("order_id");
    if (!orderId) return;
    setPaymentMessage("Confirming payment with Cashfree...");
    apiClient.post(`/api/v1/payments/verify/${encodeURIComponent(orderId)}`)
      .then(async (response) => {
        const profileResponse = await apiClient.get("/api/v1/employers/me", { withCredentials: true });
        setEmployerProfile(profileResponse.data);
        setPaymentMessage(response.data.status === "SUCCESS" ? "Subscription active for 30 days." : `Payment status: ${response.data.status}`);
        if (response.data.status === "SUCCESS") {
          router.replace(window.location.pathname, { scroll: false });
        }
      })
      .catch((error: any) => {
        setPaymentMessage(error.response?.data?.detail || "Unable to confirm payment. Please try again.");
      });
  }, [isLoading, user]);

  const handleVoiceInput = React.useCallback(() => {
    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      setVoiceError("Speech recognition is not supported in this browser. Please type your description instead.");
      return;
    }

    if (speechRecognitionRef.current) {
      speechRecognitionRef.current.stop();
      speechRecognitionRef.current = null;
      setIsListening(false);
      return;
    }

    const recognition = new SpeechRecognitionCtor() as SpeechRecognitionLike;
    recognition.lang = selectedLanguageCode;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setVoiceError("");
      setIsListening(true);
    };

    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results)
        .map((result: any) => result[0]?.transcript ?? "")
        .join(" ")
        .trim();

      if (!transcript) {
        setVoiceError("No speech was captured. Please try again.");
        setIsListening(false);
        return;
      }

      setAiPrompt((current) => (current ? `${current} ${transcript}` : transcript));
      setVoiceError("");
      setIsListening(false);
    };

    recognition.onerror = (event: any) => {
      const code = event?.error ?? "unknown";
      const friendlyMessage =
        code === "not-allowed"
          ? "Microphone permission was denied. Please allow microphone access and try again."
          : code === "no-speech"
            ? "No speech was detected. Please try again."
            : code === "not-supported"
              ? "Speech recognition is not supported in this browser. Please type your description instead."
              : "Could not capture voice input. Please try again.";
      setVoiceError(friendlyMessage);
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
      speechRecognitionRef.current = null;
    };

    speechRecognitionRef.current = recognition;
    recognition.start();
  }, [selectedLanguageCode]);

  React.useEffect(() => {
    return () => {
      if (speechRecognitionRef.current) {
        speechRecognitionRef.current.stop();
        speechRecognitionRef.current = null;
      }
    };
  }, []);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#eef1fb] dark:bg-slate-950">
        <div className="flex flex-col items-center gap-4">
          <Loader2 size={40} className="animate-spin text-blue-600" />
          <p className="text-slate-600 dark:text-slate-400">Loading your dashboard...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const handleLogout = async () => {
    try {
      await logout();
      router.push("/");
      toast.success("Logged out successfully");
    } catch (err) {
      toast.error("Logout failed");
    }
  };

  const loadCashfree = async () => {
    if (window.Cashfree) return window.Cashfree;
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://sdk.cashfree.com/js/v3/cashfree.js";
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Unable to load Cashfree checkout"));
      document.head.appendChild(script);
    });
    if (!window.Cashfree) throw new Error("Cashfree checkout is unavailable");
    return window.Cashfree;
  };

  const handleSubscribe = async () => {
    if (isPaymentLoading) return;
    setIsPaymentLoading(true);
    setPaymentMessage("");
    try {
      const response = await apiClient.post("/api/v1/payments/create-subscription-order");
      const cashfree = await loadCashfree();
      const mode = process.env.NEXT_PUBLIC_CASHFREE_ENV === "production" ? "production" : "sandbox";
      await cashfree({ mode }).checkout({
        paymentSessionId: response.data.payment_session_id,
        redirectTarget: "_self",
      });
    } catch (error: any) {
      setPaymentMessage(error.response?.data?.detail || error.message || "Unable to start payment");
    } finally {
      setIsPaymentLoading(false);
    }
  };

  const handleSiteSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSiteSaving(true);
    setSiteError("");
    try {
      const response = await apiClient.post<JobSite>("/api/v1/job-sites/", {
        name: siteForm.name,
        address: siteForm.address,
        latitude: Number(siteForm.latitude),
        longitude: Number(siteForm.longitude),
      }, { withCredentials: true });
      setJobSites((current) => [response.data, ...current]);
      setSiteForm({ name: "", address: "", latitude: "", longitude: "" });
      toast.success("Work site added");
    } catch (err: any) {
      const message = err.response?.data?.detail || "Unable to add work site";
      setSiteError(message);
      toast.error(message);
    } finally {
      setIsSiteSaving(false);
    }
  };

  const selectSiteLocation = (location: LocationSelection) => {
    setSiteForm((current) => ({ ...current, address: location.address, latitude: String(location.latitude), longitude: String(location.longitude) }));
  };

  const handleSiteDelete = async (siteId: string) => {
    try {
      await apiClient.delete(`/api/v1/job-sites/${siteId}`, { withCredentials: true });
      setJobSites((current) => current.filter((site) => site.id !== siteId));
      toast.success("Work site removed");
    } catch (err: any) {
      const message = err.response?.data?.detail || "Unable to remove work site";
      setSiteError(message);
      toast.error(message);
    }
  };

  const handleJobSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsJobSaving(true);
    setJobError("");
    try {
      const response = await apiClient.post<Job>("/api/v1/jobs", {
        job_site_id: jobForm.job_site_id,
        title: jobForm.title,
        headcount_required: Number(jobForm.headcount_required),
        max_daily_salary: jobForm.max_daily_salary ? Number(jobForm.max_daily_salary) : null,
        min_experience: jobForm.min_experience ? Number(jobForm.min_experience) : null,
      }, { withCredentials: true });
      setJobs((current) => [response.data, ...current]);
      setJobForm({ job_site_id: jobForm.job_site_id, title: "", headcount_required: "1", max_daily_salary: "", min_experience: "" });
      toast.success("Job created");
    } catch (err: any) {
      const message = err.response?.data?.detail || "Unable to create job";
      setJobError(message);
      toast.error(message);
    } finally {
      setIsJobSaving(false);
    }
  };

  const handleExtractWithAI = async () => {
    if (!aiPrompt.trim()) {
      setAiError("Enter a natural-language job requirement first.");
      return;
    }

    setIsExtracting(true);
    setAiError("");
    try {
      const response = await apiClient.post<JobExtractionResponse>("/api/v1/jobs/nlp", {
        ...(jobForm.job_site_id ? { job_site_id: jobForm.job_site_id } : {}),
        prompt: aiPrompt.trim(),
      }, { withCredentials: true });
      const extracted = response.data.parsed_data;
      setJobForm((current) => ({
        ...current,
        title: extracted.title,
        headcount_required: String(extracted.headcount_required),
        max_daily_salary: extracted.max_daily_salary == null ? "" : String(extracted.max_daily_salary),
        min_experience: String(extracted.min_experience),
      }));
      toast.success("Job requirements extracted");
    } catch (err: any) {
      const message = err.response?.data?.detail;
      setAiError(typeof message === "string" ? message : "Unable to extract job requirements");
    } finally {
      setIsExtracting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#eef1fb] font-sans text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-linear-to-br from-blue-600 to-indigo-600">
              <Zap size={16} className="text-white" fill="currentColor" />
            </div>
            <span className="font-(--font-anton) text-lg uppercase text-slate-900 dark:text-white">
              GO LESKA
            </span>
          </Link>

          <button
            onClick={handleLogout}
            className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
          >
            <LogOut size={16} />
            Logout
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-7xl px-6 py-12">
        {/* Welcome Card */}
        <div className="mb-8 rounded-3xl bg-linear-to-br from-blue-50 to-indigo-50 p-8 dark:from-blue-950/20 dark:to-indigo-950/20 border border-blue-200 dark:border-blue-800">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">
                Welcome back
              </p>
              <h1 className="font-(--font-anton) text-4xl uppercase text-slate-900 dark:text-white">
                {employerProfile?.contact_person_name || user.name}
              </h1>
              <p className="mt-2 text-lg text-blue-700 dark:text-blue-300">
                {employerProfile?.employer_type?.replaceAll("_", " ") || "Employer profile"}
              </p>
            </div>
            <div className="flex h-24 w-24 items-center justify-center rounded-2xl bg-linear-to-br from-blue-400 to-blue-500 shadow-lg">
              <Building2 size={40} className="text-white" />
            </div>
          </div>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
          {/* Account Status Card */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-950">
                <Building2 size={20} className="text-emerald-600 dark:text-emerald-400" />
              </div>
              <h3 className="text-sm font-bold uppercase text-slate-600 dark:text-slate-400">
                Verification Status
              </h3>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-emerald-500"></div>
                <p className="font-semibold text-slate-700 dark:text-slate-300">
                  {employerProfile?.verification_status || "Loading"}
                </p>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {employerProfile?.onboarding_status === "COMPLETED"
                  ? "Your employer onboarding is complete"
                  : profileError || "Loading your employer profile"}
              </p>
            </div>
          </div>

          {/* Subscription Card */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-950">
                <CreditCard size={20} className="text-blue-600 dark:text-blue-400" />
              </div>
              <h3 className="text-sm font-bold uppercase text-slate-600 dark:text-slate-400">Subscription</h3>
            </div>
            <p className="text-sm font-semibold text-slate-900 dark:text-white">
              {employerProfile?.subscription_valid_until && isActiveSubscription(employerProfile.subscription_valid_until)
                ? `Active until ${formatSubscriptionDate(employerProfile.subscription_valid_until)}`
                : "No active subscription"}
            </p>
            <button type="button" onClick={handleSubscribe} disabled={isPaymentLoading} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60">
              {isPaymentLoading ? <Loader2 size={16} className="animate-spin" /> : <CreditCard size={16} />}
              {isPaymentLoading
                ? "Opening checkout..."
                : isActiveSubscription(employerProfile?.subscription_valid_until)
                  ? "Renew Subscription"
                  : "Subscribe ₹2,000"}
            </button>
            {paymentMessage && <p className="mt-3 text-xs text-slate-600 dark:text-slate-400">{paymentMessage}</p>}
          </div>

          {/* Active Jobs Card */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-950">
                <Briefcase size={20} className="text-blue-600 dark:text-blue-400" />
              </div>
              <h3 className="text-sm font-bold uppercase text-slate-600 dark:text-slate-400">
                Active Jobs
              </h3>
            </div>
            <div className="space-y-2">
              <p className="text-3xl font-bold text-slate-900 dark:text-white">{jobs.filter((job) => !["CANCELLED", "COMPLETED"].includes(job.status)).length}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {jobs.length === 0 ? "Post a job to get started" : "Active employer jobs"}
              </p>
            </div>
          </div>

          {/* Available Workers Card */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 dark:bg-indigo-950">
                <Users size={20} className="text-indigo-600 dark:text-indigo-400" />
              </div>
              <h3 className="text-sm font-bold uppercase text-slate-600 dark:text-slate-400">
                Workers
              </h3>
            </div>
            <div className="space-y-2">
              <p className="text-3xl font-bold text-slate-900 dark:text-white">0</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Available for jobs
              </p>
            </div>
          </div>

          {/* Time Card */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 dark:bg-amber-950">
                <Clock size={20} className="text-amber-600 dark:text-amber-400" />
              </div>
              <h3 className="text-sm font-bold uppercase text-slate-600 dark:text-slate-400">
                Member Since
              </h3>
            </div>
            <div className="space-y-2">
              <p className="font-semibold text-slate-900 dark:text-white">
                Today
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Welcome aboard!
              </p>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="mt-12">
          <h2 className="mb-6 font-(--font-anton) text-2xl uppercase text-slate-900 dark:text-white">
            Next Steps
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="rounded-2xl border-2 border-dashed border-blue-300 bg-blue-50 p-6 dark:border-blue-700 dark:bg-blue-950/20">
              <Briefcase size={28} className="mb-3 text-blue-600 dark:text-blue-400" />
              <h3 className="font-bold text-slate-900 dark:text-white">Post a Job</h3>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                Describe your requirements in 60 seconds
              </p>
              <button type="button" onClick={scrollToJobForm} className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-blue-600 transition hover:text-blue-700 dark:text-blue-400">
                Get started →
              </button>
            </div>

            <div className="rounded-2xl border-2 border-dashed border-indigo-300 bg-indigo-50 p-6 dark:border-indigo-700 dark:bg-indigo-950/20">
              <Users size={28} className="mb-3 text-indigo-600 dark:text-indigo-400" />
              <h3 className="font-bold text-slate-900 dark:text-white">Browse Workers</h3>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                Explore verified talent in your area
              </p>
              <Link href="/employer/workers" className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-indigo-600 transition hover:text-indigo-700 dark:text-indigo-400">
                View talent →
              </Link>
            </div>

            <div className="rounded-2xl border-2 border-dashed border-emerald-300 bg-emerald-50 p-6 dark:border-emerald-700 dark:bg-emerald-950/20">
              <Clock size={28} className="mb-3 text-emerald-600 dark:text-emerald-400" />
              <h3 className="font-bold text-slate-900 dark:text-white">Track Attendance</h3>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                GPS-based real-time tracking
              </p>
              <Link href="/employer/attendance" className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-emerald-600 transition hover:text-emerald-700 dark:text-emerald-400">
                Learn more →
              </Link>
            </div>
          </div>
        </div>

        <section id="create-job" className="mt-12 scroll-mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <MapPin size={22} className="text-blue-600 dark:text-blue-400" />
                <h2 className="font-(--font-anton) text-2xl uppercase text-slate-900 dark:text-white">Work sites</h2>
              </div>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Save locations for future job requests.</p>
            </div>
          </div>

          <form onSubmit={handleSiteSubmit} className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
            <input required maxLength={160} value={siteForm.name} onChange={(event) => setSiteForm({ ...siteForm, name: event.target.value })} placeholder="Site name" className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-800" />
            <input required maxLength={500} value={siteForm.address} onChange={(event) => setSiteForm({ ...siteForm, address: event.target.value })} placeholder="Human-readable address" className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-800" />
            <div className="sm:col-span-2"><LocationPicker value={siteForm.address} onSelect={selectSiteLocation} /></div>
            <button type="submit" disabled={isSiteSaving} className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60">
              {isSiteSaving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              Add site
            </button>
          </form>

          {siteError && <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">{siteError}</p>}
          <div className="mt-6 divide-y divide-slate-100 dark:divide-slate-800">
            {isSiteLoading ? (
              <div className="flex items-center gap-2 py-4 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" /> Loading sites...</div>
            ) : jobSites.length === 0 ? (
              <p className="py-4 text-sm text-slate-500 dark:text-slate-400">No work sites saved yet.</p>
            ) : jobSites.map((site) => (
              <div key={site.id} className="flex items-center justify-between gap-4 py-4">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900 dark:text-white">{site.name}</p>
                  <p className="truncate text-sm text-slate-500 dark:text-slate-400">{site.address || "Location selected"}</p>
                </div>
                <button type="button" title={`Remove ${site.name}`} aria-label={`Remove ${site.name}`} onClick={() => handleSiteDelete(site.id)} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:border-rose-200 hover:text-rose-600 dark:border-slate-700 dark:text-slate-400 dark:hover:border-rose-800 dark:hover:text-rose-400">
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-12 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-6 flex items-center gap-3">
            <Briefcase size={22} className="text-blue-600 dark:text-blue-400" />
            <div>
              <h2 className="font-(--font-anton) text-2xl uppercase text-slate-900 dark:text-white">Create a job</h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Choose a saved work site and describe the workers you need.</p>
            </div>
          </div>

          <form onSubmit={handleJobSubmit} className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
            <div className="grid gap-3 rounded-xl border border-blue-100 bg-blue-50/70 p-4 dark:border-blue-900/60 dark:bg-blue-950/20 lg:col-span-5">
              <label htmlFor="ai-job-prompt" className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100">
                <Sparkles size={16} className="text-blue-600 dark:text-blue-400" />
                Describe the job in your own words
              </label>
              <textarea
                id="ai-job-prompt"
                value={aiPrompt}
                onChange={(event) => setAiPrompt(event.target.value)}
                maxLength={8000}
                rows={3}
                placeholder="I need 2 construction workers in Nanded with at least 1 year of experience. Salary is ₹800 per day."
                className="resize-y rounded-lg border border-blue-100 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-800"
              />
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleVoiceInput}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  {isListening ? <Loader2 size={16} className="animate-spin text-rose-500" /> : <span aria-hidden="true">🎤</span>}
                  {isListening ? "Listening..." : "Speak"}
                </button>
                <button
                  type="button"
                  onClick={handleExtractWithAI}
                  disabled={isExtracting || isJobSaving || !aiPrompt.trim()}
                  className="inline-flex w-fit items-center justify-center gap-2 rounded-lg border border-blue-600 px-4 py-2 text-sm font-bold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60 dark:text-blue-300 dark:hover:bg-blue-950/50"
                >
                  {isExtracting ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                  {isExtracting ? "Extracting..." : "Extract with AI"}
                </button>
              </div>
              {voiceError && <p role="alert" className="text-sm text-amber-600 dark:text-amber-400">{voiceError}</p>}
              {aiError && <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">{aiError}</p>}
            </div>
            <select required value={jobForm.job_site_id} onChange={(event) => setJobForm({ ...jobForm, job_site_id: event.target.value })} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-800">
              <option value="">Select work site</option>
              {jobSites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
            </select>
            <input required maxLength={120} value={jobForm.title} onChange={(event) => setJobForm({ ...jobForm, title: event.target.value })} placeholder="Job title" className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-800" />
            <input required type="number" min={1} max={1000} value={jobForm.headcount_required} onChange={(event) => setJobForm({ ...jobForm, headcount_required: event.target.value })} placeholder="Workers needed" className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-800" />
            <input type="number" min={0} max={1000000} step="0.01" value={jobForm.max_daily_salary} onChange={(event) => setJobForm({ ...jobForm, max_daily_salary: event.target.value })} placeholder="Max daily salary" className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-800" />
            <input type="number" min={0} max={100} value={jobForm.min_experience} onChange={(event) => setJobForm({ ...jobForm, min_experience: event.target.value })} placeholder="Min experience (years)" className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-800" />
            <button type="submit" disabled={isJobSaving || isExtracting || jobSites.length === 0} className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 lg:col-span-5">
              {isJobSaving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              Create job
            </button>
          </form>
          {jobSites.length === 0 && <p className="mt-3 text-sm text-amber-600 dark:text-amber-400">Add a work site before creating a job.</p>}
          {jobError && <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">{jobError}</p>}
          {jobs.length > 0 && <div className="mt-6 divide-y divide-slate-100 dark:divide-slate-800">
            {jobs.map((job) => <div key={job.id} className="flex items-center justify-between gap-4 py-4">
              <div>
                <p className="font-semibold text-slate-900 dark:text-white">{job.title}</p>
                <p className="text-sm text-slate-500 dark:text-slate-400">{job.headcount_required} worker{job.headcount_required === 1 ? "" : "s"} · {job.status}</p>
              </div>
              <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">Created</span>
            </div>)}
          </div>}
        </section>
      </main>
    </div>
  );
}
