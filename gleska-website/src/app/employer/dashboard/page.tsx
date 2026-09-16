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
  CreditCard,
  HelpCircle,
  Loader2,
  MapPin,
  Plus,
  Trash2,
  PanelLeft,
  LayoutDashboard,
  ShieldCheck,
  User,
  X,
  Mic,
  ArrowRight,
  ChevronRight,
  Eye,
  Sparkles,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import apiClient from "@/lib/api";
import { formatSubscriptionExpiry, isSubscriptionActive } from "@/lib/subscription";
import { getBrowserLocation, getLocationErrorMessage, InaccurateLocationError } from "@/lib/location";

import LocationPicker, { LocationSelection } from "@/components/LocationPicker";
import VoiceMicIcon from "@/components/ui/VoiceMicIcon";
import { formatEmployerType } from "@/components/AccountManagementShell";

/**
 * Supported languages for job description input.
 * Mapped to browser Web Speech Recognition language codes.
 */
type AssistantLanguage = "EN" | "HI" | "MR" | "TA" | "HINGLISH";

const SUPPORTED_LANGUAGES: Record<AssistantLanguage, { label: string; speechCode: string }> = {
  MR: { label: "Marathi", speechCode: "mr-IN" },
  HI: { label: "Hindi", speechCode: "hi-IN" },
  TA: { label: "Tamil", speechCode: "ta-IN" },
  EN: { label: "English", speechCode: "en-IN" },
  HINGLISH: { label: "Hinglish", speechCode: "en-IN" },
};

const LANGUAGE_OPTIONS = Object.entries(SUPPORTED_LANGUAGES) as [AssistantLanguage, { label: string; speechCode: string }][];
const DEFAULT_LANGUAGE: AssistantLanguage = "EN";

const ASSISTANT_COPY: Record<AssistantLanguage, Record<string, string>> = {
  EN: {
    welcome: "Hello! Tell me about the job you want to create. For example: 5 cooks for 20 days, ₹700 per day, 8 AM to 5 PM.",
    heading: "AI Job Creation Assistant", subtitle: "Speak or type requirements naturally", listening: "Listening...", speak: "Speak requirement",
    thinking: "Understanding requirements & validating...", placeholder: "e.g. 5 cooks for 20 days, ₹700/day, 8 AM to 5 PM", preview: "Structured Job Preview",
    ready: "Ready to create", incomplete: "Incomplete", role: "Role / Title", workers: "Workers Needed", site: "Work Site", wage: "Daily Wage", duration: "Work Duration", timing: "Daily Timing", experience: "Min Experience", missing: "Missing", required: "Required", selectSite: "Select site", years: "years", year: "year", days: "days", create: "Confirm & Create Job", creating: "Creating job...", complete: "Complete all requirements to create job", languageChanged: "Language changed. Please continue with your requirements in English.", error: "Sorry, I encountered an issue. Please try again.", voiceUnsupported: "Speech recognition is not supported in this browser. Please type your description instead.", noSpeech: "No speech was captured. Please try again.", micDenied: "Microphone permission was denied. Please allow microphone access and try again.", noDetected: "No speech was detected. Please try again.", voiceFailed: "Could not capture voice input. Please try again.",
  },
  HI: {
    welcome: "नमस्ते! आप जो नौकरी बनाना चाहते हैं, उसके बारे में बताएं। उदाहरण: 20 दिनों के लिए 5 कुक, ₹700 रोज़, सुबह 8 बजे से शाम 5 बजे तक।",
    heading: "एआई नौकरी निर्माण सहायक", subtitle: "अपनी ज़रूरतें स्वाभाविक रूप से बोलें या लिखें", listening: "सुन रहा है...", speak: "ज़रूरत बताएं",
    thinking: "जानकारी समझी और जांची जा रही है...", placeholder: "उदाहरण: 20 दिनों के लिए 5 कुक, ₹700 रोज़, सुबह 8 से शाम 5 बजे तक", preview: "नौकरी का विवरण", ready: "बनाने के लिए तैयार", incomplete: "अपूर्ण", role: "भूमिका / पद", workers: "आवश्यक कामगार", site: "कार्य स्थल", wage: "दैनिक वेतन", duration: "काम की अवधि", timing: "दैनिक समय", experience: "न्यूनतम अनुभव", missing: "आवश्यक", required: "आवश्यक", selectSite: "स्थान चुनें", years: "वर्ष", year: "वर्ष", days: "दिन", create: "पुष्टि करें और नौकरी बनाएं", creating: "नौकरी बनाई जा रही है...", complete: "नौकरी बनाने के लिए सभी जानकारी पूरी करें", languageChanged: "भाषा बदल दी गई है। कृपया अपनी ज़रूरतें हिंदी में बताना जारी रखें।", error: "माफ़ कीजिए, एक समस्या आई। कृपया फिर से कोशिश करें।", voiceUnsupported: "इस ब्राउज़र में आवाज़ पहचान उपलब्ध नहीं है। कृपया अपनी जानकारी लिखें।", noSpeech: "आवाज़ नहीं मिली। कृपया फिर से कोशिश करें।", micDenied: "माइक्रोफ़ोन की अनुमति नहीं मिली। कृपया अनुमति देकर फिर से कोशिश करें।", noDetected: "आवाज़ पहचानी नहीं गई। कृपया फिर से कोशिश करें।", voiceFailed: "आवाज़ दर्ज नहीं हो सकी। कृपया फिर से कोशिश करें।",
  },
  MR: {
    welcome: "नमस्कार! तुम्हाला तयार करायच्या नोकरीबद्दल सांगा. उदाहरण: 20 दिवसांसाठी 5 स्वयंपाकी, ₹700 रोज, सकाळी 8 ते संध्याकाळी 5.", heading: "एआय नोकरी निर्मिती सहाय्यक", subtitle: "तुमच्या गरजा सहज बोला किंवा टाइप करा", listening: "ऐकत आहे...", speak: "गरज सांगा", thinking: "गरजा समजून तपासल्या जात आहेत...", placeholder: "उदाहरण: 20 दिवसांसाठी 5 स्वयंपाकी, ₹700 रोज", preview: "नोकरीचा तपशील", ready: "तयार आहे", incomplete: "अपूर्ण", role: "भूमिका / पद", workers: "आवश्यक कामगार", site: "कामाचे ठिकाण", wage: "दैनिक वेतन", duration: "कामाचा कालावधी", timing: "दररोजची वेळ", experience: "किमान अनुभव", missing: "आवश्यक", required: "आवश्यक", selectSite: "ठिकाण निवडा", years: "वर्षे", year: "वर्ष", days: "दिवस", create: "पुष्टी करा आणि नोकरी तयार करा", creating: "नोकरी तयार होत आहे...", complete: "नोकरी तयार करण्यासाठी सर्व माहिती पूर्ण करा", languageChanged: "भाषा बदलली आहे. कृपया मराठीत तुमच्या गरजा सांगा.", error: "माफ करा, एक समस्या आली. कृपया पुन्हा प्रयत्न करा.", voiceUnsupported: "या ब्राउझरमध्ये आवाज ओळख उपलब्ध नाही. कृपया टाइप करा.", noSpeech: "आवाज मिळाला नाही. कृपया पुन्हा प्रयत्न करा.", micDenied: "मायक्रोफोनची परवानगी नाकारली. कृपया परवानगी द्या.", noDetected: "आवाज ओळखला गेला नाही. कृपया पुन्हा प्रयत्न करा.", voiceFailed: "आवाज नोंदवता आला नाही. कृपया पुन्हा प्रयत्न करा.",
  },
  TA: {
    welcome: "வணக்கம்! நீங்கள் உருவாக்க விரும்பும் வேலை பற்றி சொல்லுங்கள். உதாரணம்: 20 நாட்களுக்கு 5 சமையல்காரர்கள், தினசரி ₹700, காலை 8 முதல் மாலை 5 வரை.", heading: "AI வேலை உருவாக்க உதவியாளர்", subtitle: "உங்கள் தேவைகளை இயல்பாகப் பேசவும் அல்லது தட்டச்சு செய்யவும்", listening: "கேட்கிறது...", speak: "தேவையைச் சொல்லுங்கள்", thinking: "தேவைகள் புரிந்துகொள்ளப்பட்டு சரிபார்க்கப்படுகின்றன...", placeholder: "உதாரணம்: 20 நாட்களுக்கு 5 சமையல்காரர்கள், தினசரி ₹700", preview: "வேலை விவரம்", ready: "உருவாக்கத் தயார்", incomplete: "முழுமையில்லை", role: "பங்கு / பதவி", workers: "தேவையான தொழிலாளர்கள்", site: "வேலை இடம்", wage: "தினசரி ஊதியம்", duration: "வேலை காலம்", timing: "தினசரி நேரம்", experience: "குறைந்தபட்ச அனுபவம்", missing: "தேவை", required: "தேவை", selectSite: "இடத்தைத் தேர்ந்தெடுக்கவும்", years: "ஆண்டுகள்", year: "ஆண்டு", days: "நாட்கள்", create: "உறுதிசெய்து வேலையை உருவாக்கவும்", creating: "வேலை உருவாக்கப்படுகிறது...", complete: "வேலையை உருவாக்க அனைத்து தகவல்களையும் நிரப்பவும்", languageChanged: "மொழி மாற்றப்பட்டது. தமிழில் உங்கள் தேவைகளைத் தொடரவும்.", error: "மன்னிக்கவும், ஒரு சிக்கல் ஏற்பட்டது. மீண்டும் முயற்சிக்கவும்.", voiceUnsupported: "இந்த உலாவியில் குரல் அறிதல் இல்லை. தயவுசெய்து தட்டச்சு செய்யவும்.", noSpeech: "குரல் பதிவு செய்யப்படவில்லை. மீண்டும் முயற்சிக்கவும்.", micDenied: "மைக்ரோஃபோன் அனுமதி மறுக்கப்பட்டது. அனுமதி அளித்து மீண்டும் முயற்சிக்கவும்.", noDetected: "குரல் கண்டறியப்படவில்லை. மீண்டும் முயற்சிக்கவும்.", voiceFailed: "குரலைப் பதிவு செய்ய முடியவில்லை. மீண்டும் முயற்சிக்கவும்.",
  },
  HINGLISH: {
    welcome: "Namaste! Aap jo job banana chahte hain uske baare mein batayein. Example: 20 din ke liye 5 cooks, ₹700 per day, subah 8 se shaam 5.", heading: "AI Job Creation Assistant", subtitle: "Requirements naturally bolen ya type karein", listening: "Sun raha hoon...", speak: "Requirement bolen", thinking: "Requirements samajhkar validate kar raha hoon...", placeholder: "Example: 20 din ke liye 5 cooks, ₹700/day, subah 8 se shaam 5", preview: "Job Preview", ready: "Banane ke liye ready", incomplete: "Incomplete", role: "Role / Title", workers: "Required Workers", site: "Work Site", wage: "Daily Wage", duration: "Work Duration", timing: "Daily Timing", experience: "Minimum Experience", missing: "Required", required: "Required", selectSite: "Site select karein", years: "years", year: "year", days: "days", create: "Confirm karke Job Banayein", creating: "Job ban rahi hai...", complete: "Job banane ke liye saari requirements complete karein", languageChanged: "Language change ho gayi hai. Ab Hinglish mein requirements batayein.", error: "Sorry, ek problem aayi. Please dobara try karein.", voiceUnsupported: "Is browser mein speech recognition supported nahi hai. Please type karein.", noSpeech: "Speech capture nahi hui. Please dobara try karein.", micDenied: "Microphone permission deny hui. Please permission allow karein.", noDetected: "Speech detect nahi hui. Please dobara try karein.", voiceFailed: "Voice input capture nahi ho saka. Please dobara try karein.",
  },
};

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
  work_duration_days?: number | null;
  work_timing?: string | null;
  status: string;
  created_at: string;
  updated_at?: string | null;
}

interface AssistantMessage {
  id: string;
  sender: "user" | "assistant";
  text: string;
  timestamp: string;
}

interface AssistantJobState {
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
type WorkSiteModalMode = "location" | "site" | "create" | null;
type EmployerMenuIcon = React.ComponentType<{ size?: number; className?: string }>;

interface JobMatchSummary {
  job_id: string;
  current_match_count: number;
  accepted_count: number;
  matching_status: "FOUND" | "NO_MATCHES";
}

function EmployerProfileMenuItems({
  employerType,
  onNavigate,
  onLogout,
}: {
  employerType?: string | null;
  onNavigate: () => void;
  onLogout: () => void;
}) {
  const profileItems: { label: string; href: string; icon: EmployerMenuIcon }[] = employerType === "INDIVIDUAL"
    ? [{ label: "Individual Profile", href: "/employer/company-profile", icon: User }]
    : employerType === "UNREGISTERED_BUSINESS"
      ? [
          { label: "Business Profile", href: "/employer/company-profile", icon: Building2 },
          { label: "Proprietor Profile", href: "/employer/director-profile", icon: User },
        ]
      : [
          { label: "Company Profile", href: "/employer/company-profile", icon: Building2 },
          { label: "Director Profile", href: "/employer/director-profile", icon: User },
        ];

  return (
    <div className="space-y-0.5">
      {profileItems.map(({ label, href, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          onClick={onNavigate}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <Icon size={17} className="shrink-0 text-slate-500 dark:text-slate-400" />
          <span>{label}</span>
        </Link>
      ))}
      <button
        type="button"
        onClick={onLogout}
        className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
      >
        <LogOut size={17} className="shrink-0" />
        <span>Log out</span>
      </button>
    </div>
  );
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
  const [assistantMessages, setAssistantMessages] = React.useState<AssistantMessage[]>([
    {
      id: "welcome",
      sender: "assistant",
      text: ASSISTANT_COPY.EN.welcome,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    },
  ]);
  const [conversationId, setConversationId] = React.useState<string | null>(null);
  const [assistantState, setAssistantState] = React.useState<AssistantJobState>({ required_skills: [] });
  const [missingFields, setMissingFields] = React.useState<string[]>([]);
  const [assistantValidationErrors, setAssistantValidationErrors] = React.useState<string[]>([]);
  const [readyToCreate, setReadyToCreate] = React.useState(false);
  const [assistantConfirmationToken, setAssistantConfirmationToken] = React.useState<string | null>(null);
  const [isAssistantSending, setIsAssistantSending] = React.useState(false);
  const [assistantInput, setAssistantInput] = React.useState("");
  const [isJobSaving, setIsJobSaving] = React.useState(false);
  const [selectedAssistantLanguage, setSelectedAssistantLanguage] = React.useState<AssistantLanguage>(DEFAULT_LANGUAGE);
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

  const assistantCopy = ASSISTANT_COPY[selectedAssistantLanguage];

  const handleAssistantLanguageChange = (language: AssistantLanguage) => {
    setSelectedAssistantLanguage(language);
    setAssistantMessages((current) => [
      ...current,
      {
        id: `language-${Date.now()}`,
        sender: "assistant",
        text: ASSISTANT_COPY[language].languageChanged,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      },
    ]);
  };

  const scrollToAssistant = () => {
    setIsWorkSiteModalOpen(false);
    setWorkSiteModalMode(null);
    document.getElementById("job-assistant")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const openWorkSiteModal = (mode: Exclude<WorkSiteModalMode, null>) => {
    setSiteError("");
    setWorkSiteModalMode(mode);
    setIsWorkSiteModalOpen(true);
  };

  const handleOpenJobLocationPicker = () => openWorkSiteModal("location");
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

    void Promise.resolve().then(loadEmployerProfile);

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
  }, [isLoading, loadEmployerProfile, user]);

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

  const handleVoiceInput = React.useCallback(() => {
    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      setVoiceError(assistantCopy.voiceUnsupported);
      return;
    }

    if (speechRecognitionRef.current) {
      speechRecognitionRef.current.stop();
      speechRecognitionRef.current = null;
      setIsListening(false);
      return;
    }

    const recognition = new SpeechRecognitionCtor() as SpeechRecognitionLike;
    recognition.lang = SUPPORTED_LANGUAGES[selectedAssistantLanguage].speechCode;
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
        setVoiceError(assistantCopy.noSpeech);
        setIsListening(false);
        return;
      }

      setAssistantInput(transcript);
      setVoiceError("");
      setIsListening(false);
      void handleSendAssistantMessage(transcript);
    };

    recognition.onerror = (event: any) => {
      const code = event?.error ?? "unknown";
      const friendlyMessage =
        code === "not-allowed"
          ? assistantCopy.micDenied
          : code === "no-speech"
            ? assistantCopy.noDetected
            : code === "not-supported"
              ? assistantCopy.voiceUnsupported
              : assistantCopy.voiceFailed;
      setVoiceError(friendlyMessage);
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
      speechRecognitionRef.current = null;
    };

    speechRecognitionRef.current = recognition;
    recognition.start();
  }, [assistantCopy, selectedAssistantLanguage]);

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
      setAssistantState((current) => ({ ...current, job_site_id: response.data.id, job_site_name: response.data.name }));
      setReadyToCreate(false);
      setAssistantConfirmationToken(null);
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
    setAssistantState((current) => ({
      ...current,
      job_site_id: site.id,
      job_site_name: site.name,
    }));
    setReadyToCreate(false);
    setAssistantConfirmationToken(null);
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

  const handleSiteDelete = async (siteId: string) => {
    try {
      await apiClient.delete(`/api/v1/job-sites/${siteId}`, { withCredentials: true });
      setJobSites((current) => current.filter((site) => site.id !== siteId));
      if (selectedJobSiteId === siteId) {
        setSelectedJobSiteId("");
        setSelectedJobSite(null);
        setAssistantState((current) => ({ ...current, job_site_id: null, job_site_name: null }));
      }
      toast.success("Work site removed");
    } catch (err: any) {
      const message = err.response?.data?.detail || "Unable to remove work site";
      setSiteError(message);
      toast.error(message);
    }
  };

  const handleSendAssistantMessage = async (messageText?: string) => {
    const text = (messageText !== undefined ? messageText : assistantInput).trim();
    if (!text || isAssistantSending) return;

    setAssistantInput("");
    const userMsgId = Date.now().toString();
    const timeNow = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    setAssistantMessages((prev) => [
      ...prev,
      { id: userMsgId, sender: "user", text, timestamp: timeNow },
    ]);
    setIsAssistantSending(true);

    try {
      const res = await apiClient.post<{
        conversation_id: string;
        assistant_message: string;
        structured_state: AssistantJobState;
        missing_fields: string[];
        validation_errors: string[];
        ready_to_create: boolean;
        confirmation_token?: string | null;
      }>("/api/v1/jobs/assistant/message", {
        message: text,
        language: selectedAssistantLanguage,
        conversation_id: conversationId,
        selected_job_site_id: selectedJobSiteId || undefined,
      }, { withCredentials: true });

      setConversationId(res.data.conversation_id);
      setAssistantState(res.data.structured_state);
      setMissingFields(res.data.missing_fields || []);
      setAssistantValidationErrors(res.data.validation_errors || []);
      setReadyToCreate(res.data.ready_to_create);
      setAssistantConfirmationToken(res.data.confirmation_token || null);

      if (res.data.structured_state.job_site_id) {
        setSelectedJobSiteId(res.data.structured_state.job_site_id);
        const site = jobSites.find((s) => s.id === res.data.structured_state.job_site_id) || null;
        setSelectedJobSite(site);
      }

      setAssistantMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          sender: "assistant",
          text: res.data.assistant_message,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
    } catch (err: any) {
      const errorMsg = err.response?.data?.detail || assistantCopy.error;
      setAssistantMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          sender: "assistant",
          text: typeof errorMsg === "string" ? errorMsg : assistantCopy.error,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
    } finally {
      setIsAssistantSending(false);
    }
  };

  const handleCreateJobFromAssistant = async () => {
    if (!readyToCreate || !conversationId || !assistantConfirmationToken || isJobSaving) return;

    setIsJobSaving(true);
    try {
      const response = await apiClient.post<Job>("/api/v1/jobs/assistant/create", {
        conversation_id: conversationId,
        confirmation_token: assistantConfirmationToken,
      }, { withCredentials: true });
      setJobs((current) => [response.data, ...current.filter((job) => job.id !== response.data.id)]);
      try {
        const summaryResponse = await apiClient.get<JobMatchSummary[]>('/api/v1/jobs/match-summary', { withCredentials: true });
        setJobMatchSummaries(Object.fromEntries(summaryResponse.data.map((summary) => [summary.job_id, summary])));
        setJobMatchSummaryState("FOUND");
      } catch {
        setJobMatchSummaryState("ERROR");
      }

      toast.success("Job created successfully!");
      setAssistantMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 2).toString(),
          sender: "assistant",
          text: `Job ${response.data.title} has been successfully created and published!`,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
      setReadyToCreate(false);
      setAssistantConfirmationToken(null);
    } catch (err: any) {
      const message = err.response?.data?.detail || "Unable to create job";
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
              onClick={scrollToAssistant}
              className={`flex items-center gap-3 w-full rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white transition ${
                isSidebarOpen ? "text-left" : "justify-center"
              }`}
              title="Post a Job & Sites"
            >
              <Briefcase size={20} className="shrink-0" />
              {isSidebarOpen && <span>Post a Job & Sites</span>}
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

            <Link
              href="/employer/subscription"
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white transition ${
                isSidebarOpen ? "" : "justify-center"
              }`}
              title="Subscription"
            >
              <CreditCard size={20} className="shrink-0" />
              {isSidebarOpen && <span>Subscription</span>}
            </Link>

            <Link
              href="/employer/security"
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white transition ${
                isSidebarOpen ? "" : "justify-center"
              }`}
              title="Security & Settings"
            >
              <ShieldCheck size={20} className="shrink-0" />
              {isSidebarOpen && <span>Security & Settings</span>}
            </Link>

            <Link
              href="/employer/help"
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white transition ${
                isSidebarOpen ? "" : "justify-center"
              }`}
              title="Help"
            >
              <HelpCircle size={20} className="shrink-0" />
              {isSidebarOpen && <span>Help</span>}
            </Link>

          </nav>
        </div>

        {/* Sidebar Bottom: identity account menu and logout */}
        <div className="relative border-t border-slate-200 pt-4 dark:border-slate-800">
          <button
            type="button"
            onClick={() => setIsProfileMenuOpen((open) => !open)}
            className={`mb-3 flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-slate-100 dark:hover:bg-slate-800 ${isSidebarOpen ? "" : "justify-center"}`}
            title="Open account menu"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-sm font-bold text-white shadow-xs">
              {(employerProfile?.contact_person_name || user?.name || "E").charAt(0).toUpperCase()}
            </div>
            {isSidebarOpen && (
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-slate-900 dark:text-white">{employerProfile?.contact_person_name || user?.name}</p>
                <p className="truncate text-xs text-slate-500 dark:text-slate-400">{formatEmployerType(employerProfile?.employer_type)}</p>
              </div>
            )}
          </button>
          {isProfileMenuOpen && (
            <div className="absolute bottom-full left-0 right-0 z-50 mb-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-800 dark:bg-slate-900">
              <EmployerProfileMenuItems employerType={employerProfile?.employer_type} onNavigate={() => setIsProfileMenuOpen(false)} onLogout={() => { setIsProfileMenuOpen(false); void handleLogout(); }} />
            </div>
          )}
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
                    scrollToAssistant();
                  }}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                >
                  <Briefcase size={20} />
                  <span>Post a Job & Sites</span>
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
                <Link
                  href="/employer/subscription"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                >
                  <CreditCard size={20} />
                  <span>Subscription</span>
                </Link>
                <Link
                  href="/employer/security"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                >
                  <ShieldCheck size={20} />
                  <span>Security & Settings</span>
                </Link>
                <Link
                  href="/employer/help"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                >
                  <HelpCircle size={20} />
                  <span>Help</span>
                </Link>

              </nav>
            </div>

            <div className="relative border-t border-slate-200 pt-4 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setIsProfileMenuOpen((open) => !open)}
                className="mb-3 flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-slate-100 dark:hover:bg-slate-800"
                title="Open account menu"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-sm font-bold text-white shadow-xs">
                  {(employerProfile?.contact_person_name || user?.name || "E").charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-slate-900 dark:text-white">{employerProfile?.contact_person_name || user?.name}</p>
                  <p className="truncate text-xs text-slate-500 dark:text-slate-400">{formatEmployerType(employerProfile?.employer_type)}</p>
                </div>
              </button>
              {isProfileMenuOpen && (
                <div className="mb-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-800 dark:bg-slate-900">
                  <EmployerProfileMenuItems employerType={employerProfile?.employer_type} onNavigate={() => { setIsProfileMenuOpen(false); setIsMobileMenuOpen(false); }} onLogout={() => { setIsProfileMenuOpen(false); setIsMobileMenuOpen(false); void handleLogout(); }} />
                </div>
              )}
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
                  {formatEmployerType(employerProfile?.employer_type)}
                </p>
              </div>
            </div>
          </div>

          <div className="mb-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Subscription</p>
            {employerProfile?.employer_type === "INDIVIDUAL" ? (
              <>
                <p className="mt-2 text-xl font-bold text-slate-900 dark:text-white">Commission-Based</p>
                <p className="mt-1 text-sm text-slate-500">₹30 per worker dispatched</p>
              </>
            ) : (
              <>
                <p className="mt-2 text-xl font-bold text-slate-900 dark:text-white">
                  {isSubscriptionActive(employerProfile?.subscription_valid_until) ? "Active" : employerProfile?.subscription_valid_until ? "Expired" : "Not Active"}
                </p>
                {formatSubscriptionExpiry(employerProfile?.subscription_valid_until) && <p className="mt-1 text-sm text-slate-500">Expires {formatSubscriptionExpiry(employerProfile?.subscription_valid_until)}</p>}
                <p className="mt-1 text-sm text-slate-500">Business subscription · ₹2,000 / month</p>
              </>
            )}
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


          {/* CONVERSATIONAL AI JOB ASSISTANT & LIVE STRUCTURED PREVIEW */}
          <div id="job-assistant" className="mx-auto max-w-5xl my-8 sm:my-10 w-full space-y-6">
            {/* Top Pill Buttons: Location & Job Site */}
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

            {/* Conversational Assistant & Live Structured Preview Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left Column: Conversational Assistant */}
              <div className="lg:col-span-7 flex flex-col rounded-3xl border border-slate-200 bg-white p-5 shadow-lg dark:border-slate-800 dark:bg-slate-900 min-h-[440px]">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400">
                      <Sparkles size={20} />
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-900 dark:text-white text-base">{assistantCopy.heading}</h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{assistantCopy.subtitle}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={selectedAssistantLanguage}
                      onChange={(e) => handleAssistantLanguageChange(e.target.value as AssistantLanguage)}
                      className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                    >
                      {LANGUAGE_OPTIONS.map(([code, opt]) => (
                        <option key={code} value={code}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Messages Thread */}
                <div className="my-4 flex-1 max-h-72 overflow-y-auto space-y-3 pr-2 flex flex-col">
                  {assistantMessages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex flex-col ${msg.sender === "user" ? "items-end" : "items-start"}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                          msg.sender === "user"
                            ? "bg-blue-600 text-white rounded-br-xs shadow-xs"
                            : "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200 rounded-bl-xs border border-slate-200/50 dark:border-slate-700/50"
                        }`}
                      >
                        {msg.text}
                      </div>
                      <span className="text-[10px] text-slate-400 mt-1 px-1">{msg.timestamp}</span>
                    </div>
                  ))}
                  {isAssistantSending && (
                    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/40 p-2.5 rounded-xl w-fit">
                      <Loader2 size={14} className="animate-spin text-blue-500" />
                      <span>{assistantCopy.thinking}</span>
                    </div>
                  )}
                </div>

                {/* Input Bar */}
                <div className="mt-auto pt-2">
                  {voiceError && <p className="mb-2 text-xs text-rose-500">{voiceError}</p>}
                  <div className="relative flex items-center rounded-full border border-blue-500/80 bg-slate-50/50 p-1.5 shadow-sm dark:border-blue-500 dark:bg-slate-800/50 focus-within:ring-3 focus-within:ring-blue-500/20 transition-all">
                    {/* Voice Mic Button */}
                    <button
                      type="button"
                      onClick={handleVoiceInput}
                      title={isListening ? assistantCopy.listening : assistantCopy.speak}
                      className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-all cursor-pointer ml-0.5 ${
                        isListening
                          ? "text-purple-700 dark:text-purple-200 bg-purple-100 dark:bg-purple-950/50"
                          : "text-slate-500 hover:bg-slate-200/70 dark:text-slate-400 dark:hover:bg-slate-700"
                      }`}
                    >
                      <VoiceMicIcon className="w-5 h-5" />
                    </button>

                    {/* Text Input */}
                    <input
                      type="text"
                      value={assistantInput}
                      onChange={(e) => setAssistantInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void handleSendAssistantMessage();
                        }
                      }}
                      placeholder={assistantCopy.placeholder}
                      className="w-full min-w-0 bg-transparent px-3 py-1.5 text-sm font-medium text-slate-900 outline-none placeholder:text-slate-400 dark:text-white dark:placeholder:text-slate-500"
                    />

                    {/* Send Arrow Button */}
                    <button
                      type="button"
                      onClick={() => void handleSendAssistantMessage()}
                      disabled={isAssistantSending || !assistantInput.trim()}
                      className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-white shadow-sm hover:bg-blue-700 active:scale-95 transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shrink-0 mr-0.5"
                    >
                      {isAssistantSending ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Right Column: Live Structured Preview */}
              <div className="lg:col-span-5 flex flex-col rounded-3xl border border-slate-200 bg-white p-5 shadow-lg dark:border-slate-800 dark:bg-slate-900 min-h-[440px]">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={18} className={readyToCreate ? "text-emerald-500" : "text-slate-400"} />
                    <h3 className="font-bold text-slate-900 dark:text-white text-base">{assistantCopy.preview}</h3>
                  </div>
                  <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${
                    readyToCreate
                      ? "bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300"
                      : "bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300"
                  }`}>
                    {readyToCreate ? assistantCopy.ready : assistantCopy.incomplete}
                  </span>
                </div>

                {/* Parameters list */}
                <div className="my-4 flex-1 space-y-2.5 divide-y divide-slate-100 dark:divide-slate-800/60 text-sm">
                  {assistantValidationErrors.length > 0 && (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">
                      {assistantValidationErrors.map((error) => <p key={error}>{error}</p>)}
                    </div>
                  )}
                  <div className="pt-2 flex justify-between items-center">
                    <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">{assistantCopy.role}</span>
                    <span className="font-semibold text-slate-900 dark:text-white">{assistantState.title || <span className="text-slate-400 font-normal italic">{assistantCopy.missing}</span>}</span>
                  </div>
                  <div className="pt-2 flex justify-between items-center">
                    <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">{assistantCopy.workers}</span>
                    <span className="font-semibold text-slate-900 dark:text-white">{assistantState.headcount_required ? `${assistantState.headcount_required} ${assistantCopy.workers.toLowerCase()}` : <span className="text-slate-400 font-normal italic">{assistantCopy.missing}</span>}</span>
                  </div>
                  <div className="pt-2 flex justify-between items-center">
                    <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">{assistantCopy.site}</span>
                    <span className="font-semibold text-slate-900 dark:text-white truncate max-w-[180px]">
                      {assistantState.job_site_id && (assistantState.job_site_name || selectedJobSite?.name) ? (
                        assistantState.job_site_name || selectedJobSite?.name
                      ) : (
                        <button type="button" onClick={handleOpenJobSiteSelector} className="text-blue-600 underline font-normal text-xs cursor-pointer">{assistantCopy.selectSite}</button>
                      )}
                    </span>
                  </div>
                  <div className="pt-2 flex justify-between items-center">
                    <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">{assistantCopy.wage}</span>
                    <span className="font-semibold text-slate-900 dark:text-white">{assistantState.max_daily_salary ? `₹${assistantState.max_daily_salary}/${assistantCopy.days === "दिन" ? "दिन" : "day"}` : <span className="text-slate-400 font-normal italic">{assistantCopy.missing}</span>}</span>
                  </div>
                  <div className="pt-2 flex justify-between items-center">
                    <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">{assistantCopy.duration}</span>
                    <span className="font-semibold text-slate-900 dark:text-white">{assistantState.work_duration_days ? `${assistantState.work_duration_days} ${assistantCopy.days}` : <span className="text-slate-400 font-normal italic">{assistantCopy.missing}</span>}</span>
                  </div>
                  <div className="pt-2 flex justify-between items-center">
                    <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">{assistantCopy.timing}</span>
                    <span className="font-semibold text-slate-900 dark:text-white">{assistantState.work_timing || <span className="text-slate-400 font-normal italic">{assistantCopy.missing}</span>}</span>
                  </div>
                  <div className="pt-2 flex justify-between items-center">
                    <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">{assistantCopy.experience}</span>
                    <span className="font-semibold text-slate-900 dark:text-white">
                      {assistantState.min_experience != null
                        ? `${assistantState.min_experience} ${assistantState.min_experience === 1 ? assistantCopy.year : assistantCopy.years}`
                        : assistantCopy.missing}
                    </span>
                  </div>
                  {assistantState.required_skills && assistantState.required_skills.length > 0 && (
                    <div className="pt-2 flex flex-col gap-1">
                      <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Skills</span>
                      <div className="flex flex-wrap gap-1">
                        {assistantState.required_skills.map((sk) => (
                          <span key={sk} className="text-[11px] bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-2 py-0.5 rounded-md font-medium">{sk}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Explicit Create Job Confirmation Button */}
                <div className="mt-auto pt-3 border-t border-slate-100 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={handleCreateJobFromAssistant}
                    disabled={!readyToCreate || isJobSaving}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white shadow-md hover:bg-blue-700 active:scale-95 transition disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                  >
                    {isJobSaving ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        <span>{assistantCopy.creating}</span>
                      </>
                    ) : (
                      <>
                        <Plus size={16} />
                        <span>{assistantCopy.create}</span>
                      </>
                    )}
                  </button>
                  {!readyToCreate && (
                    <p className="mt-2 text-center text-[11px] text-slate-400">
                      {assistantValidationErrors.length > 0
                        ? assistantValidationErrors[0]
                        : missingFields.length > 0
                          ? `${assistantCopy.required}: ${missingFields.join(", ")}`
                          : assistantCopy.complete}
                    </p>
                  )}
                </div>
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
                const summaryText = job.status === "COMPLETED" || job.status === "CANCELLED"
                  ? jobStatusLabel(job.status)
                  : job.status === "FILLED"
                  ? `${jobStatusLabel(job.status)} · ${acceptedCount} / ${job.headcount_required} selected`
                  : jobMatchSummaryState === "LOADING"
                  ? "Checking suitable workers..."
                  : jobMatchSummaryState === "ERROR"
                    ? "Unable to load match results"
                    : matchCount === 0
                      ? "No suitable workers found"
                      : `${jobStatusLabel(job.status)} · ${acceptedCount} / ${job.headcount_required} selected · ${matchCount} suitable worker${matchCount === 1 ? "" : "s"} found`;
                return <div key={job.id} className="flex items-center justify-between gap-4 py-4">
                <div>
                  <p className="font-semibold text-slate-900 dark:text-white">{job.title}</p>
                  <p className="text-sm text-slate-500 dark:text-slate-400">{job.headcount_required} worker{job.headcount_required === 1 ? "" : "s"} needed · {jobStatusLabel(job.status)}</p>
                  <p className={`mt-1 text-sm font-semibold ${jobMatchSummaryState === "ERROR" ? "text-rose-600 dark:text-rose-400" : "text-slate-700 dark:text-slate-300"}`}>{summaryText}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {job.status === "SEARCHING" && jobMatchSummaryState === "FOUND" && matchCount > 0 && <button type="button" onClick={() => void handleViewJobWorkers(job.id)} className="inline-flex items-center gap-2 rounded-lg border border-blue-200 px-3 py-2 text-sm font-semibold text-blue-600 hover:border-blue-300 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-400 dark:hover:bg-slate-800">
                    <Users size={16} /> View Workers
                  </button>}
                  {job.status === "SEARCHING" && <button type="button" onClick={() => void handleCancelJob(job.id)} disabled={lifecycleUpdatingJobId === job.id} className="inline-flex items-center gap-2 rounded-lg border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/30">
                    {lifecycleUpdatingJobId === job.id ? <Loader2 size={16} className="animate-spin" /> : <X size={16} />} Stop Searching
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
              <div><p className="text-xs font-semibold uppercase text-slate-400">Work Duration</p><p className="mt-1 font-semibold">{selectedJob.work_duration_days != null ? `${selectedJob.work_duration_days} days` : "Not specified"}</p></div>
              <div><p className="text-xs font-semibold uppercase text-slate-400">Daily Timing</p><p className="mt-1 font-semibold">{selectedJob.work_timing || "Not specified"}</p></div>
              <div><p className="text-xs font-semibold uppercase text-slate-400">Created</p><p className="mt-1">{new Date(selectedJob.created_at).toLocaleString()}</p></div>
            </div>}
            {jobViewMode === "workers" && <div>
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
              {!isJobMatchesLoading && !jobMatchesError && jobMatches?.matches.length === 0 && <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">No suitable workers found yet.</p>}
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
            </div>}
          </section>
        </div>
      )}
    </div>
  );
}
