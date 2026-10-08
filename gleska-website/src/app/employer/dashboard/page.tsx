"use client";

import React, { useEffect } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { isAxiosError } from "axios";
import {
  Check,
  Users,
  Briefcase,
  Loader2,
  MapPin,
  Plus,
  Trash2,
  User,
  X,
  ArrowRight,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Calendar,
  Clock,
  Award,
  Eye,
  Sparkles,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import apiClient from "@/lib/api";
import { formatSubscriptionExpiry, isSubscriptionActive } from "@/lib/subscription";
import { getLocationErrorMessage, watchBrowserLocation } from "@/lib/location";

import LocationPicker, { LocationSelection } from "@/components/LocationPicker";
import AccountManagementShell, { formatEmployerType } from "@/components/AccountManagementShell";

const JOB_FORM_COPY = {
  titleRequired: "Job Title is required.", titleTooLong: "Job Title cannot exceed 120 characters.",
  workersRequired: "Workers Needed is required.", workersMin: "Workers Needed must be at least 1.", workersMax: "Workers Needed cannot exceed 1,000.",
  wageRequired: "Daily Wage is required.", wageValid: "Please enter a valid daily wage.",
  durationRequired: "Work Duration is required.", durationRange: "Work duration must be between 1 and 365 days.",
  timingRequired: "Daily Timing is required.",
  experienceRequiredErr: "Min Experience is required.", experienceRange: "Minimum experience must be 0 (no experience) or at least 1 year.",
  siteRequired: "Work Site is required.", skillAlreadyAdded: "Skill already added.",
  createJobTitle: "Create Job", ready: "Ready to create", incomplete: "Incomplete",
  jobDetailsTitle: "Job Details", role: "Job Title", rolePlaceholder: "Job title",
  workers: "Workers Needed", workersPlaceholder: "Number of workers",
  wage: "Daily Wage", wagePlaceholder: "Daily wage", perDay: "/ day",
  workDetailsTitle: "Work Details", duration: "Work Duration", durationPlaceholder: "Duration",
  unitDays: "Days", unitMonths: "Months", unitYears: "Years",
  timing: "Daily Timing", timingPlaceholder: "Working hours",
  experience: "Min Experience", noExperience: "No experience required (Fresher)", experiencePlaceholder: "Experience",
  site: "Work Site", notSelected: "Not selected", selectSite: "Select site", changeSite: "Change site",
  skills: "Required Skills", optional: "Optional", removeSkill: "Remove skill", noSkillsAdded: "No skills added",
  skillsPlaceholder: "Add a skill", addSkill: "+ Add",
  creating: "Creating job...", createJobBtn: "Create Job", pleaseComplete: "Please complete:", complete: "Complete all requirements to create job",
} as const;

declare global {
  interface Window {
    Cashfree?: (options: { mode: "sandbox" | "production" }) => {
      checkout: (options: { paymentSessionId: string; redirectTarget: "_self" }) => Promise<void> | void;
    };
  }
}

async function loadCashfree() {
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
}

interface EmployerProfile {
  employer_type?: string | null;
  onboarding_status?: string;
  verification_status?: string;
  contact_person_name?: string;
  created_at?: string;
  subscription_valid_until?: string | null;
  trial_started_at?: string | null;
  trial_ends_at?: string | null;
  trial_active?: boolean;
  trial_days_remaining?: number;
  subscription_active?: boolean;
  payment_required?: boolean;
  free_worker_limit: number;
  free_workers_used: number;
  free_workers_remaining: number;
  commission_required_for_next_worker: boolean;
  commission_amount: number;
  has_availed_free_dispatch?: boolean;
  profile_photo_url?: string | null;
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
  work_duration_days?: number | null;
  work_timing?: string | null;
  status: string;
  created_at: string;
  updated_at?: string | null;
}

interface HiringAgentMessage {
  role: "user" | "assistant";
  content: string;
  created_at?: string | null;
}

interface HiringAgentCandidate {
  candidate_ref: string;
  name?: string | null;
  trade?: string | null;
  skills: string[];
  experience_years?: number | null;
  expected_daily_wage?: number | null;
  availability_status?: string | null;
  projected_distance_m?: number | null;
  verified_evidence: string[];
  unavailable_fields: string[];
}

interface HiringAgentJobDraft {
  title?: string | null;
  headcount_required?: number | null;
  max_daily_salary?: number | null;
  min_experience?: number | null;
  work_duration_days?: number | null;
  work_timing?: string | null;
  trade_id?: string | null;
  required_skills: string[];
}

interface HiringAgentConversation {
  conversation_id: string;
  job_id: string | null;
  state_revision: number;
  assistant_message?: string;
  history: HiringAgentMessage[];
  candidate_results: HiringAgentCandidate[];
  candidate_result_status: "FOUND" | "NO_MATCHES" | "NOT_RETRIEVED" | "FAILED";
  candidate_result_note?: string | null;
  candidate_retrieved_at?: string | null;
  job_draft: HiringAgentJobDraft;
  job_site_id?: string | null;
  job_site_name?: string | null;
  job_confirmation_token?: string | null;
  created_job_id?: string | null;
}

interface ManualJobFormState {
  title?: string | null;
  headcount_required?: number | null;
  max_daily_salary?: number | null;
  min_experience?: number | null;
  work_duration_days?: number | null;
  work_duration_months?: number | null;
  work_timing?: string | null;
  required_skills: string[];
  job_site_id?: string | null;
  job_site_name?: string | null;
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
  selected_workers: JobMatchWorker[];
  headcount_required: number;
  selected_count: number;
  remaining_count: number;
}

function formatExperience(value?: number | null): string {
  if (value == null) return "Experience not specified";
  return `${value} ${value === 1 ? "year" : "years"} experience`;
}

function formatWage(value?: number | string | null): string {
  if (value == null || !Number.isFinite(Number(value))) return "Wage not specified";
  return `₹${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 0 })}/day`;
}

function jobStatusLabel(status: string): string {
  return {
    SEARCHING: "Searching for workers",
    FILLED: "Workers filled",
    COMPLETED: "Completed",
    CANCELLED: "Cancelled",
  }[status] || status;
}

type MatchSummaryState = "LOADING" | "FOUND" | "NO_MATCHES" | "ERROR";
type JobViewMode = "details" | "workers" | null;
type WorkSiteModalMode = "site" | "create" | null;
interface JobMatchSummary {
  job_id: string;
  current_match_count: number;
  accepted_count: number;
  matching_status: "FOUND" | "NO_MATCHES";
}

export default function EmployerDashboard() {
  const router = useRouter();
  const { user, isLoading, nextStep, logout } = useAuth();
  const [employerProfile, setEmployerProfile] = React.useState<EmployerProfile | null>(null);
  const displayedProfilePhotoUrl =
    employerProfile?.profile_photo_url ?? user?.profile_photo_url ?? null;
  const [jobSites, setJobSites] = React.useState<JobSite[]>([]);
  const [siteForm, setSiteForm] = React.useState({ name: "", address: "", city: "", state: "", pincode: "", latitude: "", longitude: "" });
  const [siteError, setSiteError] = React.useState("");
  const [siteLocationNotice, setSiteLocationNotice] = React.useState("");
  const [isSiteLoading, setIsSiteLoading] = React.useState(false);
  const [isSiteSaving, setIsSiteSaving] = React.useState(false);
  const siteLocationAcquisitionRef = React.useRef<AbortController | null>(null);
  const [jobs, setJobs] = React.useState<Job[]>([]);
  const [availableWorkerCount, setAvailableWorkerCount] = React.useState(0);
  const [activeWorkerCount, setActiveWorkerCount] = React.useState(0);
  const [manualJobState, setManualJobState] = React.useState<ManualJobFormState>({ required_skills: [] });
  const [isHiringAgentSending, setIsHiringAgentSending] = React.useState(false);
  const [hiringAgentInput, setHiringAgentInput] = React.useState("");
  const [isJobSaving, setIsJobSaving] = React.useState(false);
  const [isWorkSiteModalOpen, setIsWorkSiteModalOpen] = React.useState(false);
  const [workSiteModalMode, setWorkSiteModalMode] = React.useState<WorkSiteModalMode>(null);
  const [selectedJobSiteId, setSelectedJobSiteId] = React.useState("");
  const [selectedJobSite, setSelectedJobSite] = React.useState<JobSite | null>(null);
  const [selectedSiteLocation, setSelectedSiteLocation] = React.useState<LocationSelection | null>(null);
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
  const [lifecycleUpdatingJobId, setLifecycleUpdatingJobId] = React.useState<string | null>(null);
  const [jobViewMode, setJobViewMode] = React.useState<JobViewMode>(null);
  const selectedJobRequestRef = React.useRef(0);
  const commissionOrderInFlightRef = React.useRef(false);
  const [commissionRecovery, setCommissionRecovery] = React.useState<{
    orderId: string;
    jobId: string;
    workerProfileId: string;
    status: "PENDING" | "FAILED" | "CANCELLED" | "EXPIRED";
  } | null>(null);

  // Manual Job Creation Form State & Unit Selectors
  const [durationUnit, setDurationUnit] = React.useState<"days" | "months" | "years">("days");
  const [durationInputValue, setDurationInputValue] = React.useState<string>("");
  const [experienceUnit, setExperienceUnit] = React.useState<"years" | "months">("years");
  const [experienceInputValue, setExperienceInputValue] = React.useState<string>("");
  const [newSkillInput, setNewSkillInput] = React.useState<string>("");
  const [formErrors, setFormErrors] = React.useState<Record<string, string>>({});
  const [touchedFields, setTouchedFields] = React.useState<Record<string, boolean>>({});

  const [createJobTab, setCreateJobTab] = React.useState<"ai" | "manual">("ai");
  const [isDraftExpandedMobile, setIsDraftExpandedMobile] = React.useState(true);
  const [hiringConversationId, setHiringConversationId] = React.useState<string | null>(null);
  const [hiringStateRevision, setHiringStateRevision] = React.useState(0);
  const [hiringJobId, setHiringJobId] = React.useState("");
  const [hiringSelectedJobSiteId, setHiringSelectedJobSiteId] = React.useState("");
  const [hiringHistory, setHiringHistory] = React.useState<HiringAgentMessage[]>([
    {
      role: "assistant",
        content: "Tell me what you need help with. I can help plan a job or discuss candidates for a selected job.",
    },
  ]);
  const [hiringCandidates, setHiringCandidates] = React.useState<HiringAgentCandidate[]>([]);
  const [hiringCandidateStatus, setHiringCandidateStatus] = React.useState<HiringAgentConversation["candidate_result_status"]>("NOT_RETRIEVED");
  const [hiringCandidateNote, setHiringCandidateNote] = React.useState<string | null>(null);
  const [hiringCandidateRetrievedAt, setHiringCandidateRetrievedAt] = React.useState<string | null>(null);
  const [hiringJobDraft, setHiringJobDraft] = React.useState<HiringAgentJobDraft>({ required_skills: [] });
  const [hiringJobSiteName, setHiringJobSiteName] = React.useState<string | null>(null);
  const [hiringConfirmationToken, setHiringConfirmationToken] = React.useState<string | null>(null);
  const [hiringCreatedJobId, setHiringCreatedJobId] = React.useState<string | null>(null);
  const [hiringConversationError, setHiringConversationError] = React.useState("");
  const [isHiringConversationLoading, setIsHiringConversationLoading] = React.useState(true);
  const hiringSendInFlightRef = React.useRef(false);
  const hiringMessagesRef = React.useRef<HTMLDivElement | null>(null);

  const jobFormCopy = JOB_FORM_COPY;

  const applyHiringConversation = React.useCallback((data: HiringAgentConversation) => {
    setHiringConversationId(data.conversation_id);
    setHiringJobId(data.job_id || "");
    setHiringStateRevision(data.state_revision);
    setHiringHistory(data.history.length ? data.history : [{
      role: "assistant",
      content: "Tell me what you need help with. I can help plan a job or discuss candidates for a selected job.",
    }]);
    setHiringCandidates(data.candidate_results || []);
    setHiringCandidateStatus(data.candidate_result_status);
    setHiringCandidateNote(data.candidate_result_note || null);
    setHiringCandidateRetrievedAt(data.candidate_retrieved_at || null);
    setHiringJobDraft(data.job_draft || { required_skills: [] });
    setHiringSelectedJobSiteId(data.job_site_id || "");
    setHiringJobSiteName(data.job_site_name || null);
    setHiringConfirmationToken(data.job_confirmation_token || null);
    setHiringCreatedJobId(data.created_job_id || null);
  }, []);

  React.useEffect(() => {
    const messageList = hiringMessagesRef.current;
    if (messageList) {
      messageList.scrollTop = messageList.scrollHeight;
    }
  }, [hiringHistory, isHiringAgentSending]);

  const loadHiringConversation = React.useCallback(async (savedConversationId: string) => {
    setIsHiringConversationLoading(true);
    setHiringConversationError("");
    try {
      const { data } = await apiClient.get<HiringAgentConversation>(
        `/api/v1/jobs/assistant/agent/${encodeURIComponent(savedConversationId)}`,
        { withCredentials: true },
      );
      applyHiringConversation(data);
    } catch (error: unknown) {
      if (isAxiosError(error) && error.response?.status === 404 && user?.id) {
        window.localStorage.removeItem(`gleska_hiring_agent_conversation:${user.id}`);
      }
      setHiringConversationError("Couldn't reload the saved AI Assistant conversation. Your draft is unchanged; retry or start a new conversation.");
    } finally {
      setIsHiringConversationLoading(false);
    }
  }, [applyHiringConversation, user?.id]);

  const restoreHiringConversation = () => {
    const savedConversationId = hiringConversationId || (user?.id
      ? window.localStorage.getItem(`gleska_hiring_agent_conversation:${user.id}`)
      : null);
    if (!savedConversationId) {
      setHiringConversationError("There is no saved conversation to reload.");
      return;
    }
    void loadHiringConversation(savedConversationId);
  };

  React.useEffect(() => {
    if (!user?.id) {
      setIsHiringConversationLoading(false);
      return;
    }
    const savedConversationId = window.localStorage.getItem(`gleska_hiring_agent_conversation:${user.id}`);
    if (!savedConversationId) {
      setIsHiringConversationLoading(false);
      return;
    }
    void loadHiringConversation(savedConversationId);
  }, [user?.id, loadHiringConversation]);

  // Validate manual job form against backend JobCreate rules
  const validateManualJobForm = React.useCallback((
    state: ManualJobFormState,
    dUnit: "days" | "months" | "years",
    eUnit: "years" | "months",
    dRaw: string,
    eRaw: string,
  ): Record<string, string> => {
    const errors: Record<string, string> = {};

    // 1. Job Title (1..120 chars, normalized)
    const trimmedTitle = state.title?.trim();
    if (!trimmedTitle) {
      errors.title = jobFormCopy.titleRequired;
    } else if (trimmedTitle.length > 120) {
      errors.title = jobFormCopy.titleTooLong;
    }

    // 2. Workers Needed (1..1000)
    if (state.headcount_required === null || state.headcount_required === undefined || isNaN(state.headcount_required)) {
      errors.headcount_required = jobFormCopy.workersRequired;
    } else if (state.headcount_required < 1) {
      errors.headcount_required = jobFormCopy.workersMin;
    } else if (state.headcount_required > 1000) {
      errors.headcount_required = jobFormCopy.workersMax;
    }

    // 3. Daily Wage (> 0, <= 1000000)
    if (state.max_daily_salary === null || state.max_daily_salary === undefined || isNaN(state.max_daily_salary)) {
      errors.max_daily_salary = jobFormCopy.wageRequired;
    } else if (state.max_daily_salary <= 0 || state.max_daily_salary > 1000000) {
      errors.max_daily_salary = jobFormCopy.wageValid;
    }

    // 4. Work Duration (1..365 days)
    if (!dRaw.trim() || state.work_duration_days === null || state.work_duration_days === undefined || isNaN(state.work_duration_days)) {
      errors.work_duration_days = jobFormCopy.durationRequired;
    } else if (state.work_duration_days < 1 || state.work_duration_days > 365) {
      errors.work_duration_days = jobFormCopy.durationRange;
    }

    // 5. Daily Timing (1..120 chars)
    const trimmedTiming = state.work_timing?.trim();
    if (!trimmedTiming) {
      errors.work_timing = jobFormCopy.timingRequired;
    }

    // 6. Minimum Experience (0 for fresher, or >= 1 year, <= 50)
    if (!eRaw.trim() || state.min_experience === null || state.min_experience === undefined || isNaN(state.min_experience)) {
      errors.min_experience = jobFormCopy.experienceRequiredErr;
    } else if (state.min_experience < 0 || (state.min_experience > 0 && state.min_experience < 1) || state.min_experience > 50) {
      errors.min_experience = jobFormCopy.experienceRange;
    }

    // 7. Work Site (required UUID)
    if (!state.job_site_id) {
      errors.job_site_id = jobFormCopy.siteRequired;
    }

    return errors;
  }, [jobFormCopy]);

  const currentFormErrors = validateManualJobForm(manualJobState, durationUnit, experienceUnit, durationInputValue, experienceInputValue);
  const isFormReady = Object.keys(currentFormErrors).length === 0;

  // Sync Duration from manualJobState if updated externally
  React.useEffect(() => {
    if (manualJobState.work_duration_days != null) {
      if (manualJobState.work_duration_months != null) {
        setDurationUnit("months");
        setDurationInputValue(String(manualJobState.work_duration_months));
      } else if (manualJobState.work_duration_days >= 365 && manualJobState.work_duration_days % 365 === 0) {
        setDurationUnit("years");
        setDurationInputValue(String(manualJobState.work_duration_days / 365));
      } else if (manualJobState.work_duration_days >= 30 && manualJobState.work_duration_days % 30 === 0) {
        setDurationUnit("months");
        setDurationInputValue(String(manualJobState.work_duration_days / 30));
      } else {
        setDurationUnit("days");
        setDurationInputValue(String(manualJobState.work_duration_days));
      }
    }
  }, [manualJobState.work_duration_days, manualJobState.work_duration_months]);

  // Sync Experience from manualJobState if updated externally
  React.useEffect(() => {
    if (manualJobState.min_experience != null) {
      setExperienceInputValue(String(manualJobState.min_experience));
      setExperienceUnit("years");
    }
  }, [manualJobState.min_experience]);

  const handleDurationChange = (rawVal: string, unit: "days" | "months" | "years") => {
    setDurationInputValue(rawVal);
    const num = parseFloat(rawVal);
    let days: number | null = null;
    let months: number | null = null;

    if (!isNaN(num) && num > 0) {
      if (unit === "days") {
        days = Math.round(num);
      } else if (unit === "months") {
        months = num;
        days = Math.round(num * 30);
      } else if (unit === "years") {
        days = Math.round(num * 365);
      }
    }

    setManualJobState((curr) => ({
      ...curr,
      work_duration_days: days,
      work_duration_months: months,
    }));
  };

  const handleExperienceChange = (rawVal: string, unit: "years" | "months") => {
    setExperienceInputValue(rawVal);
    const num = parseFloat(rawVal);
    let expYears: number | null = null;

    if (!isNaN(num) && num >= 0) {
      if (unit === "years") {
        expYears = num;
      } else if (unit === "months") {
        expYears = num === 0 ? 0 : num / 12;
      }
    }

    setManualJobState((curr) => ({
      ...curr,
      min_experience: expYears,
    }));
  };

  const handleSetFresher = () => {
    setExperienceInputValue("0");
    setExperienceUnit("years");
    setManualJobState((curr) => ({
      ...curr,
      min_experience: 0,
    }));
  };

  const handleAddSkill = (customSkill?: string) => {
    const raw = (customSkill ?? newSkillInput).trim();
    if (!raw) return;
    const currentSkills = manualJobState.required_skills || [];
    if (currentSkills.some((s) => s.toLowerCase() === raw.toLowerCase())) {
      toast.error(jobFormCopy.skillAlreadyAdded);
      return;
    }
    const updatedSkills = [...currentSkills, raw];
    setManualJobState((curr) => ({ ...curr, required_skills: updatedSkills }));
    setNewSkillInput("");
  };

  const handleRemoveSkill = (skillToRemove: string) => {
    const updatedSkills = (manualJobState.required_skills || []).filter((s) => s !== skillToRemove);
    setManualJobState((curr) => ({ ...curr, required_skills: updatedSkills }));
  };

  const handleFieldBlur = (fieldName: string) => {
    setTouchedFields((prev) => ({ ...prev, [fieldName]: true }));
  };

  // Direct manual job creation handler
  const handleCreateJobManual = async () => {
    const errors = validateManualJobForm(manualJobState, durationUnit, experienceUnit, durationInputValue, experienceInputValue);
    setFormErrors(errors);
    setTouchedFields({
      title: true,
      headcount_required: true,
      max_daily_salary: true,
      work_duration_days: true,
      work_timing: true,
      min_experience: true,
      job_site_id: true,
    });

    const errorKeys = Object.keys(errors);
    if (errorKeys.length > 0) {
      const firstKey = errorKeys[0];
      const errorMsg = errors[firstKey];
      toast.error(errorMsg);

      const fieldElement = document.getElementById(`field-${firstKey}`);
      if (fieldElement) {
        fieldElement.scrollIntoView({ behavior: "smooth", block: "center" });
        if (fieldElement instanceof HTMLInputElement || fieldElement instanceof HTMLSelectElement) {
          fieldElement.focus();
        }
      }
      return;
    }

    if (isJobSaving) return;
    setIsJobSaving(true);

    try {
      const payload = {
        job_site_id: manualJobState.job_site_id!,
        title: manualJobState.title!.trim(),
        headcount_required: Number(manualJobState.headcount_required),
        max_daily_salary: Number(manualJobState.max_daily_salary),
        work_duration_days: Number(manualJobState.work_duration_days),
        work_timing: manualJobState.work_timing!.trim(),
        min_experience: Number(manualJobState.min_experience),
        required_skills: manualJobState.required_skills || [],
      };

      const response = await apiClient.post<Job>("/api/v1/jobs", payload, { withCredentials: true });
      setJobs((current) => [response.data, ...current.filter((job) => job.id !== response.data.id)]);

      try {
        const summaryResponse = await apiClient.get<JobMatchSummary[]>('/api/v1/jobs/match-summary', { withCredentials: true });
        setJobMatchSummaries(Object.fromEntries(summaryResponse.data.map((summary) => [summary.job_id, summary])));
        setJobMatchSummaryState("FOUND");
      } catch {
        setJobMatchSummaryState("ERROR");
      }
      void loadAvailableWorkerCount();

      toast.success("Job created successfully!");

      // Reset form state cleanly
      setManualJobState({ required_skills: [] });
      setDurationInputValue("");
      setExperienceInputValue("");
      setNewSkillInput("");
      setTouchedFields({});
      setFormErrors({});
    } catch (err: any) {
      const message = err.response?.data?.detail || "Unable to create job";
      toast.error(message);
    } finally {
      setIsJobSaving(false);
    }
  };

  const scrollToAssistant = () => {
    setIsWorkSiteModalOpen(false);
    setWorkSiteModalMode(null);
    document.getElementById("job-assistant")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const openWorkSiteModal = (mode: Exclude<WorkSiteModalMode, null>) => {
    setSiteError("");
    setSiteLocationNotice("");
    setWorkSiteModalMode(mode);
    setIsWorkSiteModalOpen(true);
  };

  const resetWorkSiteForm = () => {
    siteLocationAcquisitionRef.current?.abort();
    siteLocationAcquisitionRef.current = null;
    setSiteForm({ name: "", address: "", city: "", state: "", pincode: "", latitude: "", longitude: "" });
    setSelectedSiteLocation(null);
    setSiteError("");
    setSiteLocationNotice("");
  };

  const closeWorkSiteModal = () => {
    if (isSiteSaving) return;
    if (workSiteModalMode === "create") resetWorkSiteForm();
    setIsWorkSiteModalOpen(false);
    setWorkSiteModalMode(null);
  };

  const startCreateWorkSite = () => {
    resetWorkSiteForm();
    setWorkSiteModalMode("create");
  };

  const handleOpenJobSiteSelector = () => openWorkSiteModal("site");

  const loadEmployerProfile = React.useCallback(async () => {
    if (!user || user.role !== "EMPLOYER") return;
    try {
      const response = await apiClient.get<EmployerProfile>("/api/v1/employers/me", { withCredentials: true });
      setEmployerProfile(response.data);
    } catch {
      // Existing dashboard loaders remain authoritative for their own errors.
    }
  }, [user]);

  const loadAvailableWorkerCount = React.useCallback(async () => {
    try {
      const response = await apiClient.get<{ count: number; active_count: number }>("/api/v1/employers/me/available-worker-count", { withCredentials: true });
      setAvailableWorkerCount(response.data.count);
      setActiveWorkerCount(response.data.active_count);
    } catch {
      setAvailableWorkerCount(0);
      setActiveWorkerCount(0);
    }
  }, []);

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace("/employer/auth");
    }

    if (!isLoading && user && user.role !== "EMPLOYER") {
      router.replace("/");
    }

    // If onboarding is not complete, redirect to onboarding
    if (!isLoading && user && nextStep !== "DASHBOARD") {
      router.replace("/employer/onboarding");
    }
  }, [user, isLoading, nextStep, router]);

  useEffect(() => {
    if (isLoading || !user || user.role !== "EMPLOYER") return;

    void Promise.resolve().then(loadEmployerProfile);

    void loadAvailableWorkerCount();

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
        try {
          const summaryResponse = await apiClient.get<JobMatchSummary[]>('/api/v1/jobs/match-summary', { withCredentials: true });
          setJobMatchSummaries(Object.fromEntries(summaryResponse.data.map((summary) => [summary.job_id, summary])));
          setJobMatchSummaryState("FOUND");
        } catch {
          setJobMatchSummaries({});
          setJobMatchSummaryState("ERROR");
        }
      } catch (err: any) {
      }
    };

    loadJobs();
  }, [isLoading, loadAvailableWorkerCount, loadEmployerProfile, user]);

  useEffect(() => {
    if (isLoading || !user || user.role !== "EMPLOYER") return;
    window.addEventListener("focus", loadEmployerProfile);
    document.addEventListener("visibilitychange", loadEmployerProfile);
    return () => {
      window.removeEventListener("focus", loadEmployerProfile);
      document.removeEventListener("visibilitychange", loadEmployerProfile);
    };
  }, [isLoading, loadEmployerProfile, user]);

  // Handle return from Cashfree checkout for Individual Commission
  React.useEffect(() => {
    if (isLoading || !user || user.role !== "EMPLOYER") return;
    const urlParams = new URLSearchParams(window.location.search);
    const orderId = urlParams.get("order_id");
    const storedPending = sessionStorage.getItem("gleska_pending_commission");
    if (!storedPending) return;

    let pendingData: { jobId: string; workerProfileId: string; orderId?: string } | null = null;
    try {
      pendingData = JSON.parse(storedPending);
    } catch {
      return;
    }

    if (!pendingData || !pendingData.jobId || !pendingData.workerProfileId || !pendingData.orderId) {
      return;
    }

    if (!orderId) {
      window.setTimeout(() => {
        setCommissionRecovery({
          orderId: pendingData.orderId!,
          jobId: pendingData.jobId!,
          workerProfileId: pendingData.workerProfileId!,
          status: "PENDING",
        });
        setJobViewMode("workers");
        setSelectedJobId(pendingData.jobId!);
      }, 0);
      return;
    }

    if (pendingData.orderId !== orderId) {
      toast.error("Payment return did not match the pending worker selection.", { id: "commission-verify" });
      window.setTimeout(() => {
        setJobMatchesError("Payment return did not match the pending worker selection. The worker was not dispatched.");
      }, 0);
      return;
    }

    const { jobId, workerProfileId } = pendingData;

    const resumeDispatch = async () => {
      // Keep the recovery record until verification and dispatch reach a terminal success.
      const newUrl = window.location.pathname;
      window.history.replaceState({}, document.title, newUrl);

      toast.loading("Verifying commission payment...", { id: "commission-verify" });
      try {
        const verifyRes = await apiClient.post<{ status: string }>(
          `/api/v1/payments/verify/${encodeURIComponent(orderId)}`,
          {},
          { withCredentials: true }
        );

        if (verifyRes.data.status === "SUCCESS") {
          toast.loading("Payment verified! Dispatching worker...", { id: "commission-verify" });
          await dispatchPaidCommission(jobId, workerProfileId);
          sessionStorage.removeItem("gleska_pending_commission");
          setCommissionRecovery(null);
          toast.success("Payment verified and worker dispatched.", { id: "commission-verify" });
        } else if (verifyRes.data.status === "PENDING") {
          setCommissionRecovery({ orderId, jobId, workerProfileId, status: "PENDING" });
          toast.info("Payment is pending confirmation. Return here to retry verification once it completes.", { id: "commission-verify" });
        } else {
          setCommissionRecovery({ orderId, jobId, workerProfileId, status: verifyRes.data.status as "FAILED" | "CANCELLED" | "EXPIRED" });
          toast.error(`Payment ${verifyRes.data.status.toLowerCase()}. Worker was not dispatched.`, { id: "commission-verify" });
        }
      } catch (err: any) {
        const detail = err?.response?.data?.detail;
        setCommissionRecovery({ orderId, jobId, workerProfileId, status: "FAILED" });
        toast.error(typeof detail === "string" ? `${detail}. Retry from this dashboard.` : "Payment verification or dispatch failed. Retry from this dashboard.", { id: "commission-verify" });
      }
    };

    void resumeDispatch();
  }, [isLoading, user]);

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

  const isSiteCoordinatesValid = Boolean(
    selectedSiteLocation
    && selectedSiteLocation.address.trim().length > 0
    && Number.isFinite(selectedSiteLocation.latitude)
    && Number.isFinite(selectedSiteLocation.longitude)
    && selectedSiteLocation.latitude >= -90
    && selectedSiteLocation.latitude <= 90
    && selectedSiteLocation.longitude >= -180
    && selectedSiteLocation.longitude <= 180
    && !(selectedSiteLocation.latitude === 0 && selectedSiteLocation.longitude === 0),
  );
  const canSubmitSite = siteForm.name.trim().length > 0 && isSiteCoordinatesValid;

  const handleSiteSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!siteForm.name.trim() || !selectedSiteLocation || !isSiteCoordinatesValid) {
      const message = !siteForm.name.trim()
        ? "Enter a site name before adding a work site."
        : "Select a valid location before adding a work site.";
      setSiteError(message);
      toast.error(message);
      return;
    }
    const { latitude, longitude } = selectedSiteLocation;

    setIsSiteSaving(true);
    setSiteError("");
    try {
      const response = await apiClient.post<JobSite>("/api/v1/job-sites/", {
        name: siteForm.name.trim(),
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
      setManualJobState((current) => ({ ...current, job_site_id: response.data.id, job_site_name: response.data.name }));
      setSiteForm({ name: "", address: "", city: "", state: "", pincode: "", latitude: "", longitude: "" });
      setSelectedSiteLocation(null);
      setSiteLocationNotice("");
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
    setSiteError("");
    setSiteLocationNotice("");
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

  const selectJobSite = (site: JobSite) => {
    setSelectedJobSiteId(site.id);
    setSelectedJobSite(site);
    setHiringSelectedJobSiteId(site.id);
    setManualJobState((current) => ({
      ...current,
      job_site_id: site.id,
      job_site_name: site.name,
    }));
    setIsWorkSiteModalOpen(false);
    setWorkSiteModalMode(null);
  };

  const useCurrentSiteLocation = async (): Promise<LocationSelection> => {
    const controller = new AbortController();
    siteLocationAcquisitionRef.current?.abort();
    siteLocationAcquisitionRef.current = controller;
    try {
      const coordinates = await watchBrowserLocation({ policy: "ADDRESS", signal: controller.signal });
      let reverseGeocodeFailed = false;
      let location: LocationSelection = {
        address: "",
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        accuracy_m: coordinates.accuracy,
        location_source: "GPS",
      };
      try {
        const response = await apiClient.get<{
          address: string;
          locality?: string | null;
          city?: string | null;
          state?: string | null;
          pincode?: string | null;
        }>("/api/v1/locations/reverse", {
          params: { latitude: coordinates.latitude, longitude: coordinates.longitude },
          signal: controller.signal,
        });
        if (controller.signal.aborted) throw new DOMException("Location request cancelled", "AbortError");
        if (!response.data.address?.trim()) throw new Error("Reverse geocoding returned no address.");
        location = {
          ...location,
          address: response.data.address.trim(),
          locality: response.data.locality || null,
          city: response.data.city || null,
          state: response.data.state || null,
          pincode: response.data.pincode || null,
        };
      } catch (error) {
        if (controller.signal.aborted) throw error;
        reverseGeocodeFailed = true;
      }
      if (controller.signal.aborted) throw new DOMException("Location request cancelled", "AbortError");
      selectSiteLocation(location);
      if (reverseGeocodeFailed) {
        setSiteLocationNotice("Coordinates were obtained, but the address could not be looked up. Enter the site address below.");
      }
      setSiteError("");
      return location;
    } finally {
      if (siteLocationAcquisitionRef.current === controller) siteLocationAcquisitionRef.current = null;
    }
  };

  const invalidateSiteLocation = () => {
    setSelectedSiteLocation(null);
    setSiteLocationNotice("");
    setSiteForm((current) => ({ ...current, city: "", state: "", pincode: "", latitude: "", longitude: "" }));
  };

  const handleSiteLocationQueryChange = (query: string) => {
    invalidateSiteLocation();
    setSiteError("");
    setSiteForm((current) => ({ ...current, address: query }));
  };

  const handleSiteDelete = async (siteId: string) => {
    try {
      await apiClient.delete(`/api/v1/job-sites/${siteId}`, { withCredentials: true });
      setJobSites((current) => current.filter((site) => site.id !== siteId));
      if (selectedJobSiteId === siteId) {
        setSelectedJobSiteId("");
        setSelectedJobSite(null);
        setManualJobState((current) => ({ ...current, job_site_id: null, job_site_name: null }));
      }
      toast.success("Work site removed");
    } catch (err: any) {
      const message = err.response?.data?.detail || "Unable to remove work site";
      setSiteError(message);
      toast.error(message);
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

  const handleCancelJob = async (jobId: string) => {
    if (!window.confirm("Stop searching for workers and cancel this job? Existing matches will no longer be active.")) return;
    setLifecycleUpdatingJobId(jobId);
    try {
      const response = await apiClient.post<Job>(`/api/v1/jobs/${jobId}/cancel`, {}, { withCredentials: true });
      setJobs((current) => current.map((job) => job.id === jobId ? response.data : job));
      if (selectedJob?.id === jobId) setSelectedJob((current) => current ? { ...current, ...response.data } : current);
      const [summaryResponse, jobsResponse] = await Promise.all([
        apiClient.get<JobMatchSummary[]>("/api/v1/jobs/match-summary", { withCredentials: true }),
        apiClient.get<Job[]>("/api/v1/jobs", { withCredentials: true }),
      ]);
      setJobMatchSummaries(Object.fromEntries(summaryResponse.data.map((summary) => [summary.job_id, summary])));
      setJobs(jobsResponse.data);
      toast.success("Job cancelled");
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Unable to cancel this job.");
    } finally {
      setLifecycleUpdatingJobId(null);
    }
  };

  async function dispatchPaidCommission(jobId: string, workerProfileId: string) {
    const response = await apiClient.post<{ match_id: string; worker_profile_id: string; match_status: string; job_status: string; accepted_count: number }>(
      `/api/v1/jobs/${jobId}/matches/accept`,
      { worker_profile_id: workerProfileId },
      { withCredentials: true },
    );

    const requestId = selectedJobRequestRef.current + 1;
    selectedJobRequestRef.current = requestId;
    setJobViewMode("workers");
    setSelectedJobId(jobId);
    setJobMatchesError("");
    setSelectedJob((current) => current && current.id === jobId
      ? { ...current, status: response.data.job_status }
      : current);
    setJobs((current) => current.map((job) => job.id === jobId
      ? { ...job, status: response.data.job_status }
      : job));

    const [jobResult, matchesResult, summaryResult, jobsResult] = await Promise.allSettled([
      apiClient.get<JobDetails>(`/api/v1/jobs/${jobId}`, { withCredentials: true }),
      apiClient.get<JobMatches>(`/api/v1/jobs/${jobId}/matches`, { withCredentials: true }),
      apiClient.get<JobMatchSummary[]>("/api/v1/jobs/match-summary", { withCredentials: true }),
      apiClient.get<Job[]>("/api/v1/jobs", { withCredentials: true }),
    ]);

    if (selectedJobRequestRef.current !== requestId) return;
    if (jobResult.status === "fulfilled") setSelectedJob(jobResult.value.data);
    if (matchesResult.status === "fulfilled") setJobMatches(matchesResult.value.data);
    if (summaryResult.status === "fulfilled") {
      setJobMatchSummaries(Object.fromEntries(summaryResult.value.data.map((summary) => [summary.job_id, summary])));
      setJobMatchSummaryState("FOUND");
    }
    if (jobsResult.status === "fulfilled") setJobs(jobsResult.value.data);
  }

  async function startCommissionPayment(jobId: string, workerProfileId: string) {
    if (commissionOrderInFlightRef.current) return;
    commissionOrderInFlightRef.current = true;
    try {
      const orderRes = await apiClient.post<{ payment_session_id: string; order_id: string }>(
        "/api/v1/payments/employer/create-commission-order",
        { job_id: jobId, worker_profile_id: workerProfileId },
        { withCredentials: true },
      );
      const cashfree = await loadCashfree();
      const mode = process.env.NEXT_PUBLIC_CASHFREE_ENV === "production" ? "production" : "sandbox";
      sessionStorage.setItem("gleska_pending_commission", JSON.stringify({ jobId, workerProfileId, orderId: orderRes.data.order_id }));
      await cashfree({ mode }).checkout({ paymentSessionId: orderRes.data.payment_session_id, redirectTarget: "_self" });
    } finally {
      commissionOrderInFlightRef.current = false;
    }
  }

  const startNewHiringConversation = () => {
    if (hiringSendInFlightRef.current || isHiringConversationLoading) return;
    if (user?.id) {
      window.localStorage.removeItem(`gleska_hiring_agent_conversation:${user.id}`);
    }
    setHiringConversationId(null);
    setHiringStateRevision(0);
    setHiringJobId("");
    setHiringSelectedJobSiteId("");
    setHiringCandidates([]);
    setHiringCandidateStatus("NOT_RETRIEVED");
    setHiringCandidateNote(null);
    setHiringCandidateRetrievedAt(null);
    setHiringJobDraft({ required_skills: [] });
    setHiringJobSiteName(null);
    setHiringConfirmationToken(null);
    setHiringCreatedJobId(null);
    setHiringConversationError("");
    setHiringHistory([{
      role: "assistant",
      content: "Tell me about the job you need or ask me about an existing searching job. I can help prepare a job draft and show current matching candidates.",
    }]);
    setHiringAgentInput("");
  };

  const handleEditExtractedDataInManualForm = () => {
    setManualJobState((prev) => ({
      ...prev,
      title: hiringJobDraft.title || prev.title,
      headcount_required: hiringJobDraft.headcount_required ?? prev.headcount_required,
      max_daily_salary: hiringJobDraft.max_daily_salary ?? prev.max_daily_salary,
      work_duration_days: hiringJobDraft.work_duration_days ?? prev.work_duration_days,
      work_timing: hiringJobDraft.work_timing || prev.work_timing,
      min_experience: hiringJobDraft.min_experience ?? prev.min_experience,
      job_site_id: hiringSelectedJobSiteId || prev.job_site_id,
      job_site_name: hiringJobSiteName || (jobSites.find((site) => site.id === hiringSelectedJobSiteId)?.name) || prev.job_site_name,
      required_skills: (hiringJobDraft.required_skills && hiringJobDraft.required_skills.length > 0)
        ? hiringJobDraft.required_skills
        : prev.required_skills,
    }));
    if (hiringJobDraft.work_duration_days != null) {
      setDurationInputValue(String(hiringJobDraft.work_duration_days));
      setDurationUnit("days");
    }
    if (hiringJobDraft.min_experience != null) {
      setExperienceInputValue(String(hiringJobDraft.min_experience));
      setExperienceUnit("years");
    }
    if (hiringSelectedJobSiteId) {
      setSelectedJobSiteId(hiringSelectedJobSiteId);
      const site = jobSites.find((s) => s.id === hiringSelectedJobSiteId);
      if (site) setSelectedJobSite(site);
    }
    setCreateJobTab("manual");
  };

  const handleSendHiringAgentMessage = async (messageText = hiringAgentInput) => {
    const text = messageText.trim();
    if (!text || hiringSendInFlightRef.current || isHiringConversationLoading) return;
    hiringSendInFlightRef.current = true;
    setHiringAgentInput("");
    setHiringConversationError("");
    setHiringHistory((current) => [...current, { role: "user", content: text }]);
    setIsHiringAgentSending(true);
    try {
      const response = await apiClient.post<HiringAgentConversation>(
        "/api/v1/jobs/assistant/agent/message",
        {
          message: text,
          conversation_id: hiringConversationId,
          job_id: hiringJobId || undefined,
          selected_job_site_id: hiringSelectedJobSiteId || undefined,
          state_revision: hiringConversationId ? hiringStateRevision : undefined,
        },
        { withCredentials: true },
      );
      const data = response.data;
      applyHiringConversation(data);
      if (user?.id) {
        window.localStorage.setItem(
          `gleska_hiring_agent_conversation:${user.id}`,
          data.conversation_id,
        );
      }
    } catch (error: unknown) {
      const detail = isAxiosError<{ detail?: unknown }>(error)
        ? error.response?.data?.detail
        : undefined;
      const stale = detail === "STALE_ASSISTANT_STATE";
      let savedHistory = hiringHistory;
      if (hiringConversationId) {
        try {
          const { data } = await apiClient.get<HiringAgentConversation>(
            `/api/v1/jobs/assistant/agent/${encodeURIComponent(hiringConversationId)}`,
            { withCredentials: true },
          );
          applyHiringConversation(data);
          savedHistory = data.history;
        } catch {
          // Keep the last known history and the unsent text visible if refresh is unavailable.
        }
      }
      setHiringAgentInput(text);
      const recoverableError = stale
        ? "This conversation changed elsewhere. The latest saved state has been loaded; review your message and resend it."
        : isAxiosError(error) && error.response?.status === 402
          ? "Your account needs an active subscription to continue. Your message is preserved in the input."
          : isAxiosError(error) && error.response?.status === 403
            ? "You aren't authorized to use this conversation. Your message is preserved in the input."
            : isAxiosError(error) && error.response?.status === 429
              ? "The AI Assistant is temporarily at its usage limit. Your message is preserved in the input; try again later."
              : "Couldn't reach the AI Assistant. Your message is preserved in the input; retry when the connection is available.";
      setHiringConversationError(recoverableError);
      setHiringHistory([
        ...savedHistory,
        {
          role: "assistant",
          content: recoverableError,
        },
      ]);
    } finally {
      setIsHiringAgentSending(false);
      hiringSendInFlightRef.current = false;
    }
  };

  const handleConfirmHiringJob = async () => {
    if (
      !hiringConversationId
      || !hiringConfirmationToken
      || isJobSaving
      || hiringCreatedJobId
    ) return;

    setIsJobSaving(true);
    setHiringConversationError("");
    try {
      const { data } = await apiClient.post<HiringAgentConversation>(
        "/api/v1/jobs/assistant/agent/create",
        {
          conversation_id: hiringConversationId,
          state_revision: hiringStateRevision,
          confirmation_token: hiringConfirmationToken,
        },
        { withCredentials: true },
      );
      applyHiringConversation(data);
      const [jobsResult, summariesResult] = await Promise.allSettled([
        apiClient.get<Job[]>("/api/v1/jobs", { withCredentials: true }),
        apiClient.get<JobMatchSummary[]>("/api/v1/jobs/match-summary", { withCredentials: true }),
      ]);
      if (jobsResult.status === "fulfilled") setJobs(jobsResult.value.data);
      if (summariesResult.status === "fulfilled") {
        setJobMatchSummaries(Object.fromEntries(summariesResult.value.data.map((summary) => [summary.job_id, summary])));
        setJobMatchSummaryState("FOUND");
      } else {
        setJobMatchSummaryState("ERROR");
      }
      void loadAvailableWorkerCount();
      toast.success("Job created successfully.");
      if (jobsResult.status === "rejected" || summariesResult.status === "rejected") {
        toast.error("The job was created, but some dashboard details could not be refreshed. Reload the dashboard.");
      }
    } catch (error: unknown) {
      const detail = isAxiosError<{ detail?: unknown }>(error)
        ? error.response?.data?.detail
        : undefined;
      setHiringConversationError(
        detail === "STALE_ASSISTANT_STATE"
          ? "The conversation changed before confirmation. Reload the saved conversation and review the draft before trying again."
          : detail === "JOB_CREATED_CONVERSATION_UPDATE_FAILED"
            ? "The job may have been created, but the conversation couldn't be updated. Check your jobs before trying again."
            : isAxiosError(error) && error.response?.status === 402
              ? "Your account needs an active subscription to create this job. The draft is preserved."
              : "Couldn't complete job creation. Reload the saved conversation and check your jobs before trying again.",
      );
      if (hiringConversationId) {
        void loadHiringConversation(hiringConversationId);
      }
    } finally {
      setIsJobSaving(false);
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
      void loadAvailableWorkerCount();
      void loadEmployerProfile();
      toast.success("Worker selected");
    } catch (err: any) {
      if (selectedJobRequestRef.current !== requestId || selectedJobId !== jobId) return;
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail;

      // Individual employer commission required — launch Cashfree checkout
      if (status === 402 && typeof detail === "object" && detail?.code === "COMMISSION_REQUIRED") {
        const { job_id: commissionJobId, worker_profile_id: commissionWorkerId } = detail;
        try {
          await startCommissionPayment(commissionJobId ?? jobId, commissionWorkerId ?? workerProfileId);
        } catch (commErr: any) {
          const commMsg = commErr?.response?.data?.detail;
          setJobMatchesError(typeof commMsg === "string" ? commMsg : "Unable to start commission payment.");
          toast.error(typeof commMsg === "string" ? commMsg : "Unable to start commission payment.");
        }
        return;
      }

      // Business employer subscription required
      if (status === 402 && (typeof detail === "string" && detail.includes("SUBSCRIPTION_REQUIRED"))) {
        toast.error("Active subscription required. Please renew your subscription.");
        setJobMatchesError("Active subscription required. Please renew your subscription.");
        return;
      }

      setJobMatchesError(typeof detail === "string" ? detail : "Unable to select worker right now.");
    } finally {
      setAcceptingWorkerId(null);
    }
  };

  const retryCommissionRecovery = async () => {
    if (!commissionRecovery) return;
    const { orderId, jobId, workerProfileId } = commissionRecovery;
    if (commissionRecovery.status !== "PENDING") {
      try {
        await startCommissionPayment(jobId, workerProfileId);
        setCommissionRecovery(null);
      } catch (err: any) {
        const detail = err?.response?.data?.detail;
        toast.error(typeof detail === "string" ? detail : "Unable to start commission payment.", { id: "commission-verify" });
      }
      return;
    }
    toast.loading("Checking commission payment...", { id: "commission-verify" });
    try {
      const verifyRes = await apiClient.post<{ status: string }>(
        `/api/v1/payments/verify/${encodeURIComponent(orderId)}`,
        {},
        { withCredentials: true },
      );
      if (verifyRes.data.status !== "SUCCESS") {
        setCommissionRecovery({
          orderId,
          jobId,
          workerProfileId,
          status: verifyRes.data.status === "PENDING" ? "PENDING" : verifyRes.data.status as "FAILED" | "CANCELLED" | "EXPIRED",
        });
        toast.info(`Payment is ${verifyRes.data.status.toLowerCase()}.`, { id: "commission-verify" });
        return;
      }

      toast.loading("Payment verified! Dispatching worker...", { id: "commission-verify" });
      await dispatchPaidCommission(jobId, workerProfileId);
      sessionStorage.removeItem("gleska_pending_commission");
      setCommissionRecovery(null);
      toast.success("Payment verified and worker dispatched.", { id: "commission-verify" });
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      setCommissionRecovery({ orderId, jobId, workerProfileId, status: "FAILED" });
      toast.error(typeof detail === "string" ? detail : "Payment verification or dispatch failed. Retry again.", { id: "commission-verify" });
    }
  };

  return (
    <AccountManagementShell
      kind="employer"
      name={employerProfile?.contact_person_name || user.name}
      accountLabel={formatEmployerType(employerProfile?.employer_type)}
      employerType={employerProfile?.employer_type}
      profileHref="/employer/company-profile"
      profilePhotoUrl={displayedProfilePhotoUrl}
      onPostJob={scrollToAssistant}
      onLogout={() => void logout()}
    >
      <div className="flex-1 min-w-0">
        <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
          {/* Welcome Card */}
          <section className="mb-8 rounded-3xl bg-linear-to-br from-blue-50 to-indigo-50 p-5 sm:p-8 dark:from-blue-950/20 dark:to-indigo-950/20 border border-blue-200 dark:border-blue-800">
            <div className="flex flex-col-reverse sm:flex-row items-start sm:items-center justify-between gap-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">
                  Welcome back
                </p>
                <h1 className="mt-1 font-(--font-anton) text-2xl sm:text-4xl uppercase text-slate-900 dark:text-white">
                  {employerProfile?.contact_person_name || user.name}
                </h1>
                <p className="mt-2 text-sm sm:text-base text-blue-700 dark:text-blue-300">
                  {formatEmployerType(employerProfile?.employer_type)}
                </p>
              </div>
              <Link
                href="/employer/company-profile"
                className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-blue-600 text-white shadow-lg"
                title="View profile"
              >
                {displayedProfilePhotoUrl ? (
                  <Image
                    src={displayedProfilePhotoUrl}
                    alt="Employer profile image"
                    width={80}
                    height={80}
                    className="h-full w-full object-cover"
                    unoptimized
                  />
                ) : (
                  <User size={40} />
                )}
              </Link>
            </div>
          </section>

          {/* Summary Cards */}
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {/* Subscription */}
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between">
                <h2 className="font-bold">Subscription</h2>
                <CheckCircle2
                  size={20}
                  className={
                    (employerProfile?.employer_type === "INDIVIDUAL"
                      ? !employerProfile.commission_required_for_next_worker
                      : Boolean(employerProfile?.trial_active || employerProfile?.subscription_active))
                      ? "text-emerald-600"
                      : "text-amber-600"
                  }
                />
              </div>
              {employerProfile?.employer_type === "INDIVIDUAL" ? (
                <>
                  <p className="mt-5 text-xl font-bold text-slate-900 dark:text-white">
                    {employerProfile.commission_required_for_next_worker ? "Commission required for next worker" : "Free-worker entitlement available"}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    {employerProfile.free_workers_used} of {employerProfile.free_worker_limit} free unique workers used
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    {employerProfile.free_workers_remaining > 0
                      ? `${employerProfile.free_workers_remaining} free workers remaining`
                      : `₹${employerProfile.commission_amount} per additional unique worker`}
                  </p>
                </>
              ) : (
                <>
                  <p className="mt-5 text-xl font-bold text-slate-900 dark:text-white">
                    {employerProfile?.trial_active ? "FREE TRIAL ACTIVE" : employerProfile?.subscription_active ? "Active" : employerProfile?.payment_required ? "Payment Required" : "Not Active"}
                  </p>
                  {formatSubscriptionExpiry(employerProfile?.subscription_valid_until) || formatSubscriptionExpiry(employerProfile?.trial_ends_at) ? (
                    <p className="mt-1 text-sm text-slate-500">Active until {formatSubscriptionExpiry(employerProfile?.subscription_valid_until) || formatSubscriptionExpiry(employerProfile?.trial_ends_at)}</p>
                  ) : null}
                  <p className="mt-1 text-sm text-slate-500">Business subscription · ₹2,000 / 30 days</p>
                </>
              )}
            </section>

            {/* Active Jobs Card */}
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between">
                <h2 className="font-bold">Active Jobs</h2>
                <Briefcase size={20} className="text-blue-600" />
              </div>
              <p className="mt-5 text-2xl font-bold text-slate-900 dark:text-white">
                {jobs.filter((job) => !["CANCELLED", "COMPLETED"].includes(job.status)).length}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                {jobs.length === 0 ? "Post a job to get started" : "Active employer jobs"}
              </p>
            </section>

            {/* Available Matches Card */}
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between">
                <h2 className="font-bold">Available matches</h2>
                <Users size={20} className="text-indigo-600" />
              </div>
              <p className="mt-5 text-2xl font-bold text-slate-900 dark:text-white">
                {availableWorkerCount}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                {jobs.length === 0
                  ? "Post a job to see eligible workers"
                  : "Eligible, unselected workers across current jobs"}
              </p>
            </section>
          </div>


          {/* CREATE JOB — UNIFIED TABBED CARD */}
          <div id="job-assistant" className="my-8 sm:my-10 w-full">
            <div className="rounded-3xl border border-slate-200 bg-white shadow-lg dark:border-slate-800 dark:bg-slate-900">

              {/* ── Card Header ───────────────────────────────────────────── */}
              <div className="flex flex-col gap-4 border-b border-slate-100 px-5 pt-5 pb-4 sm:px-6 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">

                {/* Left: title + tabs */}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400">
                      <Briefcase size={20} />
                    </div>
                    <h2 className="font-bold text-slate-900 dark:text-white">{jobFormCopy.createJobTitle}</h2>
                  </div>

                  {/* Tabs */}
                  <div role="tablist" className="flex rounded-xl border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-800">
                    <button
                      role="tab"
                      type="button"
                      aria-selected={createJobTab === "ai"}
                      onClick={() => setCreateJobTab("ai")}
                      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                        createJobTab === "ai"
                          ? "bg-white text-blue-700 shadow-sm dark:bg-slate-700 dark:text-blue-300"
                          : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                      }`}
                    >
                      <Sparkles size={13} />
                      AI Assistant
                    </button>
                    <button
                      role="tab"
                      type="button"
                      aria-selected={createJobTab === "manual"}
                      onClick={() => setCreateJobTab("manual")}
                      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                        createJobTab === "manual"
                          ? "bg-white text-blue-700 shadow-sm dark:bg-slate-700 dark:text-blue-300"
                          : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                      }`}
                    >
                      <Briefcase size={13} />
                      Manual Form
                    </button>
                  </div>
                </div>

                {/* Right: job-site selector + status badge */}
                <div className="flex flex-wrap items-center gap-3">
                  {/* Status badge — shown only on manual tab */}
                  {createJobTab === "manual" && (
                    <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border ${
                      isFormReady
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800"
                        : "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800"
                    }`}>
                      {isFormReady ? jobFormCopy.ready : `${jobFormCopy.incomplete} (${Object.keys(currentFormErrors).length})`}
                    </span>
                  )}

                  {/* Job Site pill */}
                  {createJobTab === "manual" && <button
                    type="button"
                    onClick={handleOpenJobSiteSelector}
                    className="group flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-blue-700 transition hover:bg-blue-100 active:scale-95 cursor-pointer dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-950/60"
                  >
                    <MapPin size={14} className="shrink-0" />
                    <span className="max-w-[140px] truncate text-xs font-semibold">
                      {selectedJobSite?.name || "Select job site"}
                    </span>
                    <ChevronRight size={13} className="shrink-0 opacity-60 group-hover:translate-x-0.5 transition-transform" />
                  </button>}
                </div>
              </div>

              {/* ── Tab Panels ────────────────────────────────────────────── */}

              {/* Conversational Hiring Agent used for AI-assisted job drafting and candidate discovery. */}
              <div
                role="tabpanel"
                hidden={createJobTab !== "ai"}
                className="p-4 sm:p-6"
              >
                <div className="grid min-h-0 items-stretch gap-5 lg:grid-cols-12">
                  <section className="flex h-[440px] sm:h-[480px] lg:h-[500px] min-h-0 flex-col rounded-2xl border border-slate-200 bg-white p-3.5 sm:p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900 lg:col-span-6">
                    {/* Header Toolbar */}
                    <div className="flex flex-none items-center justify-between gap-2.5 border-b border-slate-100 pb-3 dark:border-slate-800">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400">
                          <Sparkles size={16} />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white truncate">
                              AI Assistant
                            </h3>
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                              Active
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 hidden sm:block truncate">
                            Chat naturally to draft jobs and discover matching workers
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {/* Work Site Selector Pill */}
                        <div className="relative flex items-center">
                          <MapPin size={13} className="pointer-events-none absolute left-2.5 text-blue-600 dark:text-blue-400" />
                          <select
                            value={hiringSelectedJobSiteId}
                            disabled={isHiringAgentSending || isHiringConversationLoading}
                            onChange={(event) => {
                              const siteId = event.target.value;
                              setHiringSelectedJobSiteId(siteId);
                              const site = jobSites.find((s) => s.id === siteId);
                              if (site) {
                                setSelectedJobSiteId(site.id);
                                setSelectedJobSite(site);
                                setManualJobState((prev) => ({
                                  ...prev,
                                  job_site_id: site.id,
                                  job_site_name: site.name,
                                }));
                              }
                            }}
                            aria-label="Select Work Site"
                            className="h-8 max-w-[130px] sm:max-w-[190px] truncate rounded-lg border border-slate-200 bg-slate-50 pl-7 pr-6 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 cursor-pointer"
                          >
                            <option value="">Select work site</option>
                            {jobSites.map((site) => (
                              <option key={site.id} value={site.id}>{site.name}</option>
                            ))}
                          </select>
                          <ChevronDown size={12} className="pointer-events-none absolute right-2 text-slate-400" />
                        </div>

                        {/* New conversation button */}
                        <button
                          type="button"
                          onClick={startNewHiringConversation}
                          disabled={isHiringAgentSending || isHiringConversationLoading}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 hover:text-slate-900 active:scale-95 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 cursor-pointer"
                          title="Start new conversation"
                        >
                          <RotateCcw size={12} />
                          <span className="hidden sm:inline">New chat</span>
                        </button>
                      </div>
                    </div>

                    {hiringConversationError && (
                      <div role="alert" className="mt-3 flex-none rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
                        <p>{hiringConversationError}</p>
                        <button
                          type="button"
                          onClick={() => void restoreHiringConversation()}
                          disabled={isHiringConversationLoading || !hiringConversationId}
                          className="mt-1.5 font-semibold underline disabled:opacity-50 cursor-pointer"
                        >
                          Reload saved conversation
                        </button>
                      </div>
                    )}

                    {/* Messages Thread */}
                    <div
                      ref={hiringMessagesRef}
                      className="my-3 min-h-0 flex-1 space-y-3.5 overflow-y-auto overscroll-contain pr-1.5 custom-scrollbar"
                      aria-live="polite"
                    >
                      {hiringHistory.map((message, index) => (
                        <div
                          key={`${index}-${message.role}`}
                          className={`flex ${message.role === "user" ? "justify-end" : "justify-start items-start gap-2.5"}`}
                        >
                          {message.role === "assistant" && (
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400 mt-0.5">
                              <Sparkles size={13} />
                            </div>
                          )}
                          <div
                            className={`max-w-[85%] sm:max-w-[82%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-xs sm:text-sm leading-relaxed ${
                              message.role === "user"
                                ? "rounded-br-xs bg-blue-600 text-white shadow-2xs"
                                : "rounded-bl-xs border border-slate-200/90 bg-slate-50/90 text-slate-800 dark:border-slate-700 dark:bg-slate-800/90 dark:text-slate-200 shadow-2xs"
                            }`}
                          >
                            {message.content}
                          </div>
                        </div>
                      ))}

                      {isHiringAgentSending && (
                        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/40 p-2.5 rounded-xl w-fit">
                          <Loader2 size={14} className="animate-spin text-blue-600" />
                          <span>AI is analyzing requirements...</span>
                        </div>
                      )}
                    </div>

                    {/* Chat Input Bar */}
                    <form
                      className="mt-auto flex flex-none items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void handleSendHiringAgentMessage();
                      }}
                    >
                      <div className="relative flex flex-1 items-center rounded-full border border-slate-200 bg-slate-50/90 p-1 shadow-2xs transition focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800/80">
                        <input
                          value={hiringAgentInput}
                          disabled={isHiringAgentSending || isHiringConversationLoading}
                          onChange={(event) => setHiringAgentInput(event.target.value)}
                          placeholder="Describe a job, workers needed, wage, or timing..."
                          className="w-full bg-transparent px-3.5 py-1.5 text-xs sm:text-sm font-medium text-slate-900 outline-none placeholder:text-slate-400 dark:text-white dark:placeholder:text-slate-500"
                        />
                        <button
                          type="submit"
                          disabled={isHiringAgentSending || isHiringConversationLoading || !hiringAgentInput.trim()}
                          className="flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white shadow-xs transition hover:bg-blue-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
                          aria-label="Send message to AI Assistant"
                        >
                          {isHiringAgentSending ? <Loader2 size={15} className="animate-spin" /> : <ArrowRight size={15} />}
                        </button>
                      </div>
                    </form>
                  </section>

                  {/* Right Column: Live Job Draft Preview & Candidate Matches */}
                  <aside className="flex h-[440px] sm:h-[480px] lg:h-[500px] min-h-0 flex-col justify-between rounded-2xl border border-slate-200 bg-white p-3.5 sm:p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900 lg:col-span-6">
                    <div className="flex flex-none items-center justify-between gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400">
                          <Briefcase size={16} />
                        </div>
                        <div>
                          <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">Job Draft Preview</h3>
                          <p className="text-xs text-slate-500 dark:text-slate-400 hidden sm:block">Live extracted requirements</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {hiringCreatedJobId ? (
                          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800">
                            Created ✓
                          </span>
                        ) : hiringConfirmationToken ? (
                          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800 animate-pulse">
                            Ready to confirm ✨
                          </span>
                        ) : (
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 border border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700">
                            {[
                              Boolean(hiringJobDraft.title),
                              hiringJobDraft.headcount_required != null,
                              hiringJobDraft.max_daily_salary != null,
                              hiringJobDraft.work_duration_days != null,
                              Boolean(hiringJobDraft.work_timing),
                              hiringJobDraft.min_experience != null,
                              Boolean(hiringJobSiteName || hiringSelectedJobSiteId),
                              hiringJobDraft.required_skills && hiringJobDraft.required_skills.length > 0,
                            ].filter(Boolean).length}/8 details
                          </span>
                        )}

                        {/* Mobile toggle button */}
                        <button
                          type="button"
                          onClick={() => setIsDraftExpandedMobile((prev) => !prev)}
                          className="lg:hidden p-1 text-slate-500 hover:text-slate-700 dark:text-slate-400 cursor-pointer"
                          aria-label="Toggle details summary"
                        >
                          {isDraftExpandedMobile ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </button>
                      </div>
                    </div>

                    {/* Detail Rows (Scrollable if needed) */}
                    <div className={`my-2 flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-1 ${isDraftExpandedMobile ? "block" : "hidden lg:block"}`}>
                      <div className="divide-y divide-slate-100 dark:divide-slate-800">
                        {[
                          {
                            label: "Job title",
                            value: hiringJobDraft.title,
                            fallback: "Not specified yet",
                            icon: Briefcase,
                          },
                          {
                            label: "Workers needed",
                            value: hiringJobDraft.headcount_required != null ? `${hiringJobDraft.headcount_required} workers` : null,
                            fallback: "Not specified yet",
                            icon: Users,
                          },
                          {
                            label: "Daily wage",
                            value: hiringJobDraft.max_daily_salary != null ? `₹${hiringJobDraft.max_daily_salary} / day` : null,
                            fallback: "Not specified yet",
                            icon: null,
                            isRupee: true,
                          },
                          {
                            label: "Work duration",
                            value: hiringJobDraft.work_duration_days != null ? `${hiringJobDraft.work_duration_days} days` : null,
                            fallback: "Not specified yet",
                            icon: Calendar,
                          },
                          {
                            label: "Daily working hours",
                            value: hiringJobDraft.work_timing,
                            fallback: "Not specified yet",
                            icon: Clock,
                          },
                          {
                            label: "Minimum experience",
                            value: hiringJobDraft.min_experience != null ? (hiringJobDraft.min_experience === 0 ? "Fresher (0 yrs)" : `${hiringJobDraft.min_experience} yrs`) : null,
                            fallback: "Not specified yet",
                            icon: Award,
                          },
                          {
                            label: "Work site",
                            value: hiringJobSiteName || jobSites.find((site) => site.id === hiringSelectedJobSiteId)?.name,
                            fallback: "Select a work site",
                            icon: MapPin,
                          },
                        ].map((item) => (
                          <div key={item.label} className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.8fr)] items-center gap-3 py-2">
                            <span className="flex items-center gap-2 text-xs sm:text-sm font-semibold text-slate-600 dark:text-slate-300">
                              {item.icon && <item.icon size={15} className="shrink-0 text-slate-400" />}
                              {item.isRupee && <span className="font-bold text-slate-500 text-sm shrink-0">₹</span>}
                              <span className="truncate">{item.label}</span>
                            </span>
                            <span className={`text-right text-xs sm:text-sm truncate ${item.value ? "text-slate-900 dark:text-white font-bold" : "text-slate-400 italic font-normal"}`}>
                              {item.value || item.fallback}
                            </span>
                          </div>
                        ))}

                        {/* Required skills */}
                        <div className="py-2.5">
                          <span className="block text-xs sm:text-sm font-semibold text-slate-600 dark:text-slate-300 mb-1.5">Required skills</span>
                          {hiringJobDraft.required_skills && hiringJobDraft.required_skills.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5">
                              {hiringJobDraft.required_skills.map((skill) => (
                                <span
                                  key={skill}
                                  className="inline-flex items-center rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-300"
                                >
                                  {skill}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs sm:text-sm text-slate-400 italic font-normal">Not specified yet</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Actions pinned at bottom */}
                    <div className="flex-none pt-3 space-y-2 border-t border-slate-100 dark:border-slate-800">
                      {hiringCreatedJobId ? (
                        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-2.5 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200 flex items-center gap-2">
                          <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
                          <span>Job successfully created! (ID: {hiringCreatedJobId})</span>
                        </div>
                      ) : hiringConfirmationToken ? (
                        <button
                          type="button"
                          onClick={() => void handleConfirmHiringJob()}
                          disabled={isJobSaving || isHiringAgentSending || isHiringConversationLoading}
                          className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs sm:text-sm font-bold text-white shadow-md transition hover:bg-blue-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                        >
                          {isJobSaving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                          Confirm &amp; Create Job
                        </button>
                      ) : null}

                      <button
                        type="button"
                        onClick={handleEditExtractedDataInManualForm}
                        className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-2.5 text-xs sm:text-sm font-bold text-slate-700 transition hover:bg-slate-100 hover:text-slate-900 active:scale-95 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 cursor-pointer"
                      >
                        <span>Edit Details in Manual Form</span>
                        <ArrowRight size={14} />
                      </button>
                    </div>

                    {/* Candidate Matches Section (if any retrieved) */}
                    {hiringCandidateStatus !== "NOT_RETRIEVED" && (
                      <section className="mt-5 border-t border-slate-200/80 pt-4 dark:border-slate-800">
                        <div className="flex items-center justify-between gap-3">
                          <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">Candidate matches</h3>
                          {hiringCandidateStatus === "FOUND" && (
                            <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                              Matches found
                            </span>
                          )}
                        </div>
                        {hiringCandidateRetrievedAt && (
                          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                            Updated {new Date(hiringCandidateRetrievedAt).toLocaleTimeString()}
                          </p>
                        )}
                        {hiringCandidateStatus === "NO_MATCHES" && (
                          <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                            No matching workers were found for this job yet.
                          </p>
                        )}
                        {hiringCandidateStatus === "FAILED" && (
                          <p className="mt-3 rounded-xl bg-rose-50 p-3 text-xs text-rose-700 dark:bg-rose-950/30 dark:text-rose-200">
                            Couldn’t retrieve worker matches. Please try again.
                          </p>
                        )}
                        {hiringCandidateNote && (
                          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{hiringCandidateNote}</p>
                        )}
                        {hiringCandidates.length > 0 && (
                          <div className="mt-3 space-y-2.5">
                            {hiringCandidates.map((candidate) => (
                              <article key={candidate.candidate_ref} className="rounded-xl border border-slate-200/80 bg-white p-3 dark:border-slate-700 dark:bg-slate-900 shadow-2xs">
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <h4 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">{candidate.name || candidate.candidate_ref}</h4>
                                    <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">
                                      {candidate.trade || "Trade unavailable"} · {candidate.experience_years == null ? "Experience unavailable" : `${candidate.experience_years} yrs exp`}
                                    </p>
                                  </div>
                                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                    {candidate.availability_status || "Available"}
                                  </span>
                                </div>
                                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                                  {candidate.expected_daily_wage != null && (
                                    <span className="rounded-md bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800 font-medium">
                                      ₹{candidate.expected_daily_wage}/day
                                    </span>
                                  )}
                                  {candidate.projected_distance_m != null && (
                                    <span className="flex items-center gap-1">
                                      <MapPin size={11} />
                                      {(candidate.projected_distance_m / 1000).toFixed(1)} km away
                                    </span>
                                  )}
                                </div>
                                {candidate.skills.length > 0 && (
                                  <div className="mt-2 flex flex-wrap gap-1">
                                    {candidate.skills.map((skill) => (
                                      <span key={skill} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                        {skill}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </article>
                            ))}
                          </div>
                        )}
                      </section>
                    )}
                  </aside>
                </div>
              </div>

              {/* Manual Form tab */}
              <div
                role="tabpanel"
                hidden={createJobTab !== "manual"}
                className="px-5 pb-6 pt-5 sm:px-6"
              >
                <form onSubmit={(e) => { e.preventDefault(); void handleCreateJobManual(); }} className="space-y-6">

                  {/* SECTION 1: JOB DETAILS */}
                  <div className="space-y-4">
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-100 pb-2 dark:border-slate-800">
                      1. {jobFormCopy.jobDetailsTitle}
                    </p>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">

                      {/* Job Title */}
                      <div className="sm:col-span-2 space-y-1">
                        <label htmlFor="field-title" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                          {jobFormCopy.role} <span className="text-rose-500">*</span>
                        </label>
                        <input
                          id="field-title"
                          type="text"
                          value={manualJobState.title || ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            setManualJobState((curr) => ({ ...curr, title: val }));
                            if (touchedFields.title) {
                              const errs = validateManualJobForm({ ...manualJobState, title: val }, durationUnit, experienceUnit, durationInputValue, experienceInputValue);
                              setFormErrors((prev) => ({ ...prev, title: errs.title || "" }));
                            }
                          }}
                          onBlur={() => handleFieldBlur("title")}
                          placeholder={jobFormCopy.rolePlaceholder}
                          className={`w-full rounded-xl border bg-slate-50/50 px-3.5 py-2.5 text-sm font-medium text-slate-900 outline-none transition focus:border-blue-500 focus:bg-white dark:bg-slate-800/50 dark:text-white dark:focus:bg-slate-800 ${
                            touchedFields.title && currentFormErrors.title
                              ? "border-rose-300 bg-rose-50/30 dark:border-rose-800 dark:bg-rose-950/20"
                              : "border-slate-200 dark:border-slate-700"
                          }`}
                        />
                        {touchedFields.title && currentFormErrors.title && (
                          <p className="text-xs font-medium text-rose-500">{currentFormErrors.title}</p>
                        )}
                      </div>

                      {/* Workers Needed */}
                      <div className="space-y-1">
                        <label htmlFor="field-headcount_required" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                          {jobFormCopy.workers} <span className="text-rose-500">*</span>
                        </label>
                        <input
                          id="field-headcount_required"
                          type="number"
                          min="1"
                          max="1000"
                          value={manualJobState.headcount_required ?? ""}
                          onChange={(e) => {
                            const val = e.target.value ? Number(e.target.value) : null;
                            setManualJobState((curr) => ({ ...curr, headcount_required: val }));
                            if (touchedFields.headcount_required) {
                              const errs = validateManualJobForm({ ...manualJobState, headcount_required: val }, durationUnit, experienceUnit, durationInputValue, experienceInputValue);
                              setFormErrors((prev) => ({ ...prev, headcount_required: errs.headcount_required || "" }));
                            }
                          }}
                          onBlur={() => handleFieldBlur("headcount_required")}
                          placeholder={jobFormCopy.workersPlaceholder}
                          className={`w-full rounded-xl border bg-slate-50/50 px-3.5 py-2.5 text-sm font-medium text-slate-900 outline-none transition focus:border-blue-500 focus:bg-white dark:bg-slate-800/50 dark:text-white dark:focus:bg-slate-800 ${
                            touchedFields.headcount_required && currentFormErrors.headcount_required
                              ? "border-rose-300 bg-rose-50/30 dark:border-rose-800 dark:bg-rose-950/20"
                              : "border-slate-200 dark:border-slate-700"
                          }`}
                        />
                        {touchedFields.headcount_required && currentFormErrors.headcount_required && (
                          <p className="text-xs font-medium text-rose-500">{currentFormErrors.headcount_required}</p>
                        )}
                      </div>

                      {/* Daily Wage */}
                      <div className="space-y-1">
                        <label htmlFor="field-max_daily_salary" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                          {jobFormCopy.wage} <span className="text-rose-500">*</span>
                        </label>
                        <div className="relative flex items-center">
                          <span className="absolute left-3 text-sm font-semibold text-slate-500">₹</span>
                          <input
                            id="field-max_daily_salary"
                            type="number"
                            min="1"
                            max="1000000"
                            value={manualJobState.max_daily_salary ?? ""}
                            onChange={(e) => {
                              const val = e.target.value ? Number(e.target.value) : null;
                              setManualJobState((curr) => ({ ...curr, max_daily_salary: val }));
                              if (touchedFields.max_daily_salary) {
                                const errs = validateManualJobForm({ ...manualJobState, max_daily_salary: val }, durationUnit, experienceUnit, durationInputValue, experienceInputValue);
                                setFormErrors((prev) => ({ ...prev, max_daily_salary: errs.max_daily_salary || "" }));
                              }
                            }}
                            onBlur={() => handleFieldBlur("max_daily_salary")}
                            placeholder={jobFormCopy.wagePlaceholder}
                            className={`w-full rounded-xl border bg-slate-50/50 pl-7 pr-14 py-2.5 text-sm font-medium text-slate-900 outline-none transition focus:border-blue-500 focus:bg-white dark:bg-slate-800/50 dark:text-white dark:focus:bg-slate-800 ${
                              touchedFields.max_daily_salary && currentFormErrors.max_daily_salary
                                ? "border-rose-300 bg-rose-50/30 dark:border-rose-800 dark:bg-rose-950/20"
                                : "border-slate-200 dark:border-slate-700"
                            }`}
                          />
                          <span className="absolute right-3 text-xs font-medium text-slate-400">{jobFormCopy.perDay}</span>
                        </div>
                        {touchedFields.max_daily_salary && currentFormErrors.max_daily_salary && (
                          <p className="text-xs font-medium text-rose-500">{currentFormErrors.max_daily_salary}</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* SECTION 2: WORK DETAILS */}
                  <div className="space-y-4">
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-100 pb-2 dark:border-slate-800">
                      2. {jobFormCopy.workDetailsTitle}
                    </p>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">

                      {/* Work Duration */}
                      <div className="space-y-1">
                        <label htmlFor="field-work_duration_days" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                          {jobFormCopy.duration} <span className="text-rose-500">*</span>
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            id="field-work_duration_days"
                            type="number"
                            min="1"
                            value={durationInputValue}
                            onChange={(e) => handleDurationChange(e.target.value, durationUnit)}
                            onBlur={() => handleFieldBlur("work_duration_days")}
                            placeholder={jobFormCopy.durationPlaceholder}
                            className={`flex-1 rounded-xl border bg-slate-50/50 px-3.5 py-2.5 text-sm font-medium text-slate-900 outline-none transition focus:border-blue-500 focus:bg-white dark:bg-slate-800/50 dark:text-white dark:focus:bg-slate-800 ${
                              touchedFields.work_duration_days && currentFormErrors.work_duration_days
                                ? "border-rose-300 bg-rose-50/30 dark:border-rose-800 dark:bg-rose-950/20"
                                : "border-slate-200 dark:border-slate-700"
                            }`}
                          />
                          <select
                            value={durationUnit}
                            onChange={(e) => {
                              const nextUnit = e.target.value as "days" | "months" | "years";
                              setDurationUnit(nextUnit);
                              handleDurationChange(durationInputValue, nextUnit);
                            }}
                            className="rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2.5 text-sm font-semibold text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 cursor-pointer"
                          >
                            <option value="days">{jobFormCopy.unitDays}</option>
                            <option value="months">{jobFormCopy.unitMonths}</option>
                            <option value="years">{jobFormCopy.unitYears}</option>
                          </select>
                        </div>
                        {touchedFields.work_duration_days && currentFormErrors.work_duration_days && (
                          <p className="text-xs font-medium text-rose-500">{currentFormErrors.work_duration_days}</p>
                        )}
                      </div>

                      {/* Daily Timing */}
                      <div className="space-y-1">
                        <label htmlFor="field-work_timing" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                          {jobFormCopy.timing} <span className="text-rose-500">*</span>
                        </label>
                        <input
                          id="field-work_timing"
                          type="text"
                          value={manualJobState.work_timing || ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            setManualJobState((curr) => ({ ...curr, work_timing: val }));
                            if (touchedFields.work_timing) {
                              const errs = validateManualJobForm({ ...manualJobState, work_timing: val }, durationUnit, experienceUnit, durationInputValue, experienceInputValue);
                              setFormErrors((prev) => ({ ...prev, work_timing: errs.work_timing || "" }));
                            }
                          }}
                          onBlur={() => handleFieldBlur("work_timing")}
                          placeholder={jobFormCopy.timingPlaceholder}
                          className={`w-full rounded-xl border bg-slate-50/50 px-3.5 py-2.5 text-sm font-medium text-slate-900 outline-none transition focus:border-blue-500 focus:bg-white dark:bg-slate-800/50 dark:text-white dark:focus:bg-slate-800 ${
                            touchedFields.work_timing && currentFormErrors.work_timing
                              ? "border-rose-300 bg-rose-50/30 dark:border-rose-800 dark:bg-rose-950/20"
                              : "border-slate-200 dark:border-slate-700"
                          }`}
                        />
                        {touchedFields.work_timing && currentFormErrors.work_timing && (
                          <p className="text-xs font-medium text-rose-500">{currentFormErrors.work_timing}</p>
                        )}
                      </div>

                      {/* Min Experience */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <label htmlFor="field-min_experience" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                            {jobFormCopy.experience} <span className="text-rose-500">*</span>
                          </label>
                          <button
                            type="button"
                            onClick={handleSetFresher}
                            className="text-[11px] font-semibold text-blue-600 hover:underline cursor-pointer dark:text-blue-400"
                          >
                            {jobFormCopy.noExperience}
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            id="field-min_experience"
                            type="number"
                            min="0"
                            step="0.5"
                            value={experienceInputValue}
                            onChange={(e) => handleExperienceChange(e.target.value, experienceUnit)}
                            onBlur={() => handleFieldBlur("min_experience")}
                            placeholder={jobFormCopy.experiencePlaceholder}
                            className={`flex-1 rounded-xl border bg-slate-50/50 px-3.5 py-2.5 text-sm font-medium text-slate-900 outline-none transition focus:border-blue-500 focus:bg-white dark:bg-slate-800/50 dark:text-white dark:focus:bg-slate-800 ${
                              touchedFields.min_experience && currentFormErrors.min_experience
                                ? "border-rose-300 bg-rose-50/30 dark:border-rose-800 dark:bg-rose-950/20"
                                : "border-slate-200 dark:border-slate-700"
                            }`}
                          />
                          <select
                            value={experienceUnit}
                            onChange={(e) => {
                              const nextUnit = e.target.value as "years" | "months";
                              setExperienceUnit(nextUnit);
                              handleExperienceChange(experienceInputValue, nextUnit);
                            }}
                            className="rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2.5 text-sm font-semibold text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 cursor-pointer"
                          >
                            <option value="years">{jobFormCopy.unitYears}</option>
                            <option value="months">{jobFormCopy.unitMonths}</option>
                          </select>
                        </div>
                        {touchedFields.min_experience && currentFormErrors.min_experience && (
                          <p className="text-xs font-medium text-rose-500">{currentFormErrors.min_experience}</p>
                        )}
                      </div>

                      {/* Work Site */}
                      <div className="space-y-1">
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                          {jobFormCopy.site} <span className="text-rose-500">*</span>
                        </label>
                        <div
                          id="field-job_site_id"
                          className={`flex items-center justify-between rounded-xl border p-2.5 transition ${
                            manualJobState.job_site_id
                              ? "border-emerald-200 bg-emerald-50/30 dark:border-emerald-900/40 dark:bg-emerald-950/20"
                              : touchedFields.job_site_id && currentFormErrors.job_site_id
                                ? "border-rose-300 bg-rose-50/30 dark:border-rose-800 dark:bg-rose-950/20"
                                : "border-slate-200 bg-slate-50/50 dark:border-slate-700 dark:bg-slate-800/50"
                          }`}
                        >
                          <div className="min-w-0 pr-2">
                            {manualJobState.job_site_id && (manualJobState.job_site_name || selectedJobSite?.name) ? (
                              <div>
                                <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                                  {manualJobState.job_site_name || selectedJobSite?.name}
                                </p>
                                <p className="text-[11px] text-slate-500 truncate">
                                  {selectedJobSite?.address || "Saved location"}
                                </p>
                              </div>
                            ) : (
                              <p className="text-xs font-medium text-slate-400 dark:text-slate-500">
                                {jobFormCopy.notSelected}
                              </p>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={handleOpenJobSiteSelector}
                            className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-bold transition cursor-pointer ${
                              manualJobState.job_site_id
                                ? "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
                                : "bg-blue-600 text-white hover:bg-blue-700 shadow-xs"
                            }`}
                          >
                            {manualJobState.job_site_id ? jobFormCopy.changeSite : jobFormCopy.selectSite}
                          </button>
                        </div>
                        {touchedFields.job_site_id && currentFormErrors.job_site_id && (
                          <p className="text-xs font-medium text-rose-500">{currentFormErrors.job_site_id}</p>
                        )}
                      </div>

                      {/* Required Skills */}
                      <div className="sm:col-span-2 space-y-2">
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                          {jobFormCopy.skills} <span className="text-xs font-normal text-slate-400">({jobFormCopy.optional})</span>
                        </label>
                        <div className="flex flex-wrap gap-1.5 min-h-[36px] rounded-xl border border-slate-200 bg-slate-50/50 p-2 dark:border-slate-700 dark:bg-slate-800/50">
                          {(manualJobState.required_skills && manualJobState.required_skills.length > 0) ? (
                            manualJobState.required_skills.map((skill) => (
                              <span
                                key={skill}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-300"
                              >
                                {skill}
                                <button
                                  type="button"
                                  onClick={() => handleRemoveSkill(skill)}
                                  className="cursor-pointer font-bold leading-none text-blue-400 hover:text-rose-600"
                                  title={jobFormCopy.removeSkill}
                                >
                                  ×
                                </button>
                              </span>
                            ))
                          ) : (
                            <span className="py-0.5 text-xs italic text-slate-400">{jobFormCopy.noSkillsAdded}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={newSkillInput}
                            onChange={(e) => setNewSkillInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                handleAddSkill();
                              }
                            }}
                            placeholder={jobFormCopy.skillsPlaceholder}
                            className="flex-1 rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm font-medium text-slate-900 outline-none transition focus:border-blue-500 focus:bg-white dark:border-slate-700 dark:bg-slate-800/50 dark:text-white dark:focus:bg-slate-800"
                          />
                          <button
                            type="button"
                            onClick={() => handleAddSkill()}
                            className="shrink-0 cursor-pointer rounded-xl bg-slate-100 px-4 py-2.5 text-xs font-bold text-slate-700 transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                          >
                            {jobFormCopy.addSkill}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Submit */}
                  <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
                    <button
                      type="submit"
                      disabled={isJobSaving}
                      className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-bold text-white shadow-md transition hover:bg-blue-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                    >
                      {isJobSaving ? (
                        <>
                          <Loader2 size={18} className="animate-spin" />
                          <span>{jobFormCopy.creating}</span>
                        </>
                      ) : (
                        <>
                          <Plus size={18} />
                          <span>{jobFormCopy.createJobBtn}</span>
                        </>
                      )}
                    </button>
                    {!isFormReady && (
                      <p className="mt-2 text-center text-xs font-medium text-amber-600 dark:text-amber-400">
                        {Object.keys(currentFormErrors).length > 0
                          ? `${jobFormCopy.pleaseComplete} ${Object.values(currentFormErrors)[0]}`
                          : jobFormCopy.complete}
                      </p>
                    )}
                  </div>
                </form>
              </div>

            </div>
          </div>

          <section className="mt-12 scroll-mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4 dark:border-slate-800">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">Created Jobs</h2>
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">{jobs.length}</span>
            </div>
            {jobs.length > 0 && <div className="mt-6 divide-y divide-slate-100 dark:divide-slate-800">
              {jobs.map((job) => {
                const summary = jobMatchSummaries[job.id];
                const matchCount = summary?.current_match_count || 0;
                const acceptedCount = summary?.accepted_count || 0;
                const remainingCount = Math.max(job.headcount_required - acceptedCount, 0);
                const summaryText = job.status === "COMPLETED" || job.status === "CANCELLED"
                  ? jobStatusLabel(job.status)
                  : job.status === "FILLED"
                  ? `${jobStatusLabel(job.status)} · ${acceptedCount} / ${job.headcount_required} selected · ${remainingCount} remaining`
                  : jobMatchSummaryState === "LOADING"
                  ? "Checking suitable workers..."
                  : jobMatchSummaryState === "ERROR"
                    ? "Unable to load match results"
                    : `${jobStatusLabel(job.status)} · ${acceptedCount} / ${job.headcount_required} selected · ${remainingCount} remaining · ${matchCount === 0
                      ? acceptedCount > 0 ? "No additional suitable workers found" : "No suitable workers found yet"
                      : `${matchCount} suitable worker${matchCount === 1 ? "" : "s"} found`}`;
                return (
                  <div key={job.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 py-4">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-slate-900 dark:text-white">{job.title}</p>
                      <p className="text-sm text-slate-500 dark:text-slate-400">{job.headcount_required} worker{job.headcount_required === 1 ? "" : "s"} needed · {jobStatusLabel(job.status)}</p>
                      <p className={`mt-1 text-sm font-semibold ${jobMatchSummaryState === "ERROR" ? "text-rose-600 dark:text-rose-400" : "text-slate-700 dark:text-slate-300"}`}>{summaryText}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {job.status !== "COMPLETED" && job.status !== "CANCELLED" && jobMatchSummaryState === "FOUND" && (matchCount > 0 || acceptedCount > 0) && (
                        <button type="button" onClick={() => void handleViewJobWorkers(job.id)} className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 px-3 py-1.5 sm:py-2 text-xs sm:text-sm font-semibold text-blue-600 hover:border-blue-300 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-400 dark:hover:bg-slate-800 cursor-pointer">
                          <Users size={15} /> View Workers
                        </button>
                      )}
                      {job.status === "SEARCHING" && (
                        <button type="button" onClick={() => void handleCancelJob(job.id)} disabled={lifecycleUpdatingJobId === job.id} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 px-3 py-1.5 sm:py-2 text-xs sm:text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/30 cursor-pointer">
                          {lifecycleUpdatingJobId === job.id ? <Loader2 size={15} className="animate-spin" /> : <X size={15} />} Stop Searching
                        </button>
                      )}
                      <button type="button" onClick={() => void handleViewJobDetails(job.id)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 sm:py-2 text-xs sm:text-sm font-semibold text-blue-600 hover:border-blue-300 hover:bg-blue-50 dark:border-slate-700 dark:text-blue-400 dark:hover:bg-slate-800 cursor-pointer">
                        <Eye size={15} /> View Details
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>}
          </section>

        </main>

      {/* Floating Work Sites Popover/Modal */}
      {isWorkSiteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs transition-opacity"
            onClick={closeWorkSiteModal}
          />
          <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900 z-10">
            <div className="mb-4 flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <MapPin size={22} className="text-blue-600 dark:text-blue-400" />
                <span className="font-(--font-anton) text-xl uppercase tracking-wide text-slate-900 dark:text-white">
                  {workSiteModalMode === "site" ? "Select Job Site" : "Add Work Site"}
                </span>
              </div>
              <button
                type="button"
                onClick={closeWorkSiteModal}
                className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white transition"
                title="Close"
              >
                <X size={20} />
              </button>
            </div>

            {workSiteModalMode === "create" && <form onSubmit={handleSiteSubmit} className="space-y-5">
              <div className="space-y-2">
                <label htmlFor="work-site-name" className="block text-sm font-bold text-slate-800 dark:text-slate-100">Site Name <span className="text-rose-600">*</span></label>
                <input id="work-site-name" required maxLength={160} value={siteForm.name} onChange={(event) => setSiteForm((current) => ({ ...current, name: event.target.value }))} placeholder="Enter work site name" className="w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm outline-hidden focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800" />
              </div>
              <section className="space-y-3" aria-labelledby="work-site-location-label">
                <h3 id="work-site-location-label" className="text-sm font-bold text-slate-800 dark:text-slate-100">Work Site Location <span className="text-rose-600">*</span></h3>
                <LocationPicker
                  label="Search location"
                  value={siteForm.address}
                  onSelect={selectSiteLocation}
                  onQueryChange={handleSiteLocationQueryChange}
                  onUseCurrentLocation={useCurrentSiteLocation}
                  getCurrentLocationErrorMessage={getLocationErrorMessage}
                  currentLocationLoadingLabel="Getting your current location..."
                  showCurrentLocationSeparator
                  clearQueryOnSelect
                  placeholder="Search for an address..."
                />
                {selectedSiteLocation && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 dark:border-emerald-900 dark:bg-emerald-950/20">
                    <p className="text-xs font-bold uppercase tracking-wide text-emerald-800 dark:text-emerald-300">Selected location</p>
                    {selectedSiteLocation.address
                      ? <p className="mt-1 text-sm text-slate-800 dark:text-slate-100">{selectedSiteLocation.address}</p>
                      : <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Address not available</p>}
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{[selectedSiteLocation.city, selectedSiteLocation.state, selectedSiteLocation.pincode].filter(Boolean).join(", ")}</p>
                    {!selectedSiteLocation.address && (
                      <div className="mt-3">
                        <label htmlFor="work-site-address" className="block text-xs font-bold text-slate-700 dark:text-slate-300">Site address</label>
                        <input
                          id="work-site-address"
                          value={siteForm.address}
                          onChange={(event) => {
                            const address = event.target.value;
                            setSiteForm((current) => ({ ...current, address }));
                            setSelectedSiteLocation((current) => current ? { ...current, address } : current);
                          }}
                          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                          placeholder="Enter the site address"
                        />
                      </div>
                    )}
                  </div>
                )}
                {siteLocationNotice && <p role="status" className="text-sm text-amber-700 dark:text-amber-300">{siteLocationNotice}</p>}
              </section>
              {siteError && <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">{siteError}</p>}
              <div className="flex justify-end gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">
                <button type="button" onClick={closeWorkSiteModal} disabled={isSiteSaving} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">Cancel</button>
                <button type="submit" disabled={isSiteSaving || !canSubmitSite} className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
                  {isSiteSaving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                  Add site
                </button>
              </div>
            </form>}

            {workSiteModalMode === "site" && siteError && <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">{siteError}</p>}

            {/* In create mode: display created sites below form with clear section heading */}
            {workSiteModalMode === "create" && jobSites.length > 0 && (
              <div className="mt-6 border-t border-slate-200 dark:border-slate-800 pt-5">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                    Your Created Sites
                  </h3>
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    {jobSites.length}
                  </span>
                </div>
                <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-52 overflow-y-auto pr-1">
                  {jobSites.map((site) => (
                    <div key={site.id} className="flex items-center justify-between gap-4 py-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-900 dark:text-white">{site.name}</p>
                        <p className="truncate text-sm text-slate-500 dark:text-slate-400">{site.address || "Location selected"}</p>
                      </div>
                      <button
                        type="button"
                        title={`Remove ${site.name}`}
                        aria-label={`Remove ${site.name}`}
                        onClick={() => handleSiteDelete(site.id)}
                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:border-rose-200 hover:text-rose-600 dark:border-slate-700 dark:text-slate-400 dark:hover:border-rose-800 dark:hover:text-rose-400"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* In site select mode: display list of created sites with heading and select action */}
            {workSiteModalMode === "site" && (
              <div className="mt-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                    Your Created Sites
                  </h3>
                  {jobSites.length > 0 && (
                    <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {jobSites.length}
                    </span>
                  )}
                </div>
                <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-60 overflow-y-auto pr-1">
                  {isSiteLoading ? (
                    <div className="flex items-center gap-2 py-4 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" /> Loading sites...</div>
                  ) : jobSites.length === 0 ? (
                    <p className="py-4 text-sm text-slate-500 dark:text-slate-400">No work sites saved yet.</p>
                  ) : (
                    jobSites.map((site) => (
                      <div key={site.id} className="flex items-center justify-between gap-4 py-3.5">
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900 dark:text-white">{site.name}</p>
                          <p className="truncate text-sm text-slate-500 dark:text-slate-400">{site.address || "Location selected"}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => selectJobSite(site)}
                          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-bold text-white hover:bg-blue-700 transition"
                        >
                          <Check size={16} /> Select
                        </button>
                      </div>
                    ))
                  )}
                </div>
                <button
                  type="button"
                  onClick={startCreateWorkSite}
                  className="mt-4 inline-flex items-center gap-2 rounded-lg border border-blue-200 px-3 py-2 text-sm font-bold text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-950/40"
                >
                  <Plus size={16} /> Create New Work Site
                </button>
              </div>
            )}
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
              <div><p className="text-xs font-semibold uppercase text-slate-400">Work Duration</p><p className="mt-1 font-semibold">{selectedJob.work_duration_days != null ? `${selectedJob.work_duration_days} days` : "Not specified"}</p></div>
              <div><p className="text-xs font-semibold uppercase text-slate-400">Daily Timing</p><p className="mt-1 font-semibold">{selectedJob.work_timing || "Not specified"}</p></div>
              <div><p className="text-xs font-semibold uppercase text-slate-400">Created</p><p className="mt-1">{new Date(selectedJob.created_at).toLocaleString()}</p></div>
            </div>}
            {jobViewMode === "workers" && <div>
              {(() => {
                const selectedWorkers = jobMatches?.selected_workers || [];
                return <>
              <div className="mb-5 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                <p className="text-xs font-semibold uppercase text-slate-400">Worker progress</p>
                <p className="mt-1 text-lg font-bold text-slate-900 dark:text-white">{jobMatches?.selected_count || 0} / {jobMatches?.headcount_required || selectedJob?.headcount_required || 0} selected</p>
                <p className="text-sm text-slate-500 dark:text-slate-400">{jobMatches?.remaining_count || 0} remaining</p>
              </div>
              {selectedWorkers.length > 0 && <div className="mb-6">
                <h3 className="text-sm font-bold uppercase text-slate-600 dark:text-slate-300">Selected Workers</h3>
                <div className="mt-3 space-y-3">{selectedWorkers.map((match) => (
                  <div key={match.worker_profile_id} className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 dark:border-emerald-900 dark:bg-emerald-950/20">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-900 dark:text-white">{match.name || "Selected worker"}</p>
                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{match.trade_id || "Trade not specified"} · {formatWage(match.expected_daily_wage)}</p>
                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{formatExperience(match.experience_years)}</p>
                      </div>
                      <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">Selected</span>
                    </div>
                  </div>
                ))}</div>
              </div>}
              <h3 className="text-sm font-bold uppercase text-slate-600 dark:text-slate-300">Matching Workers</h3>
              {commissionRecovery && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  <span>{commissionRecovery.status === "PENDING" ? "Commission payment is still pending." : "The commission payment was not completed."}</span>
                  <button type="button" onClick={() => void retryCommissionRecovery()} className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-700">
                    {commissionRecovery.status === "PENDING" ? "Check payment" : "Pay ₹30 again"}
                  </button>
                </div>
              )}
              {isJobMatchesLoading && <div className="mt-3 flex items-center gap-2 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" /> Matching workers...</div>}
              {!isJobMatchesLoading && jobMatchesError && <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">{jobMatchesError}</p>}
              {!isJobMatchesLoading && !jobMatchesError && jobMatches?.matches.length === 0 && <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">{jobMatches.selected_count > 0 ? "No additional suitable workers found." : "No suitable workers found yet."}</p>}
              {!isJobMatchesLoading && !jobMatchesError && jobMatches?.matches.length ? <div className="mt-3 space-y-3">{jobMatches.matches.map((match) => (
                <div key={match.worker_profile_id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                  <p className="font-semibold text-slate-900 dark:text-white">{match.name || "Matched worker"}</p>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{formatExperience(match.experience_years)} · {formatWage(match.expected_daily_wage)}</p>
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
                </>;
              })()}
            </div>}
          </section>
        </div>
      )}
      </div>
    </AccountManagementShell>
  );
}
