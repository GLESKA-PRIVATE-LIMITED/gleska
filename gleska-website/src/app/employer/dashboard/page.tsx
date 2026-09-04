"use client";

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import {
  LogOut,
  Check,
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
  PanelLeft,
  LayoutDashboard,
  X,
  User,
  Settings,
  HelpCircle,
  ChevronUp,
  History,
  Mic,
  ArrowRight,
  ChevronRight,
  Eye,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import apiClient from "@/lib/api";
import { getBrowserLocation, getLocationErrorMessage, InaccurateLocationError } from "@/lib/location";

import LocationPicker, { LocationSelection } from "@/components/LocationPicker";
import VoiceMicIcon from "@/components/ui/VoiceMicIcon";

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
  logo_url?: string;
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
  trade_id?: string | null;
  required_skills?: string[];
  status: string;
  created_at: string;
  updated_at?: string | null;
}

interface JobDetails extends Job {
  job_site: {
    id: string;
    name: string;
    address: string | null;
    latitude: number;
    longitude: number;
  };
}

interface JobMatchWorker {
  worker_profile_id: string;
  name?: string | null;
  trade_id?: string | null;
  skills: string[];
  experience_years?: number | null;
  expected_daily_wage?: number | string | null;
  availability_status?: string | null;
  distance_m?: number | null;
  composite_score: number | string;
  status: string;
  created_at: string;
}

interface JobMatches {
  matching_status: string;
  matches: JobMatchWorker[];
}

type MatchSummaryState = "LOADING" | "FOUND" | "NO_MATCHES" | "ERROR";
type JobViewMode = "details" | "workers" | null;
type WorkSiteModalMode = "location" | "site" | "create" | null;

interface JobMatchSummary {
  job_id: string;
  current_match_count: number;
  matching_status: "FOUND" | "NO_MATCHES";
}

interface JobExtractionResponse {
  parsed_data: {
    title: string;
    headcount_required: number;
    max_daily_salary: number | null;
    min_experience: number;
    skills?: string[];
  };
}

interface RecentItem {
  id: string;
  job_site_id: string;
  site_name: string;
  description: string;
  created_at: string;
  parsed_data?: {
    title?: string;
    headcount_required?: number;
    max_daily_salary?: number | null;
    min_experience?: number | null;
  };
}

function formatRecentDateGroup(isoDateStr: string): string {
  const date = new Date(isoDateStr);
  const now = new Date();

  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear();

  if (isToday) return "Today";
  if (isYesterday) return "Yesterday";

  const day = date.getDate();
  const month = date.toLocaleString("en-US", { month: "long" });
  const year = date.getFullYear();
  return `${day} ${month} ${year}`;
}

function getRecentPreviewText(description: string, defaultTitle?: string): string {
  const words = description.trim().split(/\s+/).filter(Boolean);
  if (words.length > 0) {
    return words.slice(0, 3).join(" ");
  }
  return defaultTitle || "Job Request";
}

export default function EmployerDashboard() {
  const router = useRouter();
  const { user, isLoading, nextStep, logout } = useAuth();
  const [employerProfile, setEmployerProfile] = React.useState<EmployerProfile | null>(null);
  const [jobSites, setJobSites] = React.useState<JobSite[]>([]);
  const [siteForm, setSiteForm] = React.useState({ name: "", address: "", city: "", state: "", pincode: "", latitude: "", longitude: "" });
  const [siteError, setSiteError] = React.useState("");
  const [isSiteLoading, setIsSiteLoading] = React.useState(false);
  const [isSiteSaving, setIsSiteSaving] = React.useState(false);
  const [jobs, setJobs] = React.useState<Job[]>([]);
  const [availableWorkerCount, setAvailableWorkerCount] = React.useState(0);
  const [jobForm, setJobForm] = React.useState({ job_site_id: "", title: "", headcount_required: "1", max_daily_salary: "", min_experience: "", trade_id: "", required_skills: [] as string[] });
  const [skillInput, setSkillInput] = React.useState("");
  const [jobError, setJobError] = React.useState("");
  const [isJobSaving, setIsJobSaving] = React.useState(false);
  const [aiPrompt, setAiPrompt] = React.useState("");
  const [aiError, setAiError] = React.useState("");
  const [isExtracting, setIsExtracting] = React.useState(false);
  const [selectedLanguageCode, setSelectedLanguageCode] = React.useState(DEFAULT_LANGUAGE);
  const [isListening, setIsListening] = React.useState(false);
  const [voiceError, setVoiceError] = React.useState("");
  const speechRecognitionRef = React.useRef<SpeechRecognitionLike | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = React.useState(true);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = React.useState(false);
  const [isWorkSiteModalOpen, setIsWorkSiteModalOpen] = React.useState(false);
  const [workSiteModalMode, setWorkSiteModalMode] = React.useState<WorkSiteModalMode>(null);
  const [selectedJobSiteId, setSelectedJobSiteId] = React.useState("");
  const [selectedJobSite, setSelectedJobSite] = React.useState<JobSite | null>(null);
  const [selectedJobLocation, setSelectedJobLocation] = React.useState<LocationSelection | null>(null);
  const [isJobLocationConfirmed, setIsJobLocationConfirmed] = React.useState(false);
  const [selectedSiteLocation, setSelectedSiteLocation] = React.useState<LocationSelection | null>(null);
  const [isSiteLocationConfirmed, setIsSiteLocationConfirmed] = React.useState(false);
  const [selectedJob, setSelectedJob] = React.useState<JobDetails | null>(null);
  const [selectedJobId, setSelectedJobId] = React.useState<string | null>(null);
  const [isJobDetailsLoading, setIsJobDetailsLoading] = React.useState(false);
  const [jobDetailsError, setJobDetailsError] = React.useState("");
  const [jobMatches, setJobMatches] = React.useState<JobMatches | null>(null);
  const [isJobMatchesLoading, setIsJobMatchesLoading] = React.useState(false);
  const [jobMatchesError, setJobMatchesError] = React.useState("");
  const [acceptingWorkerId, setAcceptingWorkerId] = React.useState<string | null>(null);
  const [jobMatchSummaries, setJobMatchSummaries] = React.useState<Record<string, JobMatchSummary>>({});
  const [jobMatchSummaryState, setJobMatchSummaryState] = React.useState<MatchSummaryState>("LOADING");
  const [jobViewMode, setJobViewMode] = React.useState<JobViewMode>(null);
  const selectedJobRequestRef = React.useRef(0);
  const profileMenuRef = React.useRef<HTMLDivElement>(null);

  const recents = React.useMemo<RecentItem[]>(() => {
    return jobs.map((job) => {
      const site = jobSites.find((s) => s.id === job.job_site_id);
      const siteName = site?.name || "Work Site";
      const description = `${job.title} (${job.headcount_required} worker${job.headcount_required === 1 ? "" : "s"})`;
      return {
        id: job.id,
        job_site_id: job.job_site_id,
        site_name: siteName,
        description: description,
        created_at: (job as any).created_at || new Date().toISOString(),
        parsed_data: {
          title: job.title,
          headcount_required: job.headcount_required,
          max_daily_salary: job.max_daily_salary != null ? Number(job.max_daily_salary) : null,
          min_experience: job.min_experience,
        },
      };
    });
  }, [jobs, jobSites]);

  const groupedRecents = React.useMemo(() => {
    const groups: { [dateLabel: string]: RecentItem[] } = {};
    recents.forEach((item) => {
      const label = formatRecentDateGroup(item.created_at);
      if (!groups[label]) {
        groups[label] = [];
      }
      groups[label].push(item);
    });
    return groups;
  }, [recents]);

  const handleSelectRecentItem = (item: RecentItem) => {
    setAiPrompt(item.description);
    if (item.job_site_id) {
      setJobForm((prev) => ({
        ...prev,
        job_site_id: item.job_site_id,
        ...(item.parsed_data?.title ? { title: item.parsed_data.title } : {}),
        ...(item.parsed_data?.headcount_required
          ? { headcount_required: String(item.parsed_data.headcount_required) }
          : {}),
        ...(item.parsed_data?.max_daily_salary != null
          ? { max_daily_salary: String(item.parsed_data.max_daily_salary) }
          : {}),
        ...(item.parsed_data?.min_experience != null
          ? { min_experience: String(item.parsed_data.min_experience) }
          : {}),
      }));
      const recentSite = jobSites.find((site) => site.id === item.job_site_id);
      setSelectedJobSiteId(item.job_site_id);
      setSelectedJobSite(recentSite || null);
    }
    setIsMobileMenuOpen(false);
    scrollToJobForm();
    toast.info(`Loaded recent: "${getRecentPreviewText(item.description, item.parsed_data?.title)}"`);
  };

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target as Node)) {
        setIsProfileMenuOpen(false);
      }
    };

    if (isProfileMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isProfileMenuOpen]);

  const scrollToJobForm = () => {
    setIsWorkSiteModalOpen(false);
    setWorkSiteModalMode(null);
    document.getElementById("create-job")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const openWorkSiteModal = (mode: Exclude<WorkSiteModalMode, null>) => {
    setIsProfileMenuOpen(false);
    setSiteError("");
    setWorkSiteModalMode(mode);
    setIsWorkSiteModalOpen(true);
  };

  const handleOpenWorkSiteModal = () => openWorkSiteModal("create");
  const handleOpenJobLocationPicker = () => openWorkSiteModal("location");
  const handleOpenJobSiteSelector = () => openWorkSiteModal("site");

  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/employer/auth");
    }

    if (!isLoading && user && user.role !== "EMPLOYER") {
      router.push("/");
    }

    // If onboarding is not complete, redirect to onboarding
    if (!isLoading && user && nextStep !== "DASHBOARD") {
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
      } catch {
        // Ignored or logged if needed
      }
    };

    loadEmployerProfile();

    const loadAvailableWorkerCount = async () => {
      try {
        const response = await apiClient.get<{ count: number }>('/api/v1/employers/me/available-worker-count', { withCredentials: true });
        setAvailableWorkerCount(response.data.count);
      } catch {
        setAvailableWorkerCount(0);
      }
    };

    loadAvailableWorkerCount();

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
        try {
          const summaryResponse = await apiClient.get<JobMatchSummary[]>('/api/v1/jobs/match-summary', { withCredentials: true });
          setJobMatchSummaries(Object.fromEntries(summaryResponse.data.map((summary) => [summary.job_id, summary])));
          setJobMatchSummaryState("FOUND");
        } catch {
          setJobMatchSummaries({});
          setJobMatchSummaryState("ERROR");
        }
      } catch (err: any) {
        setJobError(err.response?.data?.detail || "Unable to load jobs");
      }
    };

    loadJobs();

    const loadRecentJobRequests = async () => {
      // Direct Supabase query to employer_job_requests removed as the table does not exist
      // Rely on the initial static recents or local state for now
    };

    loadRecentJobRequests();
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

  const handleSiteSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const latitude = Number(siteForm.latitude);
    const longitude = Number(siteForm.longitude);
    const hasValidCoordinates =
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      latitude >= -90 &&
      latitude <= 90 &&
      longitude >= -180 &&
      longitude <= 180 &&
      !(latitude === 0 && longitude === 0);

    if (!selectedSiteLocation || !hasValidCoordinates || !isSiteLocationConfirmed) {
      const message = !isSiteLocationConfirmed
        ? "Confirm the selected location before adding a work site."
        : "Select a valid location search result before adding a work site.";
      setSiteError(message);
      toast.error(message);
      return;
    }

    setIsSiteSaving(true);
    setSiteError("");
    try {
      const response = await apiClient.post<JobSite>("/api/v1/job-sites/", {
        name: siteForm.name,
        address: siteForm.address,
        city: siteForm.city || null,
        state: siteForm.state || null,
        pincode: siteForm.pincode || null,
        latitude,
        longitude,
        location_source: selectedSiteLocation.location_source,
      }, { withCredentials: true });
      setJobSites((current) => [response.data, ...current]);
      setSelectedJobSiteId(response.data.id);
      setSelectedJobSite(response.data);
      setJobForm((current) => ({ ...current, job_site_id: response.data.id }));
      setSiteForm({ name: "", address: "", city: "", state: "", pincode: "", latitude: "", longitude: "" });
      setSelectedSiteLocation(null);
      setIsSiteLocationConfirmed(false);
      setIsWorkSiteModalOpen(false);
      setWorkSiteModalMode(null);
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
    setSelectedSiteLocation(location);
    setIsSiteLocationConfirmed(false);
    setSiteForm((current) => ({
      ...current,
      address: location.address,
      city: location.city || "",
      state: location.state || "",
      pincode: location.pincode || "",
      latitude: String(location.latitude),
      longitude: String(location.longitude),
    }));
  };

  const selectJobLocation = (location: LocationSelection) => {
    setSelectedJobLocation(location);
    setIsJobLocationConfirmed(false);
  };

  const confirmJobLocation = () => {
    if (!selectedJobLocation) return;
    setIsJobLocationConfirmed(true);
    setIsWorkSiteModalOpen(false);
    setWorkSiteModalMode(null);
  };

  const selectJobSite = (site: JobSite) => {
    setSelectedJobSiteId(site.id);
    setSelectedJobSite(site);
    setJobForm((current) => ({ ...current, job_site_id: site.id }));
    setIsWorkSiteModalOpen(false);
    setWorkSiteModalMode(null);
  };

  const useCurrentSiteLocation = async (): Promise<LocationSelection> => {
    try {
      const coordinates = await getBrowserLocation();
      const response = await apiClient.get("/api/v1/locations/reverse", {
        params: { latitude: coordinates.latitude, longitude: coordinates.longitude },
      });
      const location: LocationSelection = {
        address: response.data.address,
        city: response.data.city || null,
        state: response.data.state || null,
        pincode: response.data.pincode || null,
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        accuracy_m: coordinates.accuracy,
        location_source: "GPS",
      };
      selectSiteLocation(location);
      setSiteError("");
      return location;
    } catch (error) {
      const message = error instanceof InaccurateLocationError
        ? `Location accuracy is too low (${Math.round(error.accuracy)}m). Enable device location services or use Search/Map instead.`
        : "Unable to determine your current location. You can continue with Search or Map instead.";
      setSiteError(message);
      toast.error(message);
      throw error;
    }
  };

  const invalidateSiteLocation = () => {
    setSelectedSiteLocation(null);
    setIsSiteLocationConfirmed(false);
    setSiteForm((current) => ({ ...current, city: "", state: "", pincode: "", latitude: "", longitude: "" }));
  };

  const handleSiteLocationQueryChange = (query: string) => {
    invalidateSiteLocation();
    setSiteForm((current) => ({ ...current, address: query }));
  };

  const addRequiredSkill = () => {
    const skill = skillInput.trim();
    if (!skill || jobForm.required_skills.includes(skill)) return;
    setJobForm((current) => ({ ...current, required_skills: [...current.required_skills, skill] }));
    setSkillInput("");
  };

  const removeRequiredSkill = (skill: string) => {
    setJobForm((current) => ({ ...current, required_skills: current.required_skills.filter((item) => item !== skill) }));
  };

  const handleSiteDelete = async (siteId: string) => {
    try {
      await apiClient.delete(`/api/v1/job-sites/${siteId}`, { withCredentials: true });
      setJobSites((current) => current.filter((site) => site.id !== siteId));
      if (selectedJobSiteId === siteId) {
        setSelectedJobSiteId("");
        setSelectedJobSite(null);
        setJobForm((current) => ({ ...current, job_site_id: "" }));
      }
      toast.success("Work site removed");
    } catch (err: any) {
      const message = err.response?.data?.detail || "Unable to remove work site";
      setSiteError(message);
      toast.error(message);
    }
  };

  const handleJobSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!jobForm.job_site_id) {
      const message = "Select an existing Job Site or create a new Work Site before creating the job.";
      setJobError(message);
      toast.error(message);
      return;
    }
    setIsJobSaving(true);
    setJobError("");
    try {
      const response = await apiClient.post<Job>("/api/v1/jobs", {
        job_site_id: jobForm.job_site_id,
        title: jobForm.title,
        headcount_required: Number(jobForm.headcount_required),
        max_daily_salary: jobForm.max_daily_salary ? Number(jobForm.max_daily_salary) : null,
        min_experience: jobForm.min_experience ? Number(jobForm.min_experience) : null,
        ...(jobForm.trade_id.trim() ? { trade_id: jobForm.trade_id.trim() } : {}),
        required_skills: jobForm.required_skills,
      }, { withCredentials: true });
      setJobs((current) => [response.data, ...current]);
      try {
        const summaryResponse = await apiClient.get<JobMatchSummary[]>('/api/v1/jobs/match-summary', { withCredentials: true });
        setJobMatchSummaries(Object.fromEntries(summaryResponse.data.map((summary) => [summary.job_id, summary])));
        setJobMatchSummaryState("FOUND");
      } catch {
        setJobMatchSummaryState("ERROR");
      }
      setJobForm({ job_site_id: jobForm.job_site_id, title: "", headcount_required: "1", max_daily_salary: "", min_experience: "", trade_id: "", required_skills: [] });
      setSkillInput("");
      toast.success("Job created");
    } catch (err: any) {
      const message = err.response?.data?.detail || "Unable to create job";
      setJobError(message);
      toast.error(message);
    } finally {
      setIsJobSaving(false);
    }
  };

  const closeJobDetails = () => {
    selectedJobRequestRef.current += 1;
    setJobViewMode(null);
    setSelectedJobId(null);
    setSelectedJob(null);
    setIsJobDetailsLoading(false);
    setJobDetailsError("");
    setJobMatches(null);
    setIsJobMatchesLoading(false);
    setJobMatchesError("");
  };

  const handleViewJobDetails = async (jobId: string) => {
    const requestId = selectedJobRequestRef.current + 1;
    selectedJobRequestRef.current = requestId;
    setJobViewMode("details");
    setSelectedJobId(jobId);
    setSelectedJob(null);
    setJobDetailsError("");
    setJobMatches(null);
    setJobMatchesError("");
    setIsJobMatchesLoading(false);
    setIsJobDetailsLoading(true);
    try {
      const response = await apiClient.get<JobDetails>(`/api/v1/jobs/${jobId}`, { withCredentials: true });
      if (selectedJobRequestRef.current !== requestId) return;
      setSelectedJob(response.data);
    } catch (err: any) {
      if (selectedJobRequestRef.current !== requestId) return;
      setJobDetailsError(err.response?.data?.detail || "Unable to load job details");
    } finally {
      if (selectedJobRequestRef.current === requestId) setIsJobDetailsLoading(false);
    }
  };

  const handleViewJobWorkers = async (jobId: string) => {
    const requestId = selectedJobRequestRef.current + 1;
    selectedJobRequestRef.current = requestId;
    setJobViewMode("workers");
    setSelectedJobId(jobId);
    setSelectedJob(null);
    setJobDetailsError("");
    setJobMatches(null);
    setJobMatchesError("");
    setIsJobDetailsLoading(false);
    setIsJobMatchesLoading(true);
    try {
      const matchesResponse = await apiClient.get<JobMatches>(`/api/v1/jobs/${jobId}/matches`, { withCredentials: true });
      if (selectedJobRequestRef.current !== requestId) return;
      setJobMatches(matchesResponse.data);
    } catch {
      if (selectedJobRequestRef.current !== requestId) return;
      setJobMatchesError("Unable to load matching workers right now.");
    } finally {
      if (selectedJobRequestRef.current === requestId) setIsJobMatchesLoading(false);
    }
  };

  const handleSelectWorker = async (jobId: string, workerProfileId: string) => {
    const requestId = selectedJobRequestRef.current;
    setAcceptingWorkerId(workerProfileId);
    setJobMatchesError("");
    try {
      const response = await apiClient.post<{ match_id: string; worker_profile_id: string; match_status: string; job_status: string; accepted_count: number }>(
        `/api/v1/jobs/${jobId}/matches/accept`,
        { worker_profile_id: workerProfileId },
        { withCredentials: true },
      );
      if (selectedJobRequestRef.current !== requestId || selectedJobId !== jobId) return;
      setJobs((current) => current.map((job) => job.id === jobId
        ? { ...job, status: response.data.job_status }
        : job));
      setJobMatchSummaries((current) => {
        const summary = current[jobId];
        if (!summary) return current;
        return {
          ...current,
          [jobId]: {
            ...summary,
            current_match_count: response.data.job_status === "FILLED" ? 0 : summary.current_match_count,
            matching_status: response.data.job_status === "FILLED" ? "NO_MATCHES" : summary.matching_status,
          },
        };
      });
      setJobMatches((current) => current ? {
        ...current,
        matches: current.matches.map((match) => match.worker_profile_id === workerProfileId
          ? { ...match, status: response.data.match_status }
          : match),
      } : current);
      setSelectedJob((current) => current ? { ...current, status: response.data.job_status } : current);
      toast.success("Worker selected");
    } catch (err: any) {
      if (selectedJobRequestRef.current !== requestId || selectedJobId !== jobId) return;
      setJobMatchesError(err.response?.data?.detail || "Unable to select worker right now.");
    } finally {
      setAcceptingWorkerId(null);
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
        required_skills: extracted.skills || [],
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
    <div className="flex flex-col md:flex-row min-h-screen bg-[#eef1fb] font-sans text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/* Desktop Left Sidebar (hidden on mobile, flex on md+) */}
      <aside
        className={`hidden md:flex sticky top-0 h-screen flex-col justify-between border-r border-slate-200 bg-white/95 p-4 shadow-xs backdrop-blur transition-all duration-300 dark:border-slate-800 dark:bg-slate-900/95 z-40 shrink-0 ${
          isSidebarOpen ? "w-64" : "w-20 items-center"
        }`}
      >
        <div className="space-y-6 w-full">
          {/* Sidebar Top: Branding + Collapse Toggle */}
          <div className={`flex items-center gap-2 ${isSidebarOpen ? "justify-between px-1" : "justify-center"}`}>
            {isSidebarOpen ? (
              <>
                <Link href="/" className="flex items-center min-w-0">
                  <span className="font-[var(--font-anton)] text-xl uppercase tracking-wider bg-[linear-gradient(180deg,#E86100_0%,#FFF5EA_48%,#128807_100%)] bg-clip-text text-transparent select-none whitespace-nowrap">
                    GO LESKA AI
                  </span>
                </Link>
                <button
                  type="button"
                  onClick={() => setIsSidebarOpen(false)}
                  title="Collapse sidebar"
                  aria-label="Collapse sidebar"
                  className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white transition"
                >
                  <PanelLeft size={20} />
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setIsSidebarOpen(true)}
                title="Expand sidebar"
                aria-label="Expand sidebar"
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white transition"
              >
                <PanelLeft size={20} />
              </button>
            )}
          </div>

          {/* Sidebar Navigation Items */}
          <nav className="space-y-1.5 w-full">
            <Link
              href="/employer/dashboard"
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                isSidebarOpen ? "" : "justify-center"
              } bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400`}
              title="Dashboard"
            >
              <LayoutDashboard size={20} className="shrink-0" />
              {isSidebarOpen && <span>Dashboard</span>}
            </Link>

            <button
              type="button"
              onClick={scrollToJobForm}
              className={`flex items-center gap-3 w-full rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white transition ${
                isSidebarOpen ? "text-left" : "justify-center"
              }`}
              title="Post a Job"
            >
              <Briefcase size={20} className="shrink-0" />
              {isSidebarOpen && <span>Post a Job</span>}
            </button>

            <Link
              href="/employer/workers"
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white transition ${
                isSidebarOpen ? "" : "justify-center"
              }`}
              title="Workers"
            >
              <Users size={20} className="shrink-0" />
              {isSidebarOpen && <span>Workers</span>}
            </Link>

            <Link
              href="/employer/attendance"
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white transition ${
                isSidebarOpen ? "" : "justify-center"
              }`}
              title="Attendance"
            >
              <Clock size={20} className="shrink-0" />
              {isSidebarOpen && <span>Attendance</span>}
            </Link>

            <button
              type="button"
              onClick={handleOpenWorkSiteModal}
              className={`flex items-center gap-3 w-full rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white transition ${
                isSidebarOpen ? "text-left" : "justify-center"
              }`}
              title="Add Work Site"
            >
              <MapPin size={20} className="shrink-0" />
              {isSidebarOpen && <span>Add Work Site</span>}
            </button>

            {/* Sidebar Recents Section */}
            <div className="pt-3 border-t border-slate-200/80 dark:border-slate-800/80 w-full">
              {isSidebarOpen ? (
                <div className="space-y-1">
                  <div className="flex items-center justify-between px-3 py-1 text-[11px] font-bold tracking-wider text-slate-400 dark:text-slate-500 uppercase">
                    <span>Recents</span>
                    <History size={14} className="text-slate-400 dark:text-slate-500" />
                  </div>
                  <div className="space-y-3 max-h-52 overflow-y-auto pr-1">
                    {Object.keys(groupedRecents).length === 0 ? (
                      <p className="px-3 text-xs text-slate-400 dark:text-slate-500 italic">No recent searches yet</p>
                    ) : (
                      Object.entries(groupedRecents).map(([dateLabel, items]) => (
                        <div key={dateLabel} className="space-y-1">
                          <div className="px-3 text-[10px] font-bold tracking-wider uppercase text-slate-400 dark:text-slate-500">
                            {dateLabel}
                          </div>
                          {items.map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => handleSelectRecentItem(item)}
                              className="group flex flex-col w-full text-left rounded-xl px-3 py-1.5 transition hover:bg-slate-100 dark:hover:bg-slate-800/80"
                            >
                              <span className="truncate text-[11px] font-medium text-slate-400 dark:text-slate-500 group-hover:text-slate-600 dark:group-hover:text-slate-300 transition">
                                {item.site_name || "Work Site"}
                              </span>
                              <span className="truncate text-xs font-semibold text-slate-700 dark:text-slate-200 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition">
                                {getRecentPreviewText(item.description, item.parsed_data?.title)}
                              </span>
                            </button>
                          ))}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex justify-center py-2" title="Recents">
                  <History size={20} className="text-slate-400 dark:text-slate-500" />
                </div>
              )}
            </div>
          </nav>
        </div>

        {/* Sidebar Bottom: Clickable User Profile & Popover Menu */}
        <div className="relative pt-4 border-t border-slate-200 dark:border-slate-800 w-full" ref={profileMenuRef}>
          {/* Profile Popover Menu */}
          {isProfileMenuOpen && (
            <div
              className={`absolute bottom-full mb-2 z-50 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl backdrop-blur dark:border-slate-800 dark:bg-slate-900 ${
                isSidebarOpen ? "left-0 right-0 w-full min-w-[220px]" : "left-0 w-64"
              }`}
            >
              {/* Employer / Company Identity */}
              <div className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-sm font-bold text-white shadow-xs">
                  {(employerProfile?.contact_person_name || user?.name || "E").charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-slate-900 dark:text-white">
                    {employerProfile?.contact_person_name || user?.name}
                  </p>
                  <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                    {employerProfile?.employer_type?.replaceAll("_", " ") || user?.email || "Employer Account"}
                  </p>
                </div>
              </div>

              <div className="my-1.5 border-t border-slate-100 dark:border-slate-800" />

              {/* Visual Menu Items */}
              <div className="space-y-0.5">
                <Link
                  href="/employer/subscription"
                  onClick={() => setIsProfileMenuOpen(false)}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800 transition cursor-pointer"
                >
                  <CreditCard size={17} className="text-slate-500 dark:text-slate-400 shrink-0" />
                  <span>Subscription</span>
                </Link>
                <Link
                  href="/employer/company-profile"
                  onClick={() => setIsProfileMenuOpen(false)}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800 transition"
                >
                  <User size={17} className="text-slate-500 dark:text-slate-400 shrink-0" />
                  <span>Profile</span>
                </Link>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800 transition"
                >
                  <Settings size={17} className="text-slate-500 dark:text-slate-400 shrink-0" />
                  <span>Settings</span>
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800 transition"
                >
                  <HelpCircle size={17} className="text-slate-500 dark:text-slate-400 shrink-0" />
                  <span>Help</span>
                </button>
              </div>

              <div className="my-1.5 border-t border-slate-100 dark:border-slate-800" />

              {/* Log out Item */}
              <button
                type="button"
                onClick={() => {
                  setIsProfileMenuOpen(false);
                  handleLogout();
                }}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40 transition"
              >
                <LogOut size={17} className="text-red-600 dark:text-red-400 shrink-0" />
                <span>Log out</span>
              </button>
            </div>
          )}

          {/* Trigger Area */}
          <button
            type="button"
            onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
            className={`flex items-center gap-3 w-full rounded-xl p-2 transition text-left hover:bg-slate-100 dark:hover:bg-slate-800 ${
              isSidebarOpen ? "" : "justify-center"
            }`}
            title={employerProfile?.contact_person_name || user?.name}
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-sm font-bold text-white shadow-xs">
              {(employerProfile?.contact_person_name || user?.name || "E").charAt(0).toUpperCase()}
            </div>
            {isSidebarOpen && (
              <>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900 dark:text-white leading-tight">
                    {employerProfile?.contact_person_name || user?.name}
                  </p>
                  <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                    {employerProfile?.employer_type?.replaceAll("_", " ") || "Employer"}
                  </p>
                </div>
                <ChevronUp
                  size={16}
                  className={`text-slate-400 transition-transform duration-200 shrink-0 ${
                    isProfileMenuOpen ? "rotate-180" : ""
                  }`}
                />
              </>
            )}
          </button>
        </div>
      </aside>

      {/* Mobile Top Header Bar (visible on < md) */}
      <div className="md:hidden sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white/95 px-4 py-3 shadow-xs backdrop-blur dark:border-slate-800 dark:bg-slate-900/95 w-full">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            title="Toggle sidebar menu"
            aria-label="Toggle sidebar menu"
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {isMobileMenuOpen ? <X size={20} /> : <PanelLeft size={20} />}
          </button>
          <Link href="/" className="flex items-center">
            <span className="font-[var(--font-anton)] text-xl uppercase tracking-wider bg-[linear-gradient(180deg,#E86100_0%,#FFF5EA_48%,#128807_100%)] bg-clip-text text-transparent select-none whitespace-nowrap">
              GO LESKA AI
            </span>
          </Link>
        </div>
      </div>

      {/* Mobile Drawer Overlay */}
      {isMobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs"
            onClick={() => setIsMobileMenuOpen(false)}
          />
          <div className="relative flex w-72 max-w-[80vw] flex-col justify-between border-r border-slate-200 bg-white p-4 shadow-xl dark:border-slate-800 dark:bg-slate-900 z-10">
            <div className="space-y-6">
              <div className="flex items-center justify-between px-1">
                <Link href="/" className="flex items-center" onClick={() => setIsMobileMenuOpen(false)}>
                  <span className="font-[var(--font-anton)] text-xl uppercase tracking-wider bg-[linear-gradient(180deg,#E86100_0%,#FFF5EA_48%,#128807_100%)] bg-clip-text text-transparent select-none whitespace-nowrap">
                    GO LESKA AI
                  </span>
                </Link>
                <button
                  type="button"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                >
                  <X size={20} />
                </button>
              </div>

              <nav className="space-y-1.5">
                <Link
                  href="/employer/dashboard"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="flex items-center gap-3 rounded-xl bg-blue-50 px-3 py-2.5 text-sm font-semibold text-blue-600 dark:bg-blue-950/40 dark:text-blue-400"
                >
                  <LayoutDashboard size={20} />
                  <span>Dashboard</span>
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    scrollToJobForm();
                  }}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                >
                  <Briefcase size={20} />
                  <span>Post a Job</span>
                </button>
                <Link
                  href="/employer/workers"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                >
                  <Users size={20} />
                  <span>Workers</span>
                </Link>
                <Link
                  href="/employer/attendance"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                >
                  <Clock size={20} />
                  <span>Attendance</span>
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    handleOpenWorkSiteModal();
                  }}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                >
                  <MapPin size={20} />
                  <span>Add Work Site</span>
                </button>

                <div className="pt-3 border-t border-slate-200/80 dark:border-slate-800/80 w-full space-y-1">
                  <div className="flex items-center justify-between px-3 py-1 text-[11px] font-bold tracking-wider text-slate-400 dark:text-slate-500 uppercase">
                    <span>Recents</span>
                    <History size={14} className="text-slate-400 dark:text-slate-500" />
                  </div>
                  <div className="space-y-3 max-h-48 overflow-y-auto pr-1">
                    {Object.keys(groupedRecents).length === 0 ? (
                      <p className="px-3 text-xs text-slate-400 dark:text-slate-500 italic">No recent searches yet</p>
                    ) : (
                      Object.entries(groupedRecents).map(([dateLabel, items]) => (
                        <div key={dateLabel} className="space-y-1">
                          <div className="px-3 text-[10px] font-bold tracking-wider uppercase text-slate-400 dark:text-slate-500">
                            {dateLabel}
                          </div>
                          {items.map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => handleSelectRecentItem(item)}
                              className="group flex flex-col w-full text-left rounded-xl px-3 py-1.5 transition hover:bg-slate-100 dark:hover:bg-slate-800/80"
                            >
                              <span className="truncate text-[11px] font-medium text-slate-400 dark:text-slate-500 group-hover:text-slate-600 dark:group-hover:text-slate-300 transition">
                                {item.site_name || "Work Site"}
                              </span>
                              <span className="truncate text-xs font-semibold text-slate-700 dark:text-slate-200 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition">
                                {getRecentPreviewText(item.description, item.parsed_data?.title)}
                              </span>
                            </button>
                          ))}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </nav>
            </div>

            <div className="relative pt-4 border-t border-slate-200 dark:border-slate-800">
              {isProfileMenuOpen && (
                <div className="absolute bottom-full mb-2 left-0 right-0 z-50 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl backdrop-blur dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-sm font-bold text-white shadow-xs">
                      {(employerProfile?.contact_person_name || user?.name || "E").charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-slate-900 dark:text-white">
                        {employerProfile?.contact_person_name || user?.name}
                      </p>
                      <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                        {employerProfile?.employer_type?.replaceAll("_", " ") || user?.email || "Employer Account"}
                      </p>
                    </div>
                  </div>

                  <div className="my-1.5 border-t border-slate-100 dark:border-slate-800" />

                  <div className="space-y-0.5">
                    <Link
                      href="/employer/subscription"
                      onClick={() => {
                        setIsMobileMenuOpen(false);
                        setIsProfileMenuOpen(false);
                      }}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800 transition cursor-pointer"
                    >
                      <CreditCard size={17} className="text-slate-500 dark:text-slate-400 shrink-0" />
                      <span>Subscription</span>
                    </Link>
                    <Link
                      href="/employer/company-profile"
                      onClick={() => {
                        setIsMobileMenuOpen(false);
                        setIsProfileMenuOpen(false);
                      }}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800 transition"
                    >
                      <User size={17} className="text-slate-500 dark:text-slate-400 shrink-0" />
                      <span>Profile</span>
                    </Link>
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800 transition"
                    >
                      <Settings size={17} className="text-slate-500 dark:text-slate-400 shrink-0" />
                      <span>Settings</span>
                    </button>
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800 transition"
                    >
                      <HelpCircle size={17} className="text-slate-500 dark:text-slate-400 shrink-0" />
                      <span>Help</span>
                    </button>
                  </div>

                  <div className="my-1.5 border-t border-slate-100 dark:border-slate-800" />

                  <button
                    type="button"
                    onClick={() => {
                      setIsMobileMenuOpen(false);
                      setIsProfileMenuOpen(false);
                      handleLogout();
                    }}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40 transition"
                  >
                    <LogOut size={17} className="text-red-600 dark:text-red-400 shrink-0" />
                    <span>Log out</span>
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
                className="flex items-center gap-3 w-full rounded-xl p-2 transition text-left hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-sm font-bold text-white shadow-xs">
                  {(employerProfile?.contact_person_name || user?.name || "E").charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900 dark:text-white leading-tight">
                    {employerProfile?.contact_person_name || user?.name}
                  </p>
                  <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                    {employerProfile?.employer_type?.replaceAll("_", " ") || "Employer"}
                  </p>
                </div>
                <ChevronUp
                  size={16}
                  className={`text-slate-400 transition-transform duration-200 shrink-0 ${
                    isProfileMenuOpen ? "rotate-180" : ""
                  }`}
                />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0">
        <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
          {/* Welcome Card */}
          <div className="mb-8 rounded-3xl bg-linear-to-br from-blue-50 to-indigo-50 p-5 sm:p-8 dark:from-blue-950/20 dark:to-indigo-950/20 border border-blue-200 dark:border-blue-800">
            <div className="flex flex-col-reverse sm:flex-row items-start sm:items-center justify-between gap-4 sm:gap-6">
              <div>
                <p className="text-xs sm:text-sm font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">
                  Welcome back
                </p>
                <h1 className="font-(--font-anton) text-2xl sm:text-4xl uppercase text-slate-900 dark:text-white">
                  {employerProfile?.contact_person_name || user.name}
                </h1>
                <p className="mt-1 sm:mt-2 text-base sm:text-lg text-blue-700 dark:text-blue-300">
                  {employerProfile?.employer_type?.replaceAll("_", " ") || "Employer profile"}
                </p>
              </div>
              <Link
                href="/employer/company-profile"
                className="group relative flex h-20 w-20 sm:h-24 sm:w-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-linear-to-br from-blue-500 to-indigo-600 shadow-lg transition hover:shadow-xl hover:scale-105"
                title="View Company Profile"
              >
                {employerProfile?.logo_url ? (
                  <img src={employerProfile.logo_url} alt="Company Logo" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center text-white">
                    <Building2 size={32} className="sm:hidden" />
                    <Building2 size={40} className="hidden sm:block" />
                    <span className="text-[10px] font-semibold mt-1 opacity-0 group-hover:opacity-100 transition">Profile</span>
                  </div>
                )}
              </Link>
            </div>
          </div>

          {/* Grid */}
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {/* Active Jobs Card */}
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900">
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
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 dark:bg-indigo-950">
                  <Users size={20} className="text-indigo-600 dark:text-indigo-400" />
                </div>
                <h3 className="text-sm font-bold uppercase text-slate-600 dark:text-slate-400">
                  Workers
                </h3>
              </div>
              <div className="space-y-2">
                <p className="text-3xl font-bold text-slate-900 dark:text-white">{availableWorkerCount}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Available for jobs
                </p>
              </div>
            </div>
          </div>


          {/* COMPACT JOB SEARCH SECTION (CENTERED & PROPORTIONED TO REFERENCE DESIGN) */}
          <div className="mx-auto max-w-2xl my-8 sm:my-10 space-y-5 flex flex-col items-center w-full">
            {/* Top Row: Pill Buttons for Select Location & Job Site */}
            <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-6 w-full">
              {/* Select Location Pill Button */}
              <button
                type="button"
                onClick={handleOpenJobLocationPicker}
                className="group flex items-center justify-between gap-3 sm:gap-4 rounded-full bg-blue-600 px-4 sm:px-5 py-2.5 text-white shadow-md hover:bg-blue-700 active:scale-95 transition cursor-pointer w-full sm:w-auto sm:min-w-[210px] max-w-full"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-blue-600 shrink-0 shadow-xs">
                    <MapPin size={18} />
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-bold text-white leading-tight">Select location</p>
                    <p className="max-w-[150px] truncate text-[11px] font-medium text-blue-100 opacity-90">{selectedJobLocation?.address || "For this job"}</p>
                  </div>
                </div>
                <ChevronRight size={18} className="text-white opacity-80 group-hover:translate-x-0.5 transition-transform shrink-0" />
              </button>

              {/* Job Site Pill Button */}
              <button
                type="button"
                onClick={handleOpenJobSiteSelector}
                className="group flex items-center justify-between gap-3 sm:gap-4 rounded-full bg-blue-600 px-4 sm:px-5 py-2.5 text-white shadow-md hover:bg-blue-700 active:scale-95 transition cursor-pointer w-full sm:w-auto sm:min-w-[210px] max-w-full"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-blue-600 shrink-0 shadow-xs">
                    <MapPin size={18} />
                  </div>
                  <div className="text-left min-w-0">
                    <p className="text-sm font-bold text-white leading-tight truncate max-w-[130px] sm:max-w-[150px]">
                      {selectedJobSite?.name || "Job site"}
                    </p>
                    <p className="text-[11px] font-medium text-blue-100 opacity-90 truncate max-w-[130px] sm:max-w-[150px]">
                      {selectedJobSite?.address || "Select a saved site"}
                    </p>
                  </div>
                </div>
                <ChevronRight size={18} className="text-white opacity-80 group-hover:translate-x-0.5 transition-transform shrink-0" />
              </button>
            </div>

            {/* Main Pill Search Bar */}
            <div className="w-full max-w-xl relative flex items-center rounded-full border border-blue-500/80 bg-white p-1.5 shadow-xl dark:border-blue-500 dark:bg-slate-900 focus-within:ring-4 focus-within:ring-blue-500/20 transition-all">
              {/* Microphone Icon Button (Left) */}
              <button
                type="button"
                onClick={handleVoiceInput}
                title={isListening ? "Listening..." : "Speak requirement"}
                aria-label={isListening ? "Listening..." : "Speak requirement"}
                className={`relative flex h-10 w-10 sm:h-11 sm:w-11 shrink-0 items-center justify-center rounded-full transition-all duration-300 cursor-pointer ml-1 ${
                  isListening
                    ? "text-purple-700 dark:text-purple-200 bg-purple-50/60 dark:bg-purple-950/40"
                    : "text-slate-500 hover:bg-slate-100 hover:text-blue-600 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-blue-400"
                }`}
              >
                {/* Shimmer & Glow aura elements (active during recording) */}
                <span
                  className={`absolute -inset-1 rounded-full bg-gradient-to-r from-violet-500 via-pink-500 to-indigo-500 blur-md transition-opacity duration-500 ${
                    isListening ? "opacity-75 animate-mic-voice-active" : "opacity-0 pointer-events-none"
                  }`}
                />
                <span
                  className={`absolute inset-0 rounded-full bg-gradient-to-r from-violet-500/25 via-rose-500/30 to-indigo-500/25 transition-opacity duration-500 animate-mic-shimmer-bg ${
                    isListening ? "opacity-100" : "opacity-0 pointer-events-none"
                  }`}
                />
                <VoiceMicIcon className="relative z-10 w-5 h-5 sm:w-5 sm:h-5 transition-transform duration-300" />
              </button>

              {/* Input Field (Center) */}
              <input
                type="text"
                value={aiPrompt}
                onChange={(event) => setAiPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleExtractWithAI();
                  }
                }}
                placeholder="Description"
                className="w-full min-w-0 bg-transparent px-2 sm:px-4 py-2 text-sm sm:text-base font-medium text-slate-900 outline-none placeholder:text-slate-400 dark:text-white dark:placeholder:text-slate-500"
              />

              {/* Arrow Submit Button (Right) */}
              <button
                type="button"
                onClick={() => void handleExtractWithAI()}
                disabled={isExtracting || !aiPrompt.trim()}
                title="Extract with AI"
                aria-label="Extract with AI"
                className="flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-full bg-linear-to-r from-blue-500 to-indigo-600 text-white shadow-md hover:from-blue-600 hover:to-indigo-700 active:scale-95 transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shrink-0 mr-1"
              >
                {isExtracting ? <Loader2 size={18} className="animate-spin sm:w-5 sm:h-5" /> : <ArrowRight size={18} className="sm:w-5 sm:h-5" />}
              </button>
            </div>
          </div>

          <section id="create-job" className="mt-12 scroll-mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-6 flex items-center gap-3">
              <Briefcase size={22} className="text-blue-600 dark:text-blue-400" />
              <div>
                <h2 className="font-(--font-anton) text-2xl uppercase text-slate-900 dark:text-white">Create a job</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Choose a saved work site and specify your job requirements.</p>
              </div>
            </div>

            <form onSubmit={handleJobSubmit} className="space-y-6">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                {/* Select Work Site */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Work Site <span className="text-rose-500">*</span>
                  </label>
                  <select
                    required
                    value={jobForm.job_site_id}
                    onChange={(event) => {
                      const site = jobSites.find((item) => item.id === event.target.value) || null;
                      setSelectedJobSiteId(event.target.value);
                      setSelectedJobSite(site);
                      setJobForm({ ...jobForm, job_site_id: event.target.value });
                    }}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800/50 dark:text-white dark:focus:bg-slate-800"
                  >
                    <option value="">Select work site</option>
                    {jobSites.map((site) => (
                      <option key={site.id} value={site.id}>
                        {site.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Job Title */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Job Title <span className="text-rose-500">*</span>
                  </label>
                  <input
                    required
                    maxLength={120}
                    value={jobForm.title}
                    onChange={(event) => setJobForm({ ...jobForm, title: event.target.value })}
                    placeholder="Job title"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800/50 dark:text-white dark:placeholder:text-slate-500 dark:focus:bg-slate-800"
                  />
                </div>

                {/* Required Trade */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Required Trade</label>
                  <input
                    value={jobForm.trade_id}
                    onChange={(event) => setJobForm({ ...jobForm, trade_id: event.target.value })}
                    placeholder="e.g. Cook"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800/50 dark:text-white dark:placeholder:text-slate-500 dark:focus:bg-slate-800"
                  />
                </div>

                {/* Workers Needed */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Workers Needed <span className="text-rose-500">*</span>
                  </label>
                  <input
                    required
                    type="number"
                    min={1}
                    max={1000}
                    value={jobForm.headcount_required}
                    onChange={(event) => setJobForm({ ...jobForm, headcount_required: event.target.value })}
                    placeholder="Workers needed"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800/50 dark:text-white dark:placeholder:text-slate-500 dark:focus:bg-slate-800"
                  />
                </div>

                {/* Required Skills */}
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Required Skills</label>
                  <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/50">
                    {jobForm.required_skills.map((skill) => (
                      <span key={skill} className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300">
                        {skill}
                        <button type="button" onClick={() => removeRequiredSkill(skill)} aria-label={`Remove ${skill}`} className="font-bold text-blue-500 hover:text-rose-600">×</button>
                      </span>
                    ))}
                    <input
                      value={skillInput}
                      onChange={(event) => setSkillInput(event.target.value)}
                      onKeyDown={(event) => { if (event.key === "Enter" || event.key === ",") { event.preventDefault(); addRequiredSkill(); } }}
                      placeholder="Add a skill"
                      className="min-w-32 flex-1 bg-transparent px-1 py-1 text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-white"
                    />
                    <button type="button" onClick={addRequiredSkill} className="text-xs font-bold text-blue-600 hover:text-blue-700 dark:text-blue-400">Add</button>
                  </div>
                </div>

                {/* Max Daily Salary */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Max Daily Salary (₹)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={1000000}
                    step="0.01"
                    value={jobForm.max_daily_salary}
                    onChange={(event) => setJobForm({ ...jobForm, max_daily_salary: event.target.value })}
                    placeholder="Max daily salary"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800/50 dark:text-white dark:placeholder:text-slate-500 dark:focus:bg-slate-800"
                  />
                </div>

                {/* Min Experience */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Min Experience (years)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={jobForm.min_experience}
                    onChange={(event) => setJobForm({ ...jobForm, min_experience: event.target.value })}
                    placeholder="Min experience"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800/50 dark:text-white dark:placeholder:text-slate-500 dark:focus:bg-slate-800"
                  />
                </div>
              </div>

              {/* Centered Horizontal Create Job Button */}
              <div className="flex justify-center pt-2">
                <button
                  type="submit"
                  disabled={isJobSaving || isExtracting || jobSites.length === 0}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-8 py-2.5 text-sm font-bold text-white shadow-md hover:bg-blue-700 active:scale-95 transition disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
                >
                  {isJobSaving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                  Create Job
                </button>
              </div>
            </form>
            {jobSites.length === 0 && <p className="mt-3 text-center text-sm text-amber-600 dark:text-amber-400">Add a work site before creating a job.</p>}
            {jobError && <p className="mt-3 text-center text-sm text-rose-600 dark:text-rose-400">{jobError}</p>}
            {jobs.length > 0 && <div className="mt-6 divide-y divide-slate-100 dark:divide-slate-800">
              {jobs.map((job) => {
                const summary = jobMatchSummaries[job.id];
                const matchCount = summary?.current_match_count || 0;
                const selectableMatchCount = job.status === "FILLED" ? 0 : matchCount;
                const summaryText = job.status === "FILLED"
                  ? "Worker selected"
                  : jobMatchSummaryState === "LOADING"
                  ? "Checking suitable workers..."
                  : jobMatchSummaryState === "ERROR"
                    ? "Unable to load match results"
                    : selectableMatchCount === 0
                      ? "No suitable workers found"
                      : `${selectableMatchCount} suitable worker${selectableMatchCount === 1 ? "" : "s"} found`;
                return <div key={job.id} className="flex items-center justify-between gap-4 py-4">
                <div>
                  <p className="font-semibold text-slate-900 dark:text-white">{job.title}</p>
                  <p className="text-sm text-slate-500 dark:text-slate-400">{job.headcount_required} worker{job.headcount_required === 1 ? "" : "s"} · {job.status}</p>
                  <p className={`mt-1 text-sm font-semibold ${jobMatchSummaryState === "ERROR" ? "text-rose-600 dark:text-rose-400" : "text-slate-700 dark:text-slate-300"}`}>{summaryText}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {jobMatchSummaryState === "FOUND" && selectableMatchCount > 0 && <button type="button" onClick={() => void handleViewJobWorkers(job.id)} className="inline-flex items-center gap-2 rounded-lg border border-blue-200 px-3 py-2 text-sm font-semibold text-blue-600 hover:border-blue-300 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-400 dark:hover:bg-slate-800">
                    <Users size={16} /> View Workers
                  </button>}
                  <button type="button" onClick={() => void handleViewJobDetails(job.id)} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-blue-600 hover:border-blue-300 hover:bg-blue-50 dark:border-slate-700 dark:text-blue-400 dark:hover:bg-slate-800">
                    <Eye size={16} /> View Details
                  </button>
                </div>
              </div>;
              })}
            </div>}
          </section>

        </main>
      </div>

      {/* Floating Work Sites Popover/Modal */}
      {isWorkSiteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs transition-opacity"
            onClick={() => setIsWorkSiteModalOpen(false)}
          />
          <div className="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900 z-10">
            <div className="mb-4 flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <MapPin size={22} className="text-blue-600 dark:text-blue-400" />
                <span className="font-(--font-anton) text-xl uppercase tracking-wide text-slate-900 dark:text-white">
                  {workSiteModalMode === "location" ? "Select Job Location" : workSiteModalMode === "site" ? "Select Job Site" : "Add Work Site"}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsWorkSiteModalOpen(false)}
                className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white transition"
                title="Close"
              >
                <X size={20} />
              </button>
            </div>

            {workSiteModalMode === "location" && (
              <div className="space-y-4">
                <LocationPicker label="Location for this job" value={selectedJobLocation?.address || ""} onSelect={selectJobLocation} getCurrentLocationErrorMessage={getLocationErrorMessage} onUseCurrentLocation={async () => {
                  const coordinates = await getBrowserLocation();
                  const response = await apiClient.get("/api/v1/locations/reverse", { params: { latitude: coordinates.latitude, longitude: coordinates.longitude } });
                  const location: LocationSelection = { ...response.data, latitude: coordinates.latitude, longitude: coordinates.longitude, accuracy_m: coordinates.accuracy, location_source: "GPS" };
                  selectJobLocation(location);
                  return location;
                }} placeholder="Search area, locality, city or pincode" />
                {selectedJobLocation && <div className="space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700"><p className="text-sm font-semibold text-slate-900 dark:text-white">{selectedJobLocation.address}</p><p className="text-xs text-slate-500 dark:text-slate-400">{selectedJobLocation.latitude}, {selectedJobLocation.longitude}{selectedJobLocation.accuracy_m ? ` · Accuracy ${Math.round(selectedJobLocation.accuracy_m)}m` : ""}</p><div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700"><iframe title="Selected job location" className="h-48 w-full border-0" src={`https://www.openstreetmap.org/export/embed.html?bbox=${selectedJobLocation.longitude - 0.005}%2C${selectedJobLocation.latitude - 0.005}%2C${selectedJobLocation.longitude + 0.005}%2C${selectedJobLocation.latitude + 0.005}&layer=mapnik&marker=${selectedJobLocation.latitude}%2C${selectedJobLocation.longitude}`} /></div><button type="button" onClick={confirmJobLocation} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white"><Check size={16} /> {isJobLocationConfirmed ? "Location confirmed" : "Confirm Location"}</button></div>}
              </div>
            )}

            {workSiteModalMode === "create" && <form onSubmit={handleSiteSubmit} className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
              <input required maxLength={160} value={siteForm.name} onChange={(event) => setSiteForm({ ...siteForm, name: event.target.value })} placeholder="Site name" className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-hidden focus:border-blue-500 dark:border-slate-700 dark:bg-slate-800" />
              <div className="md:col-span-2 lg:col-span-5"><LocationPicker label="Work Site Location" value={siteForm.address} onSelect={selectSiteLocation} onQueryChange={handleSiteLocationQueryChange} onUseCurrentLocation={useCurrentSiteLocation} placeholder="Search area, locality, city or pincode" /></div>
              <input required maxLength={500} value={siteForm.address} readOnly={Boolean(selectedSiteLocation)} onChange={(event) => { invalidateSiteLocation(); setSiteForm((current) => ({ ...current, address: event.target.value })); }} placeholder="Selected address" className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-hidden focus:border-blue-500 read-only:cursor-not-allowed read-only:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:read-only:bg-slate-800/70" />
              {selectedSiteLocation && <div className="md:col-span-2 lg:col-span-5 space-y-2"><div className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300"><Check size={16} /> Location selected from {selectedSiteLocation.location_source}. {selectedSiteLocation.accuracy_m ? `Accuracy: ${Math.round(selectedSiteLocation.accuracy_m)}m.` : ""}</div><div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700"><iframe title="Selected work site location" className="h-48 w-full border-0" src={`https://www.openstreetmap.org/export/embed.html?bbox=${selectedSiteLocation.longitude - 0.005}%2C${selectedSiteLocation.latitude - 0.005}%2C${selectedSiteLocation.longitude + 0.005}%2C${selectedSiteLocation.latitude + 0.005}&layer=mapnik&marker=${selectedSiteLocation.latitude}%2C${selectedSiteLocation.longitude}`} /></div><button type="button" onClick={() => setIsSiteLocationConfirmed(true)} disabled={isSiteLocationConfirmed} className="inline-flex items-center gap-2 rounded-lg border border-emerald-300 px-3 py-2 text-sm font-bold text-emerald-700 disabled:cursor-default disabled:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-300 dark:disabled:bg-emerald-950/30"><Check size={16} /> {isSiteLocationConfirmed ? "Location confirmed" : "Confirm Location"}</button></div>}
              <button type="submit" disabled={isSiteSaving} className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60">
                {isSiteSaving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                Add site
              </button>
            </form>}

            {siteError && <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">{siteError}</p>}
            {(workSiteModalMode === "site" || workSiteModalMode === "create") && <div className="mt-6 divide-y divide-slate-100 dark:divide-slate-800 max-h-60 overflow-y-auto pr-1">
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
                  {workSiteModalMode === "site" ? <button type="button" onClick={() => selectJobSite(site)} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-bold text-white"><Check size={16} /> Select</button> : <button type="button" title={`Remove ${site.name}`} aria-label={`Remove ${site.name}`} onClick={() => handleSiteDelete(site.id)} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:border-rose-200 hover:text-rose-600 dark:border-slate-700 dark:text-slate-400 dark:hover:border-rose-800 dark:hover:text-rose-400"><Trash2 size={16} /></button>}
                </div>
              ))}
            </div>}
            {workSiteModalMode === "site" && <button type="button" onClick={() => { setSiteForm({ name: "", address: "", city: "", state: "", pincode: "", latitude: "", longitude: "" }); setSelectedSiteLocation(null); setIsSiteLocationConfirmed(false); setWorkSiteModalMode("create"); }} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-blue-200 px-3 py-2 text-sm font-bold text-blue-700 dark:border-blue-800 dark:text-blue-300"><Plus size={16} /> Create New Work Site</button>}
          </div>
        </div>
      )}

      {(jobViewMode || isJobDetailsLoading || selectedJob || jobDetailsError) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-slate-900/60" onClick={closeJobDetails} />
          <section className="relative w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-5 flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">{jobViewMode === "workers" ? "Matched Workers" : "Job Details"}</h2>
              <button type="button" onClick={closeJobDetails} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close job details"><X size={20} /></button>
            </div>
            {isJobDetailsLoading && <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" /> Loading job details...</div>}
            {jobDetailsError && <p className="text-sm text-rose-600">{jobDetailsError}</p>}
            {selectedJob && <div className="grid gap-4 text-sm sm:grid-cols-2">
              <div className="sm:col-span-2"><p className="text-xs font-semibold uppercase text-slate-400">Job Title</p><p className="mt-1 text-lg font-bold">{selectedJob.title}</p></div>
              <div><p className="text-xs font-semibold uppercase text-slate-400">Status</p><p className="mt-1 font-semibold">{selectedJob.status}</p></div>
              <div><p className="text-xs font-semibold uppercase text-slate-400">Work Site</p><p className="mt-1 font-semibold">{selectedJob.job_site.name}</p></div>
              <div className="sm:col-span-2"><p className="text-xs font-semibold uppercase text-slate-400">Site Address</p><p className="mt-1">{selectedJob.job_site.address || "No address recorded"}</p></div>
              <div><p className="text-xs font-semibold uppercase text-slate-400">Required Trade</p><p className="mt-1">{selectedJob.trade_id || "Not specified"}</p></div>
              <div><p className="text-xs font-semibold uppercase text-slate-400">Workers Needed</p><p className="mt-1">{selectedJob.headcount_required}</p></div>
              <div><p className="text-xs font-semibold uppercase text-slate-400">Required Skills</p><p className="mt-1">{selectedJob.required_skills?.length ? selectedJob.required_skills.join(", ") : "No skills specified"}</p></div>
              <div><p className="text-xs font-semibold uppercase text-slate-400">Max Daily Salary</p><p className="mt-1">{selectedJob.max_daily_salary != null ? `₹${selectedJob.max_daily_salary}` : "Not specified"}</p></div>
              <div><p className="text-xs font-semibold uppercase text-slate-400">Min Experience</p><p className="mt-1">{selectedJob.min_experience != null ? `${selectedJob.min_experience} years` : "Not specified"}</p></div>
              <div><p className="text-xs font-semibold uppercase text-slate-400">Created</p><p className="mt-1">{new Date(selectedJob.created_at).toLocaleString()}</p></div>
            </div>}
            {jobViewMode === "workers" && <div>
              <h3 className="text-sm font-bold uppercase text-slate-600 dark:text-slate-300">Matching Workers</h3>
              {isJobMatchesLoading && <div className="mt-3 flex items-center gap-2 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" /> Matching workers...</div>}
              {!isJobMatchesLoading && jobMatchesError && <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">{jobMatchesError}</p>}
              {!isJobMatchesLoading && !jobMatchesError && jobMatches?.matches.length === 0 && <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">No suitable workers found yet.</p>}
              {!isJobMatchesLoading && !jobMatchesError && jobMatches?.matches.length ? <div className="mt-3 space-y-3">{jobMatches.matches.map((match) => (
                <div key={match.worker_profile_id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                  <p className="font-semibold text-slate-900 dark:text-white">{match.name || "Matched worker"}</p>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{match.experience_years != null ? `${match.experience_years} years experience` : "Experience not specified"} · {match.expected_daily_wage != null ? `₹${match.expected_daily_wage}/day` : "Wage not specified"}</p>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{match.trade_id || "Trade not specified"} · {match.availability_status || "Availability unknown"} · {match.distance_m != null ? `${(match.distance_m / 1000).toFixed(1)} km away` : "Distance unavailable"}</p>
                  {match.skills.length > 0 && <p className="mt-1 text-xs text-slate-400">{match.skills.join(", ")}</p>}
                  <button
                    type="button"
                    disabled={selectedJob?.status === "FILLED" || match.status !== "PENDING" || acceptingWorkerId === match.worker_profile_id}
                    onClick={() => selectedJobId && void handleSelectWorker(selectedJobId, match.worker_profile_id)}
                    className="mt-3 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {acceptingWorkerId === match.worker_profile_id ? <Loader2 size={15} className="animate-spin" /> : null}
                    {match.status === "ACCEPTED" ? "Selected" : "Select Worker"}
                  </button>
                </div>
              ))}</div> : null}
            </div>}
          </section>
        </div>
      )}
    </div>
  );
}
