"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import apiClient from "@/lib/api";
import {
  LogOut,
  Zap,
  Factory,
  Building2,
  User,
  ArrowRight,
  ArrowLeft,
  Loader2,
  CheckCircle2,
  ShieldCheck,
  Building,
  MapPin,
  FileCheck,
  Sparkles,
  ChevronRight,
  Info,
  Check,
  BadgeCheck,
  Briefcase,
  Users,
  Tag,
  Globe,
  TrendingUp,
  FileText,
  Phone,
  Mail,
  CreditCard,
  Rocket,
  Shield,
  RefreshCw,
  Sliders,
  Compass,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import LocationPicker, { LocationSelection } from "@/components/LocationPicker";

type EmployerType =
  | "REGISTERED_INDUSTRY"
  | "REGISTERED_BUSINESS"
  | "UNREGISTERED_BUSINESS"
  | "INDIVIDUAL";

type OnboardingFormData = Record<string, string>;

type VerificationRecord = {
  verification_type: string;
  status: "PENDING" | "VERIFIED" | "FAILED" | "NOT_CONFIGURED" | "REJECTED" | "MISMATCHED";
  failure_reason?: string | null;
  provider_reference_id?: string | null;
  verified_at?: string | null;
  provider_metadata?: Record<string, unknown> | null;
};

type VerificationState = {
  required: string[];
  records: VerificationRecord[];
};

const BUSINESS_TYPE_OPTIONS = [
  "Private Limited / Pvt Ltd",
  "Public Limited Company",
  "LLP",
  "LLC",
  "Limited Company (Ltd)",
  "OPC (One Person Company)",
  "Partnership",
  "Sole Proprietorship",
  "Corporation",
  "S Corporation",
  "C Corporation",
  "Non-Profit / Non-Profit Organization",
  "Enterprise",
  "Other",
];

const BUSINESS_CATEGORY_OPTIONS = [
  "Construction & Infrastructure",
  "Manufacturing",
  "Agriculture & Food",
  "Information Technology & Software",
  "Finance & Banking",
  "Healthcare & Pharmaceuticals",
  "Retail & E-commerce",
  "Logistics & Transportation",
  "Energy & Utilities",
  "Professional & Business Services",
  "Other",
];

const REQUIRED_FIELDS: Record<EmployerType, string[]> = {
  REGISTERED_INDUSTRY: [
    "business_name",
    "cin_number",
    "industry_type",
    "industry_category",
    "registered_address",
    "company_email",
    "company_phone",
    "city",
    "state",
    "pincode",
    "work_location",
    "director_name",
    "director_phone",
    "director_email",
    "director_address",
    "director_aadhaar",
  ],
  REGISTERED_BUSINESS: [
    "business_name",
    "cin_number",
    "business_type",
    "business_category",
    "registered_address",
    "company_email",
    "company_phone",
    "city",
    "state",
    "pincode",
    "work_location",
    "director_name",
    "director_phone",
    "director_email",
    "director_address",
    "director_aadhaar",
  ],
  UNREGISTERED_BUSINESS: [
    "business_name",
    "business_type",
    "nature_of_business",
    "number_of_proprietors",
    "company_email",
    "company_phone",
    "proprietor_name",
    "proprietor_aadhaar",
    "industry_category",
    "address",
    "city",
    "state",
    "pincode",
    "work_location",
  ],
  INDIVIDUAL: [
    "address",
    "company_email",
    "company_phone",
    "city",
    "state",
    "pincode",
    "work_location",
  ],
};

function requiredFieldsFor(type: EmployerType): string[] {
  return REQUIRED_FIELDS[type];
}

function getErrorDetail(error: unknown, fallback: string): string {
  const candidate = error as {
    response?: { data?: { detail?: unknown } };
    message?: string;
  };
  const detail = candidate.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail.length > 0) {
    const msgs = detail
      .map((item) =>
        typeof item === "object" && item && "msg" in item
          ? String(item.msg)
          : typeof item === "string"
          ? item
          : ""
      )
      .filter(Boolean);
    if (msgs.length > 0) return msgs.join(", ");
  }
  if (detail && typeof detail === "object" && "code" in detail) {
    return String((detail as { code: unknown }).code);
  }
  return candidate.message || fallback;
}

function getVerificationErrorMessage(error: unknown): string {
  const candidate = error as { response?: { data?: { detail?: unknown } } };
  const detail = candidate.response?.data?.detail;
  const detailRecord = detail && typeof detail === "object" ? (detail as Record<string, unknown>) : null;
  const code = typeof detailRecord?.code === "string" ? detailRecord.code : typeof detail === "string" ? detail : "";
  const verification = detailRecord?.verification;
  const verificationRecord = verification && typeof verification === "object" ? (verification as Record<string, unknown>) : null;
  const providerMetadata = verificationRecord?.provider_metadata;
  const providerMetadataRecord = providerMetadata && typeof providerMetadata === "object"
    ? (providerMetadata as Record<string, unknown>)
    : null;
  const providerCode = typeof providerMetadataRecord?.provider_code === "string"
    ? providerMetadataRecord.provider_code
    : "";
  const messages: Record<string, string> = {
    CIN_INVALID: "Please enter a valid 21-character CIN.",
    CIN_MISSING: "Please enter your CIN before verifying.",
    BUSINESS_NAME_MISSING: "Please enter the business name before verifying the CIN.",
    CASHFREE_INSUFFICIENT_BALANCE: "CIN verification is temporarily unavailable because verification credits are exhausted. Please try again later.",
    CASHFREE_VERIFICATION_FAILED: "CIN verification failed. Please check the CIN and try again.",
    CASHFREE_RATE_LIMITED: "Too many verification attempts. Please try again later.",
    CASHFREE_TIMEOUT: "CIN verification is taking too long. Please try again.",
    CASHFREE_UNAVAILABLE: "CIN verification service is temporarily unavailable. Please try again later.",
    CASHFREE_MALFORMED_RESPONSE: "CIN verification failed because the verification service returned an invalid response. Please try again later.",
    VERIFICATION_NOT_CONFIGURED: "CIN verification is not configured. Please try again later.",
    VERIFICATION_PROVIDER_NOT_CONFIGURED: "CIN verification is not configured. Please try again later.",
  };
  if (code === "CASHFREE_AUTHENTICATION_FAILED" && providerCode === "ip_validation_failed") {
    return "CIN verification service rejected the backend IP address. Please contact the administrator.";
  }
  if (code === "CASHFREE_AUTHENTICATION_FAILED") {
    return "CIN verification could not connect to the verification service. Please try again later.";
  }
  return messages[code] || "CIN verification failed. Please try again later.";
}

function getVerificationStatus(record: VerificationRecord | undefined, provided: boolean): string {
  if (!provided) return "NOT VERIFIED";
  if (record?.status === "VERIFIED") return "VERIFIED";
  if (record?.status === "FAILED" || record?.status === "NOT_CONFIGURED") return "FAILED";
  if (record?.status === "PENDING") return "VERIFYING";
  return "NOT VERIFIED";
}

function getSafeVerifiedName(record: VerificationRecord | undefined): string {
  const metadata = record?.provider_metadata;
  if (!metadata) return "";
  for (const key of ["company_name", "companyName", "registered_name", "legal_name_of_business", "trade_name_of_business", "name", "name_on_aadhaar"]) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function getVerificationFailureMessage(
  type: string,
  reason: string | null | undefined,
  record: VerificationRecord | undefined,
  enteredName: string,
): string {
  const normalized = (reason || "").trim();
  const lower = normalized.toLowerCase();
  const label = type === "AADHAAR" ? "Authorized Signatory Aadhaar" : type;
  const verifiedName = getSafeVerifiedName(record);

  if (lower.includes("name") && (lower.includes("match") || lower.includes("different")) && verifiedName) {
    return `The entered business name does not match the verified company name. Entered: ${enteredName || "Not provided"}. Verified: ${verifiedName}.`;
  }
  if (!normalized) return `${label} verification failed. Please check the entered details and try again.`;
  if (lower.includes("doesn't exist") || lower.includes("does not exist") || lower.includes("not found")) {
    return `${label} doesn't exist or could not be found in the verification database.`;
  }
  if (lower.includes("inactive")) return `${label} is inactive and could not be verified.`;
  if (lower.includes("invalid")) return `${label} is invalid and could not be verified.`;
  if (lower === "cashfree_verification_failed") return `${label} was rejected by the verification provider.`;
  if (lower.includes("unavailable") || lower.includes("timeout") || lower.includes("network") || lower.includes("configuration") || lower.includes("ip")) {
    return `${label} verification service is temporarily unavailable. Please try again later.`;
  }
  return normalized;
}

function hasCompleteDetails(type: EmployerType, details: Record<string, unknown>): boolean {
  return requiredFieldsFor(type).every((field) => {
    const value = details[field];
    return value !== null && value !== undefined && String(value).trim() !== "";
  });
}

function maskAadhaar(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length === 12 ? `XXXX XXXX ${digits.slice(-4)}` : value || "Masked";
}

function hasVerifiedLegalIdentity(type: EmployerType | "", verification: VerificationState): boolean {
  if (type !== "REGISTERED_BUSINESS" && type !== "REGISTERED_INDUSTRY") {
    return true;
  }
  const cinRecord = verification.records.find((record) => record.verification_type === "CIN");
  return cinRecord?.status === "VERIFIED";
}

function hasVerifiedRecord(verification: VerificationState, type: string): boolean {
  return verification.records.some(
    (record) => record.verification_type === type && record.status === "VERIFIED"
  );
}

const ONBOARDING_FIELDS = [
  "business_name",
  "business_type",
  "industry_category",
  "industry_type",
  "registered_address",
  "address",
  "city",
  "state",
  "pincode",
  "gstin",
  "registration_number",
  "cin_number",
  "pan_number",
  "nature_of_business",
  "number_of_proprietors",
  "company_email",
  "company_phone",
  "proprietor_name",
  "proprietor_aadhaar",
  "director_name",
  "director_phone",
  "director_email",
  "director_address",
  "director_aadhaar",
  "work_location",
  "latitude",
  "longitude",
  "website_url",
  "annual_revenue",
  "description",
  "business_category",
];

export default function EmployerOnboarding() {
  const router = useRouter();
  const { user, isLoading, nextStep, logout, refreshUser } = useAuth();

  // 1: Company, 2: Legal verification, 3: Director, 4: Location
  const [activeStep, setActiveStep] = useState<0 | 1 | 2 | 3 | 4 | 5>(0);
  const [employerType, setEmployerType] = useState<EmployerType | "">("");
  const [formData, setFormData] = useState<OnboardingFormData>({});
  const [formError, setFormError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isHydrating, setIsHydrating] = useState(true);
  const [verification, setVerification] = useState<VerificationState>({ required: [], records: [] });
  const [aadhaarOtp, setAadhaarOtp] = useState("");

  // Animation Transition States
  const [transitionDirection, setTransitionDirection] = useState<"next" | "prev">("next");
  const [isAnimating, setIsAnimating] = useState(false);
  const [animPhase, setAnimPhase] = useState<"idle" | "exit" | "enter">("idle");
  const [orbRotation, setOrbRotation] = useState(0);

  const selectWorkLocation = (location: LocationSelection) => {
    setFormData((current) => ({
      ...current,
      work_location: location.address,
      city: location.city || current.city || "",
      state: location.state || current.state || "",
      pincode: location.pincode || current.pincode || "",
      latitude: String(location.latitude),
      longitude: String(location.longitude),
    }));
    setFormError("");
    setFieldErrors((prev) => ({ ...prev, work_location: "", pincode: "", city: "", state: "" }));
  };

  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/employer/auth");
    }

    if (!isLoading && user && user.role !== "EMPLOYER") {
      router.push("/");
    }

    if (!isLoading && nextStep === "DASHBOARD") {
      router.push("/employer/dashboard");
    }
  }, [user, isLoading, nextStep, router]);

  useEffect(() => {
    if (isLoading || !user || user.role !== "EMPLOYER") return;

    let active = true;
    const loadOnboarding = async () => {
      try {
        const response = await apiClient.get("/api/v1/employers/onboarding", {
          withCredentials: true,
        });
        if (!active) return;

        const employer = response.data?.employer;
        const details = response.data?.details || {};
        const savedVerification = response.data?.verification || { required: [], records: [] };
        const savedFormData = Object.fromEntries(
          ONBOARDING_FIELDS.filter(
            (field) => details[field] !== null && details[field] !== undefined
          ).map((field) => [field, String(details[field])])
        );

        if (!savedFormData.company_email && user.email) savedFormData.company_email = user.email;
        if (!savedFormData.company_phone && user.mobile) savedFormData.company_phone = user.mobile;

        if (employer?.employer_type) {
          const selectedType = employer.employer_type as EmployerType;
          setEmployerType(selectedType);
          setFormData(savedFormData);
          const currentVerification: VerificationState = {
            required: savedVerification.required || [],
            records: savedVerification.records || [],
          };
          setVerification(currentVerification);

          if (nextStep === "DASHBOARD" || employer.onboarding_status === "COMPLETED") {
            router.push("/employer/dashboard");
            return;
          }

          const savedDetailsComplete = hasCompleteDetails(selectedType, details);

          if (selectedType === "REGISTERED_INDUSTRY") {
            if (checkStep1Incomplete(selectedType, savedFormData)) setActiveStep(1);
            else if (!savedFormData.cin_number || !hasVerifiedRecord(currentVerification, "CIN")) setActiveStep(2);
            else if (!savedFormData.director_name || !savedFormData.director_aadhaar || !hasVerifiedRecord(currentVerification, "AADHAAR")) setActiveStep(3);
            else setActiveStep(4);
          } else if (!savedDetailsComplete) {
            const step1Incomplete = checkStep1Incomplete(selectedType, savedFormData);
            if (step1Incomplete) {
              setActiveStep(1);
            } else {
              setActiveStep(2);
            }
          } else {
            setActiveStep(3);
          }
        } else {
          setActiveStep(0);
        }
      } catch (err: unknown) {
        const status = (err as { response?: { status?: number } }).response?.status;
        if (active && status !== 404) {
          setFormError(getErrorDetail(err, "Unable to load saved onboarding details"));
        }
      } finally {
        if (active) setIsHydrating(false);
      }
    };

    loadOnboarding();
    return () => {
      active = false;
    };
  }, [isLoading, user, nextStep, router]);

  const checkStep1Incomplete = (type: EmployerType, data: OnboardingFormData) => {
    if (type === "REGISTERED_BUSINESS") {
      return (
        !data.business_name?.trim() ||
        !data.business_type?.trim() ||
        !data.business_category?.trim()
      );
    }
    if (type === "REGISTERED_INDUSTRY") {
      return !data.business_name?.trim() || !data.registered_address?.trim() || !data.industry_type?.trim();
    }
    if (type === "UNREGISTERED_BUSINESS") {
      return (
        !data.business_name?.trim() ||
        !data.business_type?.trim() ||
        !data.nature_of_business?.trim() ||
        !data.number_of_proprietors ||
        Number(data.number_of_proprietors) < 1 ||
        !data.industry_category?.trim() ||
        !data.address?.trim()
      );
    }
    if (type === "INDIVIDUAL") {
      return !data.address?.trim();
    }
    return false;
  };

  // Animated Step Transition Handler
  const transitionToStep = (targetStep: 0 | 1 | 2 | 3 | 4 | 5, dir: "next" | "prev" = "next") => {
    if (isAnimating || targetStep === activeStep) return;
    setIsAnimating(true);
    setTransitionDirection(dir);
    setOrbRotation((prev) => prev + (dir === "next" ? 180 : -180));
    setAnimPhase("exit");

    setTimeout(() => {
      setActiveStep(targetStep);
      setAnimPhase("enter");
      setTimeout(() => {
        setAnimPhase("idle");
        setIsAnimating(false);
      }, 300);
    }, 250);
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="flex flex-col items-center gap-4">
          <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 shadow-xl shadow-blue-500/30">
            <Zap size={28} className="text-white animate-pulse" fill="currentColor" />
          </div>
          <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">Loading profile...</p>
        </div>
      </div>
    );
  }

  if (!user || isHydrating) {
    return null;
  }

  const handleSelectType = async (type: string) => {
    if (isSubmitting || isAnimating) return;
    setFormError("");
    setFieldErrors({});
    setIsSubmitting(true);
    try {
      await apiClient.post("/api/v1/employers/onboarding/type", {
        employer_type: type as EmployerType,
      });
      const verificationResponse = await apiClient.get("/api/v1/employers/onboarding/verifications", {
        withCredentials: true,
      });
      const nextVerification = {
        required: verificationResponse.data?.required || [],
        records: verificationResponse.data?.records || [],
      };
      setVerification(nextVerification);
      setEmployerType(type as EmployerType);
      setFormData((current) => ({
        ...current,
        company_email: current.company_email || user.email || "",
        company_phone: current.company_phone || user.mobile || "",
      }));

      transitionToStep(1, "next");
      toast.success("Employer category set");
    } catch (err: unknown) {
      const message = getErrorDetail(err, "Failed to select type");
      setFormError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateField = (field: string, value: string) => {
    const formatted = ["cin_number", "pan_number", "gstin"].includes(field)
      ? value.toUpperCase().replace(/\s+/g, "")
      : field === "proprietor_aadhaar" || field === "director_aadhaar"
      ? value.replace(/\D/g, "").slice(0, 12)
      : field === "number_of_proprietors"
      ? value.replace(/\D/g, "")
      : value;

    setFormData((current) => ({ ...current, [field]: formatted }));
    setFormError("");
    setFieldErrors((prev) => ({ ...prev, [field]: "" }));
  };

  const endpointByType: Record<EmployerType, string> = {
    REGISTERED_INDUSTRY: "/api/v1/employers/onboarding/registered-industry",
    REGISTERED_BUSINESS: "/api/v1/employers/onboarding/registered-business",
    UNREGISTERED_BUSINESS: "/api/v1/employers/onboarding/unregistered-business",
    INDIVIDUAL: "/api/v1/employers/onboarding/individual",
  };

  const buildPayload = () => {
    const registeredIndustryCompanyFields = new Set([
      "business_name",
      "industry_type",
      "business_category",
      "industry_category",
      "registered_address",
      "company_email",
      "company_phone",
      "city",
      "state",
      "pincode",
      "website_url",
      "annual_revenue",
      "description",
    ]);
    const payload = Object.fromEntries(
      Object.entries(formData).filter(([field, value]) => {
        if (employerType === "REGISTERED_INDUSTRY" && activeStep === 1) {
          return registeredIndustryCompanyFields.has(field) && value && value.trim() !== "";
        }
        return value && value.trim() !== "";
      })
    );
    if (employerType === "UNREGISTERED_BUSINESS") {
      delete payload.udyam_number;
    }
    if (employerType === "REGISTERED_INDUSTRY" && activeStep < 4) {
      delete payload.work_location;
      delete payload.latitude;
      delete payload.longitude;
    }
    return payload;
  };

  const saveCurrentDraft = async () => {
    if (!employerType) return true;
    try {
      await apiClient.put(endpointByType[employerType], buildPayload(), {
        withCredentials: true,
      });
      return true;
    } catch (err: unknown) {
      const message = getErrorDetail(err, "Failed to save details");
      setFormError(message);
      toast.error(message);
      return false;
    }
  };

  // Step 1 Validation & Proceed
  const handleProceedFromStep1 = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || isAnimating) return;
    setFormError("");
    const errors: Record<string, string> = {};

    if (!employerType) {
      setFormError("Please select an employer category first");
      return;
    }

    if (employerType === "REGISTERED_BUSINESS" || employerType === "REGISTERED_INDUSTRY") {
      if (!formData.business_name?.trim()) {
        errors.business_name = "Business / Company name is required";
      }
      if (employerType === "REGISTERED_BUSINESS") {
        if (!formData.business_type?.trim()) {
          errors.business_type = "Business type is required";
        }
        if (!formData.business_category?.trim()) {
          errors.business_category = "Business category is required";
        }
      }
      if (employerType === "REGISTERED_INDUSTRY") {
        if (!formData.industry_type?.trim()) {
          errors.industry_type = "Industry type is required";
        }
        if (!formData.registered_address?.trim()) {
          errors.registered_address = "Registered address is required";
        }
        for (const field of ["company_email", "company_phone", "city", "state", "pincode"]) {
          if (!formData[field]?.trim()) errors[field] = `${field.replaceAll("_", " ")} is required`;
        }
        if (formData.pincode && !/^\d{6}$/.test(formData.pincode.trim())) {
          errors.pincode = "A valid 6-digit pincode is required";
        }
      }
    } else if (employerType === "UNREGISTERED_BUSINESS") {
      if (!formData.business_name?.trim()) {
        errors.business_name = "Business name is required";
      }
      if (!formData.business_type?.trim()) {
        errors.business_type = "Business type is required";
      }
      if (!formData.nature_of_business?.trim()) {
        errors.nature_of_business = "Nature of business is required";
      }
      if (!formData.number_of_proprietors || Number(formData.number_of_proprietors) < 1) {
        errors.number_of_proprietors = "Number of proprietors must be at least 1";
      }
      if (!formData.address?.trim()) {
        errors.address = "Business address is required";
      }
      if (!formData.industry_category?.trim()) {
        errors.industry_category = "Industry category is required";
      }
    } else if (employerType === "INDIVIDUAL") {
      if (!formData.address?.trim()) {
        errors.address = "Primary address is required";
      }
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setFormError("Please fill in all required fields before continuing");
      return;
    }

    setIsSubmitting(true);
    const saved = employerType === "UNREGISTERED_BUSINESS" || await saveCurrentDraft();
    setIsSubmitting(false);

    if (saved) {
      transitionToStep(2, "next");
      toast.success("Business information saved");
    }
  };

  // Step 2 Validation & Proceed
  const handleProceedFromStep2 = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || isAnimating) return;
    setFormError("");
    const errors: Record<string, string> = {};

    if (employerType === "REGISTERED_INDUSTRY") {
      if (!formData.cin_number?.trim()) errors.cin_number = "CIN is required";
      if (Object.keys(errors).length > 0) {
        setFieldErrors(errors);
        setFormError("Enter and verify the CIN before continuing");
        return;
      }
      if (!hasVerifiedRecord(verification, "CIN")) {
        setFormError("CIN must be verified before Director Details are unlocked");
        return;
      }
      setIsSubmitting(true);
      const saved = await saveCurrentDraft();
      setIsSubmitting(false);
      if (saved) transitionToStep(3, "next");
      return;
    }

    if (!formData.company_email?.trim()) {
      errors.company_email = "Company email is required";
    }
    if (!formData.company_phone?.trim()) {
      errors.company_phone = "Company phone is required";
    }
    if (!formData.city?.trim()) {
      errors.city = "City is required";
    }
    if (!formData.state?.trim()) {
      errors.state = "State is required";
    }
    if (!formData.pincode?.trim() || !/^\d{6}$/.test(formData.pincode.trim())) {
      errors.pincode = "A valid 6-digit pincode is required";
    }
    if (!formData.work_location?.trim()) {
      errors.work_location = "Work location is required";
    }

    if (employerType === "REGISTERED_BUSINESS") {
      if (!formData.director_name?.trim()) {
        errors.director_name = "Authorized Signatory Name is required";
      }
      if (!formData.director_phone?.trim()) {
        errors.director_phone = "Authorized Signatory Phone is required";
      }
      if (!formData.director_email?.trim()) {
        errors.director_email = "Authorized Signatory Email is required";
      }
      if (employerType !== "REGISTERED_BUSINESS" && (!formData.director_aadhaar?.trim() || !/^\d{12}$/.test(formData.director_aadhaar.trim()))) {
        errors.director_aadhaar = "A valid 12-digit Authorized Signatory Aadhaar is required";
      }
      if (!formData.director_address?.trim()) {
        errors.director_address = "Authorized Signatory Address is required";
      }
    }

    if (employerType === "UNREGISTERED_BUSINESS") {
      if (!formData.proprietor_name?.trim()) {
        errors.proprietor_name = "Proprietor name is required";
      }
      if (!formData.proprietor_aadhaar?.trim()) {
        errors.proprietor_aadhaar = "Proprietor Aadhaar is required";
      } else if (!/^\d{12}$/.test(formData.proprietor_aadhaar.trim())) {
        errors.proprietor_aadhaar = "Proprietor Aadhaar must be a 12-digit number";
      }
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setFormError("Please correct the highlighted errors before continuing");
      return;
    }

    setIsSubmitting(true);
    const saved = await saveCurrentDraft();
    setIsSubmitting(false);

    if (saved) {
      transitionToStep(3, "next");
      toast.success("Contact details saved");
    }
  };

  const handleProceedFromStep3 = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || isAnimating) return;
    const errors: Record<string, string> = {};
    for (const field of ["director_name", "director_phone", "director_email", "director_address", "city", "state", "pincode", "director_aadhaar"]) {
      if (!formData[field]?.trim()) errors[field] = `${field.replaceAll("_", " ")} is required`;
    }
    if (formData.director_aadhaar && !/^\d{12}$/.test(formData.director_aadhaar)) {
      errors.director_aadhaar = "A valid 12-digit Director Aadhaar is required";
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setFormError("Complete the Director Details before continuing");
      return;
    }
    if (!hasVerifiedRecord(verification, "AADHAAR")) {
      setFormError("Director Aadhaar must be verified before Work Location is unlocked");
      return;
    }
    setIsSubmitting(true);
    const saved = await saveCurrentDraft();
    setIsSubmitting(false);
    if (saved) transitionToStep(4, "next");
  };

  const validateIdentity = () => {
    if (!formData.business_name?.trim()) return "Please enter the business name before verifying the CIN.";
    const cin = formData.cin_number?.trim().toUpperCase();
    if (!cin) return "Please enter your CIN before verifying.";
    if (!/^[A-Z][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/.test(cin)) {
      return "Please enter a valid 21-character CIN.";
    }
    return "";
  };

  const handleVerifyLegalIdentity = async () => {
    if (isSubmitting || isAnimating) return;
    const validationError = validateIdentity();
    if (validationError) {
      setFormError(validationError);
      toast.error(validationError);
      return;
    }
    setIsSubmitting(true);
    setFormError("");
    try {
      const normalizedCin = formData.cin_number?.trim().toUpperCase();
      const payload = {
        ...buildPayload(),
        cin_number: normalizedCin,
      };
      await apiClient.put("/api/v1/employers/onboarding/legal-identity", payload, {
        withCredentials: true,
      });

      const verifyRes = await apiClient.post(
        "/api/v1/employers/onboarding/verifications/CIN",
        { reference: normalizedCin },
        { withCredentials: true }
      );

      const record = verifyRes.data as VerificationRecord;
      const nextRecords = [
        ...verification.records.filter((item) => item.verification_type !== "CIN"),
        record,
      ];
      setVerification((current) => ({
        ...current,
        records: nextRecords,
      }));

      if (record.status === "VERIFIED") {
        toast.success("Legal identity (CIN) verified successfully!");
      } else {
        const failureMessage =
          record.failure_reason === "CASHFREE_AUTHENTICATION_FAILED"
            ? "Cashfree credentials were rejected. Contact the administrator."
            : record.failure_reason === "VERIFICATION_PROVIDER_NOT_CONFIGURED"
            ? "Verification provider is not configured."
            : record.failure_reason || "Verification failed";
        setFormError(failureMessage);
        toast.error(failureMessage);
      }
    } catch (err: unknown) {
      const message = getVerificationErrorMessage(err);
      setFormError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const getVerificationRecord = (type: string) =>
    verification.records.find((record) => record.verification_type === type);

  const handleRequestVerification = async (type: string) => {
    if (isSubmitting || isAnimating) return;
    setFormError("");
    setIsSubmitting(true);
    try {
      if (employerType === "REGISTERED_INDUSTRY" || employerType === "REGISTERED_BUSINESS") {
        const saved = await saveCurrentDraft();
        if (!saved) return;
      }
      const response = await apiClient.post(
        `/api/v1/employers/onboarding/verifications/${type}`,
        {},
        { withCredentials: true }
      );
      const record = response.data as VerificationRecord;
      setVerification((current) => ({
        ...current,
        records: [
          ...current.records.filter((item) => item.verification_type !== type),
          record,
        ],
      }));
      if (record.status === "VERIFIED") {
        toast.success(`✓ ${type === "AADHAAR" ? "Authorized Signatory Aadhaar" : type} verified`);
      } else if (record.status === "FAILED" || record.status === "NOT_CONFIGURED") {
        const message = getVerificationFailureMessage(
          type,
          record.failure_reason,
          record,
          formData.business_name || "",
        );
        setFormError(message);
        toast.error(message);
      } else if (record.status === "PENDING" && record.failure_reason === "OTP_SENT") {
        toast.success("✓ OTP sent successfully");
      } else {
        toast.info(`${type.replaceAll("_", " ")} verification is in progress`);
      }
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } }).response?.data?.detail;
      const detailRecord = detail && typeof detail === "object" ? (detail as Record<string, unknown>) : null;
      const verificationRecord = detailRecord?.verification;
      if (verificationRecord && typeof verificationRecord === "object" && "verification_type" in verificationRecord) {
        const record = verificationRecord as VerificationRecord;
        setVerification((current) => ({
          ...current,
          records: [
            ...current.records.filter((item) => item.verification_type !== record.verification_type),
            record,
          ],
        }));
      }
      const message = verificationRecord && typeof verificationRecord === "object"
        ? getVerificationFailureMessage(
            String((verificationRecord as Record<string, unknown>).verification_type || "verification"),
            typeof (verificationRecord as Record<string, unknown>).failure_reason === "string"
              ? (verificationRecord as Record<string, unknown>).failure_reason as string
              : null,
            verificationRecord as VerificationRecord,
            formData.business_name || "",
          )
        : getVerificationErrorMessage(err);
      setFormError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerifyAadhaarOtp = async () => {
    if (isSubmitting || isAnimating || !aadhaarOtp.trim()) return;
    setIsSubmitting(true);
    setFormError("");
    try {
      const response = await apiClient.post(
        "/api/v1/employers/onboarding/verifications/AADHAAR/otp",
        { otp: aadhaarOtp.trim() },
        { withCredentials: true },
      );
      const record = response.data as VerificationRecord;
      setVerification((current) => ({
        ...current,
        records: [...current.records.filter((item) => item.verification_type !== "AADHAAR"), record],
      }));
      if (record.status === "VERIFIED") {
        setAadhaarOtp("");
        toast.success(`✓ ${employerType === "UNREGISTERED_BUSINESS" ? "Proprietor" : "Authorized Signatory"} Aadhaar verified`);
      } else if (record.status === "FAILED") {
        const message = getVerificationFailureMessage("AADHAAR", record.failure_reason, record, formData.business_name || "");
        setFormError(message);
        toast.error(message);
      } else {
        toast.info("Aadhaar verification is still in progress");
      }
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } }).response?.data?.detail;
      const detailRecord = detail && typeof detail === "object" ? (detail as Record<string, unknown>) : null;
      const verificationRecord = detailRecord?.verification;
      const message = verificationRecord && typeof verificationRecord === "object"
        ? getVerificationFailureMessage(
            "AADHAAR",
            typeof (verificationRecord as Record<string, unknown>).failure_reason === "string"
              ? (verificationRecord as Record<string, unknown>).failure_reason as string
              : null,
            verificationRecord as VerificationRecord,
            formData.business_name || "",
          )
        : getVerificationErrorMessage(err);
      setFormError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const validateAllRequired = () => {
    if (!employerType) return "Select an employer category first";
    const missingField = REQUIRED_FIELDS[employerType].find(
      (field) => !formData[field]?.trim()
    );
    if (missingField) return `${missingField.replaceAll("_", " ")} is required`;
    if (!/^\d{6}$/.test(formData.pincode || "")) return "Pincode must be a valid 6-digit number";
    return "";
  };

  const handleComplete = async () => {
    if (isSubmitting || isAnimating) return;
    setFormError("");

    const validationError = validateAllRequired();
    if (validationError) {
      setFormError(validationError);
      toast.error(validationError);
      return;
    }

    setIsSubmitting(true);
    try {
      await apiClient.put(endpointByType[employerType as EmployerType], buildPayload(), {
        withCredentials: true,
      });

      await apiClient.post("/api/v1/employers/onboarding/complete", {});
      await refreshUser();
      const refreshedState = await apiClient.get("/api/v1/auth/me", {
        withCredentials: true,
      });
      const refreshedNextStep = refreshedState.data?.next_step;

      if (refreshedNextStep !== "DASHBOARD") {
        throw new Error(
          `Onboarding completed but session state is ${refreshedNextStep || "unknown"}. Please refresh.`
        );
      }

      toast.success("Onboarding completed successfully!");
      router.push("/employer/dashboard");
    } catch (err: unknown) {
      const message = getErrorDetail(err, "Failed to complete onboarding");
      setFormError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      router.push("/");
    } catch {
      toast.error("Logout failed");
    }
  };

  const isRegistered =
    employerType === "REGISTERED_BUSINESS" || employerType === "REGISTERED_INDUSTRY";

  const progressSteps = employerType === "REGISTERED_INDUSTRY"
    ? [
        { num: 1, label: "Company", short: "Company" },
        { num: 2, label: "Legal Verification", short: "Legal" },
        { num: 3, label: "Director", short: "Director" },
        { num: 4, label: "Work Location", short: "Location" },
      ]
    : [
        { num: 1, label: "Business Information", short: "Business Info" },
        { num: 2, label: "Contact", short: "Contact" },
        { num: 3, label: "Verify", short: "Verify" },
      ];

  return (
    <div className="min-h-screen bg-slate-50/80 font-sans text-slate-900 dark:bg-slate-950 dark:text-slate-100 flex flex-col selection:bg-blue-500 selection:text-white">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/80 backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/80">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3.5 sm:px-6">
          <Link href="/" className="flex items-center gap-3 group">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-blue-500 shadow-md shadow-blue-500/25 transition group-hover:scale-105">
              <Zap size={20} className="text-white" fill="currentColor" />
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-1.5">
                <span className="font-extrabold tracking-tight text-slate-900 text-lg leading-none dark:text-white">
                  GO LESKA
                </span>
                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                  PRO
                </span>
              </div>
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                Employer Onboarding
              </span>
            </div>
          </Link>

          <div className="flex items-center gap-4">
            {user.email && (
              <div className="hidden sm:flex flex-col items-end">
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  {user.email}
                </span>
                <span className="text-[10px] text-slate-400">Verified Employer Account</span>
              </div>
            )}
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 shadow-xs transition hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <LogOut size={14} />
              <span>Logout</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8">
        <div className="relative flex flex-col lg:flex-row gap-6 lg:gap-0 items-stretch">
          {/* LEFT SIDE: Promotional & Value Proposition Panel (Inspired by Business Mall) */}
          <div className="hidden lg:flex lg:w-5/12 xl:w-4/12 flex-col justify-between p-8 xl:p-10 rounded-3xl bg-gradient-to-br from-slate-900 via-indigo-950 to-blue-950 text-white shadow-2xl border border-slate-800/80 relative overflow-hidden z-10">
            {/* Ambient Lighting Accents */}
            <div className="absolute -top-32 -left-32 h-80 w-80 rounded-full bg-blue-500/20 blur-3xl" />
            <div className="absolute -bottom-32 -right-32 h-80 w-80 rounded-full bg-indigo-500/20 blur-3xl" />

            <div className="relative z-10 space-y-8">
              {/* Logo Badge */}
              <div className="flex items-center justify-between">
                <div className="inline-flex items-center gap-2 rounded-full border border-blue-400/30 bg-blue-500/10 px-3.5 py-1.5 text-xs font-bold tracking-wider text-blue-300 backdrop-blur-md uppercase">
                  <Globe size={14} className="text-blue-400" />
                  Your All-in-One Business Platform
                </div>
              </div>

              {/* Main Headline */}
              <div className="space-y-3">
                <h1 className="text-3xl font-extrabold tracking-tight text-white xl:text-4xl leading-tight">
                  Build. Manage. <br />
                  Grow. <span className="bg-gradient-to-r from-blue-400 to-indigo-300 bg-clip-text text-transparent">Together.</span>
                </h1>
                <p className="text-xs text-slate-300 leading-relaxed font-medium">
                  Complete your verified profile to connect with workers, manage site attendance, and publish jobs seamlessly.
                </p>
              </div>

              {/* 4 Core Value Pillars (Business Mall Reference) */}
              <div className="space-y-4 pt-1">
                {[
                  {
                    title: "Build",
                    desc: "Create your digital presence in minutes with our intuitive toolset.",
                    icon: Rocket,
                    color: "text-blue-400 bg-blue-500/20 border-blue-500/30",
                  },
                  {
                    title: "Hire",
                    desc: "Access an elite local talent pool vetted for enterprise standards.",
                    icon: Users,
                    color: "text-indigo-400 bg-indigo-500/20 border-indigo-500/30",
                  },
                  {
                    title: "AI Assistant",
                    desc: "Smart job post extraction powered by automated intelligence.",
                    icon: Sparkles,
                    color: "text-cyan-400 bg-cyan-500/20 border-cyan-500/30",
                  },
                  {
                    title: "Secure",
                    desc: "Enterprise-grade protection for your business data and verification.",
                    icon: ShieldCheck,
                    color: "text-emerald-400 bg-emerald-500/20 border-emerald-500/30",
                  },
                ].map((pillar) => (
                  <div key={pillar.title} className="flex items-start gap-3.5 group">
                    <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${pillar.color} transition group-hover:scale-110`}>
                      <pillar.icon size={18} />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-white tracking-wide">{pillar.title}</h4>
                      <p className="text-[11px] text-slate-300 leading-normal mt-0.5 font-normal">
                        {pillar.desc}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Bottom Social Proof Box */}
            <div className="relative z-10 mt-8 rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-md">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex -space-x-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-[11px] font-bold text-white ring-2 ring-slate-900">
                      AB
                    </div>
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-[11px] font-bold text-white ring-2 ring-slate-900">
                      SK
                    </div>
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-[11px] font-bold text-white ring-2 ring-slate-900">
                      VR
                    </div>
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-800 text-[10px] font-bold text-blue-300 ring-2 ring-slate-900">
                      +50k
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-white">50,000+ Businesses</p>
                    <p className="text-[10px] text-slate-400">Trust Go Leska platform</p>
                  </div>
                </div>
                <div className="flex items-center gap-1 text-amber-400 text-xs font-bold">
                  ★ 4.9
                </div>
              </div>
            </div>
          </div>

          {/* CENTRAL ANIMATED DIVIDER & ORB TRANSITION POINT (Ref Image 1 & 2) */}
          <div className="hidden lg:flex items-center justify-center relative -mx-4 z-20 pointer-events-none self-stretch">
            {/* Vertical Curved Bridge Backdrop */}
            <div className="h-full w-8 flex flex-col items-center justify-center relative">
              <div className="h-full w-[2px] bg-gradient-to-b from-blue-500/10 via-indigo-500/40 to-blue-500/10" />

              {/* Glowing Central Orb Dial */}
              <div className="absolute top-1/2 -translate-y-1/2 flex items-center justify-center">
                <div
                  className="h-12 w-12 rounded-full bg-gradient-to-tr from-blue-600 via-indigo-600 to-cyan-500 p-0.5 shadow-xl shadow-blue-500/40 ring-4 ring-blue-500/20 backdrop-blur-xl transition-all duration-500 transform"
                  style={{
                    transform: `rotate(${orbRotation}deg)`,
                  }}
                >
                  <div className="h-full w-full rounded-full bg-slate-950 flex items-center justify-center text-blue-400 shadow-inner">
                    <RefreshCw
                      size={20}
                      className={`transition-all duration-500 ${isAnimating ? "animate-spin text-cyan-300" : ""}`}
                    />
                  </div>
                </div>

                {/* Pulse wave ring when animating */}
                {isAnimating && (
                  <div className="absolute h-16 w-16 rounded-full border-2 border-cyan-400/60 animate-ping" />
                )}
              </div>
            </div>
          </div>

          {/* RIGHT SIDE: Main Onboarding Form Card */}
          <div className="w-full lg:w-7/12 xl:w-8/12 flex flex-col">
            <div className="flex-1 rounded-3xl border border-slate-200/80 bg-white p-6 sm:p-8 lg:p-10 shadow-xl shadow-slate-200/50 dark:border-slate-800 dark:bg-slate-900 dark:shadow-none transition-all">
              {/* Category Selector View (Step 0) */}
              {activeStep === 0 || !employerType ? (
                <div className="space-y-6">
                  <div className="border-b border-slate-100 pb-5 dark:border-slate-800">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                      Getting Started
                    </span>
                    <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-3xl">
                      Create Your Business Profile
                    </h2>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      Select your business structure to begin the 3-step onboarding process
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {[
                      {
                        id: "REGISTERED_BUSINESS",
                        name: "Registered Business",
                        tag: "Recommended",
                        desc: "Pvt. Ltd., LLP, Partnership, or OPC entity with CIN registration",
                        icon: Building2,
                      },
                      {
                        id: "REGISTERED_INDUSTRY",
                        name: "Registered Industry",
                        tag: "Industrial",
                        desc: "Manufacturing plant, factory, or industrial enterprise",
                        icon: Factory,
                      },
                      {
                        id: "UNREGISTERED_BUSINESS",
                        name: "Unregistered Business",
                        tag: "Proprietorship",
                        desc: "Sole proprietorship, retail store, or local business unit",
                        icon: Briefcase,
                      },
                      {
                        id: "INDIVIDUAL",
                        name: "Individual Employer",
                        tag: "Personal",
                        desc: "Individual hiring directly for projects or site work",
                        icon: User,
                      },
                    ].map((type) => (
                      <button
                        key={type.id}
                        onClick={() => handleSelectType(type.id)}
                        disabled={isSubmitting || isAnimating}
                        className="group relative flex flex-col justify-between rounded-2xl border-2 border-slate-100 bg-slate-50/50 p-5 text-left transition hover:border-blue-600 hover:bg-white hover:shadow-xl hover:shadow-blue-500/5 dark:border-slate-800 dark:bg-slate-800/40 dark:hover:border-blue-500 dark:hover:bg-slate-800"
                      >
                        <div>
                          <div className="flex items-center justify-between">
                            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-600 transition group-hover:bg-blue-600 group-hover:text-white dark:bg-blue-950 dark:text-blue-400">
                              <type.icon size={22} />
                            </div>
                            <span className="rounded-full bg-slate-200/70 px-2.5 py-0.5 text-[10px] font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                              {type.tag}
                            </span>
                          </div>
                          <h3 className="mt-4 text-sm font-bold text-slate-900 dark:text-white">
                            {type.name}
                          </h3>
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 leading-relaxed font-normal">
                            {type.desc}
                          </p>
                        </div>
                        <div className="mt-4 flex items-center gap-1 text-xs font-bold text-blue-600 dark:text-blue-400">
                          <span>Select & Begin Onboarding</span>
                          <ArrowRight size={14} className="transition group-hover:translate-x-1" />
                        </div>
                      </button>
                    ))}
                  </div>

                  {formError && (
                    <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs font-semibold text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
                      {formError}
                    </div>
                  )}
                </div>
              ) : (
                /* 3-STEP FORM FLOW WITH SMOOTH ANIMATED CONTENT TRANSITIONS */
                <div className="space-y-8">
                  {/* Top Header & 3-Step Progress Indicator (Matching Reference Image) */}
                  <div className="border-b border-slate-100 pb-6 dark:border-slate-800">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-2xl">
                          Create Your Business Profile
                        </h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          Category: <span className="font-semibold text-blue-600 dark:text-blue-400">{employerType.replaceAll("_", " ")}</span>
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setFormError("");
                          transitionToStep(0, "prev");
                        }}
                        className="text-xs font-bold text-slate-500 hover:text-blue-600 transition flex items-center gap-1"
                      >
                        <Sliders size={13} />
                        Change Category
                      </button>
                    </div>

                    {/* Progress Indicator */}
                    <div className="relative pt-2 pb-1">
                      {/* Connecting Line Bar */}
                      <div className="absolute top-[22px] left-8 right-8 h-0.5 bg-slate-200 dark:bg-slate-800 z-0" />
                      <div
                        className="absolute top-[22px] left-8 h-0.5 bg-blue-600 transition-all duration-500 ease-in-out z-0"
                        style={{
                          width: employerType === "REGISTERED_INDUSTRY"
                            ? `${Math.max(0, Math.min(100, (activeStep - 1) * 25))}%`
                            : activeStep === 1 ? "0%" : activeStep === 2 ? "50%" : "calc(100% - 4rem)",
                        }}
                      />
                        {progressSteps.map((s) => {
                          const isCompleted = activeStep > s.num;
                          const isCurrent = activeStep === s.num;
                          const isClickable = activeStep > s.num;

                          return (
                            <button
                              key={s.num}
                              type="button"
                              disabled={!isClickable}
                              onClick={() => {
                                if (isClickable) {
                                  setFormError("");
                                  transitionToStep(s.num as 1 | 2 | 3 | 4 | 5, "prev");
                                }
                              }}
                              className={`flex flex-col items-center gap-2 group ${
                                isClickable ? "cursor-pointer" : "cursor-default"
                              }`}
                            >
                              <div
                                className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-extrabold transition-all duration-300 ${
                                  isCurrent
                                    ? "bg-blue-600 text-white ring-4 ring-blue-100 shadow-md shadow-blue-500/30 scale-105 dark:ring-blue-950"
                                    : isCompleted
                                    ? "bg-blue-600 text-white"
                                    : "bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500"
                                }`}
                              >
                                {isCompleted ? <Check size={16} strokeWidth={3} /> : s.num}
                              </div>

                              <span
                                className={`text-xs font-bold transition-colors ${
                                  isCurrent
                                    ? "text-blue-600 dark:text-blue-400"
                                    : isCompleted
                                    ? "text-slate-800 dark:text-slate-200"
                                    : "text-slate-400 dark:text-slate-500"
                                }`}
                              >
                                <span className="hidden sm:inline">{s.label}</span>
                                <span className="sm:hidden">{s.short}</span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                  {/* ANIMATED STEP CONTENT CONTAINER */}
                  <div
                    className={`transition-all duration-300 transform ${
                      animPhase === "exit"
                        ? transitionDirection === "next"
                          ? "-translate-x-6 opacity-0 scale-98"
                          : "translate-x-6 opacity-0 scale-98"
                        : animPhase === "enter"
                        ? transitionDirection === "next"
                          ? "translate-x-6 opacity-0 scale-98"
                          : "-translate-x-6 opacity-0 scale-98"
                        : "translate-x-0 opacity-100 scale-100"
                    }`}
                  >
                    {/* STEP 1: BUSINESS INFORMATION */}
                    {activeStep === 1 && (
                      <form onSubmit={handleProceedFromStep1} className="space-y-5">
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                          {isRegistered && (
                            <>
                              <FormField
                                label="Name of Enterprise *"
                                field="business_name"
                                value={formData.business_name}
                                onChange={updateField}
                                placeholder="Enter your enterprise name"
                                icon={Building2}
                                error={fieldErrors.business_name}
                                wide
                              />
                              {employerType === "REGISTERED_BUSINESS" && (
                                <>
                                  <SelectFormField
                                    label="Business Type *"
                                    field="business_type"
                                    value={formData.business_type}
                                    options={BUSINESS_TYPE_OPTIONS}
                                    onChange={updateField}
                                    placeholder="Select business type"
                                    customPlaceholder="Enter custom business type"
                                    icon={Tag}
                                    error={fieldErrors.business_type}
                                  />
                                  <SelectFormField
                                    label="Business Category *"
                                    field="business_category"
                                    value={formData.business_category}
                                    options={BUSINESS_CATEGORY_OPTIONS}
                                    onChange={updateField}
                                    placeholder="Select business category"
                                    customPlaceholder="Enter custom business category"
                                    icon={Briefcase}
                                    error={fieldErrors.business_category}
                                  />
                                </>
                              )}
                              {employerType === "REGISTERED_INDUSTRY" && (
                                <>
                                  <FormField
                                    label="Industry Type *"
                                    field="industry_type"
                                    value={formData.industry_type}
                                    onChange={updateField}
                                    placeholder="e.g. Heavy Manufacturing"
                                    icon={Tag}
                                    error={fieldErrors.industry_type}
                                  />
                                  <FormField
                                    label="Business Category"
                                    field="business_category"
                                    value={formData.business_category}
                                    onChange={updateField}
                                    placeholder="e.g. Construction, Infrastructure"
                                    icon={Briefcase}
                                    error={fieldErrors.business_category}
                                  />
                                  <FormField
                                    label="Industry Category *"
                                    field="industry_category"
                                    value={formData.industry_category}
                                    onChange={updateField}
                                    placeholder="e.g. Engineering & Services"
                                    icon={Briefcase}
                                    error={fieldErrors.industry_category}
                                  />
                                  <FormField
                                    label="Registered Address *"
                                    field="registered_address"
                                    value={formData.registered_address}
                                    onChange={updateField}
                                    placeholder="Full registered office address"
                                    icon={MapPin}
                                    error={fieldErrors.registered_address}
                                    wide
                                  />
                                </>
                              )}
                            </>
                          )}

                          {employerType === "UNREGISTERED_BUSINESS" && (
                            <>
                              <FormField
                                label="Name of Enterprise *"
                                field="business_name"
                                value={formData.business_name}
                                onChange={updateField}
                                placeholder="Enter your business/shop name"
                                icon={Building2}
                                error={fieldErrors.business_name}
                                wide
                              />
                              <FormField
                                label="Business Type *"
                                field="business_type"
                                value={formData.business_type}
                                onChange={updateField}
                                placeholder="e.g. Sole Proprietorship"
                                icon={Tag}
                                error={fieldErrors.business_type}
                              />
                              <FormField
                                label="Nature of Business *"
                                field="nature_of_business"
                                value={formData.nature_of_business}
                                onChange={updateField}
                                placeholder="e.g. Hardware Wholesale"
                                icon={Briefcase}
                                error={fieldErrors.nature_of_business}
                              />
                              <FormField
                                label="Number of Proprietors *"
                                field="number_of_proprietors"
                                value={formData.number_of_proprietors}
                                onChange={updateField}
                                placeholder="e.g. 2"
                                icon={Users}
                                error={fieldErrors.number_of_proprietors}
                                type="number"
                                min={1}
                              />
                              <FormField
                                label="Industry Category *"
                                field="industry_category"
                                value={formData.industry_category}
                                onChange={updateField}
                                placeholder="e.g. Trade & Services"
                                icon={Briefcase}
                                error={fieldErrors.industry_category}
                              />
                              <FormField
                                label="Business Address *"
                                field="address"
                                value={formData.address}
                                onChange={updateField}
                                placeholder="Full address of shop/office"
                                icon={MapPin}
                                error={fieldErrors.address}
                                wide
                              />
                            </>
                          )}

                          {employerType === "INDIVIDUAL" && (
                            <FormField
                              label="Primary Address *"
                              field="address"
                              value={formData.address}
                              onChange={updateField}
                              placeholder="Full site or residential address"
                              icon={MapPin}
                              error={fieldErrors.address}
                              wide
                            />
                          )}

                          <FormField
                            label="Website URL"
                            field="website_url"
                            value={formData.website_url}
                            onChange={updateField}
                            placeholder="e.g. https://yourbusiness.com"
                            icon={Globe}
                            error={fieldErrors.website_url}
                          />
                          <FormField
                            label="Annual Revenue (Approx)"
                            field="annual_revenue"
                            value={formData.annual_revenue}
                            onChange={updateField}
                            placeholder="e.g. ₹50 Lakhs - ₹1 Crore"
                            icon={TrendingUp}
                            error={fieldErrors.annual_revenue}
                          />

                          <FormField
                            label="Business Description"
                            field="description"
                            value={formData.description}
                            onChange={updateField}
                            placeholder="Briefly describe your company operations"
                            icon={FileText}
                            error={fieldErrors.description}
                            wide
                          />

                          {employerType === "REGISTERED_INDUSTRY" && (
                            <>
                              <FormField label="Company Email *" field="company_email" value={formData.company_email} onChange={updateField} placeholder="contact@enterprise.com" icon={Mail} error={fieldErrors.company_email} />
                              <FormField label="Company Phone *" field="company_phone" value={formData.company_phone} onChange={updateField} placeholder="10-digit mobile number" icon={Phone} error={fieldErrors.company_phone} />
                              <FormField label="City *" field="city" value={formData.city} onChange={updateField} placeholder="e.g. Mumbai" icon={Compass} error={fieldErrors.city} />
                              <FormField label="State *" field="state" value={formData.state} onChange={updateField} placeholder="e.g. Maharashtra" icon={Compass} error={fieldErrors.state} />
                              <FormField label="Pincode *" field="pincode" value={formData.pincode} onChange={updateField} placeholder="6-digit pincode" icon={MapPin} error={fieldErrors.pincode} />
                            </>
                          )}
                        </div>

                        {/* Security Banner Callout Box (Reference Image 3) */}
                        <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4 dark:border-blue-950 dark:bg-blue-950/30">
                          <div className="flex items-start gap-3">
                            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white shadow-xs">
                              <Shield size={14} />
                            </div>
                            <div>
                              <h4 className="text-xs font-bold text-blue-900 dark:text-blue-200">
                                Your data is 100% secure...
                              </h4>
                              <p className="text-[11px] text-blue-700/80 dark:text-blue-300/80 leading-relaxed mt-0.5">
                                We use advanced encryption to protect your enterprise information at all times.
                              </p>
                            </div>
                          </div>
                        </div>

                        {formError && (
                          <div className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs font-semibold text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
                            {formError}
                          </div>
                        )}

                        <div className="pt-2">
                          <button
                            type="submit"
                            disabled={isSubmitting || isAnimating}
                            className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-600 px-6 py-4 text-xs font-bold text-white shadow-lg shadow-blue-500/25 transition hover:from-blue-700 hover:to-indigo-700 active:scale-[0.99] disabled:opacity-50"
                          >
                            {isSubmitting ? (
                              <>
                                <Loader2 size={16} className="animate-spin" /> Saving Business Info...
                              </>
                            ) : (
                              <>
                                Continue <ArrowRight size={16} />
                              </>
                            )}
                          </button>
                        </div>
                      </form>
                    )}

                    {/* STEP 2: REGISTERED INDUSTRY LEGAL VERIFICATION */}
                    {activeStep === 2 && employerType === "REGISTERED_INDUSTRY" && (
                      <form onSubmit={handleProceedFromStep2} className="space-y-5">
                        <div className="space-y-4 rounded-2xl border border-slate-200/80 bg-slate-50/60 p-5 dark:border-slate-800 dark:bg-slate-800/40">
                          <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500">Legal Identifiers & Verification</h3>
                          {[
                            { type: "CIN", label: "CIN *", field: "cin_number", required: true },
                            { type: "GSTIN", label: "GSTIN (Optional)", field: "gstin", required: false },
                            { type: "PAN", label: "PAN (Optional)", field: "pan_number", required: false },
                            { type: "REGISTRATION_NUMBER", label: "Registration Number (Optional)", field: "registration_number", required: false },
                          ].map((item) => {
                            const record = getVerificationRecord(item.type);
                            const provided = Boolean(formData[item.field]?.trim());
                            const isVerified = record?.status === "VERIFIED";
                            return (
                              <div key={item.type} className="grid grid-cols-1 gap-2 rounded-xl border border-slate-200 p-4 sm:grid-cols-[1fr_auto] dark:border-slate-700">
                                <FormField label={item.label} field={item.field} value={formData[item.field]} onChange={updateField} placeholder={`Enter ${item.type.replaceAll("_", " ")}`} icon={CreditCard} error={fieldErrors[item.field]} readOnly={isVerified} />
                                <div className="flex items-end justify-between gap-3 sm:flex-col sm:items-end sm:justify-center">
                                  <span className={`text-xs font-bold ${isVerified ? "text-emerald-600" : "text-slate-500"}`}>Status: {provided ? record?.status || "PENDING" : "NOT PROVIDED"}</span>
                                  <button type="button" onClick={() => handleRequestVerification(item.type)} disabled={isSubmitting || !provided || isVerified} className="inline-flex items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-2 text-xs font-bold text-blue-700 disabled:opacity-50 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300">
                                    {isVerified ? <CheckCircle2 size={14} /> : <ShieldCheck size={14} />}
                                    {isVerified ? "Verified" : `Verify ${item.type}`}
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        {formError && <div className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs font-semibold text-red-700">{formError}</div>}
                        <div className="flex justify-between gap-3 pt-2">
                          <button type="button" onClick={() => transitionToStep(1, "prev")} className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3.5 text-xs font-bold text-slate-700"><ArrowLeft size={16} /> Back</button>
                          <button type="submit" disabled={isSubmitting || isAnimating || !hasVerifiedRecord(verification, "CIN")} className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-6 py-4 text-xs font-bold text-white disabled:opacity-50">Continue <ArrowRight size={16} /></button>
                        </div>
                      </form>
                    )}

                    {/* STEP 2: CONTACT / AUTHORIZED SIGNATORY */}
                    {activeStep === 2 && employerType !== "REGISTERED_INDUSTRY" && (
                      <form onSubmit={handleProceedFromStep2} className="space-y-5">
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                          {isRegistered && (
                            <>
                              <div className="sm:col-span-2 border-b border-slate-100 pb-2 dark:border-slate-800">
                                <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-400">
                                  Authorized Signatory Details
                                </h3>
                              </div>

                              <FormField
                                label="Authorized Signatory Name *"
                                field="director_name"
                                value={formData.director_name}
                                onChange={updateField}
                                placeholder="Full name as per official ID"
                                icon={User}
                                error={fieldErrors.director_name}
                              />
                              <FormField
                                label="Authorized Signatory Phone *"
                                field="director_phone"
                                value={formData.director_phone}
                                onChange={updateField}
                                placeholder="Mobile number"
                                icon={Phone}
                                error={fieldErrors.director_phone}
                              />
                              <FormField
                                label="Authorized Signatory Email *"
                                field="director_email"
                                value={formData.director_email}
                                onChange={updateField}
                                placeholder="Official email address"
                                icon={Mail}
                                error={fieldErrors.director_email}
                              />
                              {employerType !== "REGISTERED_BUSINESS" && (
                                <FormField
                                  label="Authorized Signatory Aadhaar *"
                                  field="director_aadhaar"
                                  value={formData.director_aadhaar}
                                  onChange={updateField}
                                  placeholder="12-digit Aadhaar number"
                                  icon={CreditCard}
                                  error={fieldErrors.director_aadhaar}
                                />
                              )}
                              <FormField
                                label="Authorized Signatory Address *"
                                field="director_address"
                                value={formData.director_address}
                                onChange={updateField}
                                placeholder="Personal address"
                                icon={MapPin}
                                error={fieldErrors.director_address}
                                wide
                              />
                            </>
                          )}

                          {employerType === "UNREGISTERED_BUSINESS" && (
                            <>
                              <div className="sm:col-span-2 border-b border-slate-100 pb-2 dark:border-slate-800">
                                <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-400">
                                  Proprietor Details
                                </h3>
                              </div>

                              <FormField
                                label="Proprietor Name *"
                                field="proprietor_name"
                                value={formData.proprietor_name}
                                onChange={updateField}
                                placeholder="Owner full name"
                                icon={User}
                                error={fieldErrors.proprietor_name}
                              />
                            </>
                          )}

                          <div className="sm:col-span-2 border-b border-slate-100 pb-2 pt-2 dark:border-slate-800">
                            <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-400">
                              Company Contact & Work Location
                            </h3>
                          </div>

                          <FormField
                            label="Company Email *"
                            field="company_email"
                            value={formData.company_email}
                            onChange={updateField}
                            placeholder="contact@enterprise.com"
                            icon={Mail}
                            error={fieldErrors.company_email}
                          />
                          <FormField
                            label="Company Phone *"
                            field="company_phone"
                            value={formData.company_phone}
                            onChange={updateField}
                            placeholder="10-digit mobile number"
                            icon={Phone}
                            error={fieldErrors.company_phone}
                          />

                          {isRegistered && (
                            <FormField
                              label="Registered Address"
                              field="registered_address"
                              value={formData.registered_address}
                              onChange={updateField}
                              placeholder="Full registered office address"
                              icon={MapPin}
                              error={fieldErrors.registered_address}
                              wide
                            />
                          )}

                          <FormField
                            label="City *"
                            field="city"
                            value={formData.city}
                            onChange={updateField}
                            placeholder="e.g. Mumbai"
                            icon={Compass}
                            error={fieldErrors.city}
                          />
                          <FormField
                            label="State *"
                            field="state"
                            value={formData.state}
                            onChange={updateField}
                            placeholder="e.g. Maharashtra"
                            icon={Compass}
                            error={fieldErrors.state}
                          />
                          <FormField
                            label="Pincode *"
                            field="pincode"
                            value={formData.pincode}
                            onChange={updateField}
                            placeholder="6-digit pincode"
                            icon={MapPin}
                            error={fieldErrors.pincode}
                          />

                          <div className="sm:col-span-2 space-y-1.5 pt-1">
                            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                              Primary Work Location *
                            </label>
                            <LocationPicker
                              value={formData.work_location}
                              onSelect={selectWorkLocation}
                            />
                            {fieldErrors.work_location && (
                              <p className="text-[11px] font-semibold text-red-600">{fieldErrors.work_location}</p>
                            )}
                          </div>
                        </div>

                        {/* Security Banner Callout Box */}
                        <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4 dark:border-blue-950 dark:bg-blue-950/30">
                          <div className="flex items-start gap-3">
                            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white shadow-xs">
                              <Shield size={14} />
                            </div>
                            <div>
                              <h4 className="text-xs font-bold text-blue-900 dark:text-blue-200">
                                Your contact data is protected
                              </h4>
                              <p className="text-[11px] text-blue-700/80 dark:text-blue-300/80 leading-relaxed mt-0.5">
                                Phone and email credentials are strictly encrypted and used only for candidate matching notifications.
                              </p>
                            </div>
                          </div>
                        </div>

                        {formError && (
                          <div className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs font-semibold text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
                            {formError}
                          </div>
                        )}

                        <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:justify-between">
                          <button
                            type="button"
                            onClick={() => {
                              setFormError("");
                              transitionToStep(1, "prev");
                            }}
                            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                          >
                            <ArrowLeft size={16} />
                            Back
                          </button>

                          <button
                            type="submit"
                            disabled={isSubmitting || isAnimating}
                            className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-600 px-6 py-4 text-xs font-bold text-white shadow-lg shadow-blue-500/25 transition hover:from-blue-700 hover:to-indigo-700 active:scale-[0.99] disabled:opacity-50"
                          >
                            {isSubmitting ? (
                              <>
                                <Loader2 size={16} className="animate-spin" /> Saving Contact Info...
                              </>
                            ) : (
                              <>
                                Continue <ArrowRight size={16} />
                              </>
                            )}
                          </button>
                        </div>
                      </form>
                    )}

                    {/* STEP 3: REGISTERED INDUSTRY DIRECTOR DETAILS */}
                    {activeStep === 3 && employerType === "REGISTERED_INDUSTRY" && (
                      <form onSubmit={handleProceedFromStep3} className="space-y-5">
                        <div className="grid grid-cols-1 gap-4 rounded-2xl border border-slate-200/80 bg-white p-5 sm:grid-cols-2 dark:border-slate-800 dark:bg-slate-800/40">
                          <div className="sm:col-span-2 border-b border-slate-100 pb-2 dark:border-slate-800"><h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-400">Authorized Director / Signatory</h3></div>
                          <FormField label="Authorized Director Name *" field="director_name" value={formData.director_name} onChange={updateField} placeholder="Full name as per official ID" icon={User} error={fieldErrors.director_name} />
                          <FormField label="Director Phone *" field="director_phone" value={formData.director_phone} onChange={updateField} placeholder="Mobile number" icon={Phone} error={fieldErrors.director_phone} />
                          <FormField label="Director Email *" field="director_email" value={formData.director_email} onChange={updateField} placeholder="Official email address" icon={Mail} error={fieldErrors.director_email} />
                          <FormField label="Director Address *" field="director_address" value={formData.director_address} onChange={updateField} placeholder="Personal address" icon={MapPin} error={fieldErrors.director_address} wide />
                          <FormField label="City *" field="city" value={formData.city} onChange={updateField} placeholder="e.g. Mumbai" icon={Compass} error={fieldErrors.city} />
                          <FormField label="State *" field="state" value={formData.state} onChange={updateField} placeholder="e.g. Maharashtra" icon={Compass} error={fieldErrors.state} />
                          <FormField label="Pincode *" field="pincode" value={formData.pincode} onChange={updateField} placeholder="6-digit pincode" icon={MapPin} error={fieldErrors.pincode} />
                          {(() => {
                            const record = getVerificationRecord("AADHAAR");
                            const verified = record?.status === "VERIFIED";
                            const otpSent = record?.status === "PENDING" && record.failure_reason === "OTP_SENT";
                            const failureMessage = record?.status === "FAILED" || record?.status === "NOT_CONFIGURED"
                              ? getVerificationFailureMessage("AADHAAR", record.failure_reason, record, formData.business_name || "")
                              : "";
                            return (
                              <div className="sm:col-span-2 space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                                <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-500">Director Verification</h4>
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                                  <FormField label={`Director Aadhaar for ${formData.director_name || "Authorized Director"} *`} field="director_aadhaar" value={formData.director_aadhaar} onChange={updateField} placeholder="12-digit Aadhaar number" icon={CreditCard} error={fieldErrors.director_aadhaar} readOnly={verified} />
                                  <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end">
                                    <span className={`text-xs font-bold ${verified ? "text-emerald-600" : record?.status === "FAILED" || record?.status === "NOT_CONFIGURED" ? "text-red-600" : "text-slate-500"}`}>
                                      {verified ? "✓" : record?.status === "FAILED" ? "❌" : ""} Director Aadhaar {record?.failure_reason === "OTP_SENT" ? "OTP SENT / AWAITING OTP" : getVerificationStatus(record, Boolean(formData.director_aadhaar?.trim()))}
                                    </span>
                                    {failureMessage && <span className="max-w-xs text-right text-xs font-semibold text-red-600">{failureMessage}</span>}
                                    {otpSent && (
                                      <span className="max-w-xs text-right text-xs font-semibold text-blue-700">
                                        OTP sent successfully. Enter the OTP sent to the Aadhaar-linked mobile number.
                                      </span>
                                    )}
                                    {otpSent && (
                                      <div className="flex items-center gap-2">
                                        <input
                                          value={aadhaarOtp}
                                          onChange={(event) => setAadhaarOtp(event.target.value.replace(/\D/g, "").slice(0, 8))}
                                          inputMode="numeric"
                                          autoComplete="one-time-code"
                                          placeholder="OTP"
                                          aria-label="Aadhaar OTP"
                                          className="w-24 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold dark:border-slate-700 dark:bg-slate-900"
                                        />
                                        <button
                                          type="button"
                                          onClick={handleVerifyAadhaarOtp}
                                          disabled={isSubmitting || !aadhaarOtp.trim()}
                                          className="inline-flex items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-2 text-xs font-bold text-blue-700 disabled:opacity-50 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300"
                                        >
                                          <ShieldCheck size={14} /> Verify OTP
                                        </button>
                                      </div>
                                    )}
                                    <button type="button" onClick={() => handleRequestVerification("AADHAAR")} disabled={isSubmitting || !/^\d{12}$/.test(formData.director_aadhaar || "") || verified} className="inline-flex items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-2 text-xs font-bold text-blue-700 disabled:opacity-50"><ShieldCheck size={14} /> {verified ? "Verified" : record?.status === "FAILED" ? "Verify Again" : "Verify Aadhaar"}</button>
                                  </div>
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                        {formError && <div className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs font-semibold text-red-700">{formError}</div>}
                        <div className="flex justify-between gap-3 pt-2">
                          <button type="button" onClick={() => transitionToStep(2, "prev")} className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3.5 text-xs font-bold text-slate-700"><ArrowLeft size={16} /> Back</button>
                          <button type="submit" disabled={isSubmitting || isAnimating} className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-6 py-4 text-xs font-bold text-white disabled:opacity-50">Continue <ArrowRight size={16} /></button>
                        </div>
                      </form>
                    )}

                    {/* STEP 4: VERIFICATION & REGISTRATION */}
                    {activeStep === 3 && employerType !== "REGISTERED_INDUSTRY" && (
                      <div className="space-y-6">
                        {/* Legal Numbers Input & Verification Action */}
                        <div className="space-y-4 rounded-2xl border border-slate-200/80 bg-slate-50/60 p-5 dark:border-slate-800 dark:bg-slate-800/40">
                          <div className="flex items-center justify-between border-b border-slate-200/60 pb-3 dark:border-slate-700">
                            <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
                              Legal Identifiers & Verification
                            </h3>
                            <span className="text-[11px] font-bold text-blue-600">KYC Status Check</span>
                          </div>

                          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            {employerType === "UNREGISTERED_BUSINESS" && (() => {
                              const record = getVerificationRecord("AADHAAR");
                              const provided = Boolean(formData.proprietor_aadhaar?.trim());
                              const verified = record?.status === "VERIFIED";
                              const otpSent = record?.status === "PENDING" && record.failure_reason === "OTP_SENT";
                              const failureMessage = record?.status === "FAILED" || record?.status === "NOT_CONFIGURED"
                                ? getVerificationFailureMessage("AADHAAR", record.failure_reason, record, formData.proprietor_name || "")
                                : "";
                              return (
                                <div className="sm:col-span-2 grid grid-cols-1 gap-3 rounded-xl border border-slate-200 p-4 sm:grid-cols-[1fr_auto] sm:items-end dark:border-slate-700">
                                  <FormField
                                    label="Proprietor Aadhaar *"
                                    field="proprietor_aadhaar"
                                    value={formData.proprietor_aadhaar}
                                    onChange={updateField}
                                    placeholder="12-digit Aadhaar number"
                                    icon={CreditCard}
                                    error={fieldErrors.proprietor_aadhaar}
                                    readOnly={verified}
                                  />
                                  <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end">
                                    <span className={`text-xs font-bold ${verified ? "text-emerald-600" : record?.status === "FAILED" || record?.status === "NOT_CONFIGURED" ? "text-red-600" : "text-slate-500"}`}>
                                      {verified ? "✓" : record?.status === "FAILED" ? "❌" : ""} Proprietor Aadhaar {record?.failure_reason === "OTP_SENT" ? "OTP SENT / AWAITING OTP" : getVerificationStatus(record, provided)}
                                    </span>
                                    {failureMessage && (
                                      <span className="max-w-xs text-right text-xs font-semibold text-red-600">{failureMessage}</span>
                                    )}
                                    {otpSent && (
                                      <span className="max-w-xs text-right text-xs font-semibold text-blue-700">
                                        OTP sent successfully. Enter the OTP sent to the Aadhaar-linked mobile number.
                                      </span>
                                    )}
                                    {otpSent && (
                                      <div className="flex items-center gap-2">
                                        <input
                                          value={aadhaarOtp}
                                          onChange={(event) => setAadhaarOtp(event.target.value.replace(/\D/g, "").slice(0, 8))}
                                          inputMode="numeric"
                                          autoComplete="one-time-code"
                                          placeholder="OTP"
                                          aria-label="Aadhaar OTP"
                                          className="w-24 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold dark:border-slate-700 dark:bg-slate-900"
                                        />
                                        <button
                                          type="button"
                                          onClick={handleVerifyAadhaarOtp}
                                          disabled={isSubmitting || !aadhaarOtp.trim()}
                                          className="inline-flex items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-2 text-xs font-bold text-blue-700 disabled:opacity-50 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300"
                                        >
                                          <ShieldCheck size={14} /> Verify OTP
                                        </button>
                                      </div>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => handleRequestVerification("AADHAAR")}
                                      disabled={isSubmitting || !/^\d{12}$/.test(formData.proprietor_aadhaar || "") || verified}
                                      className="inline-flex items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-2 text-xs font-bold text-blue-700 disabled:opacity-50 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300"
                                    >
                                      {verified ? <CheckCircle2 size={14} /> : <ShieldCheck size={14} />}
                                      {verified ? "Verified" : record?.status === "FAILED" ? "Verify Again" : "Verify Aadhaar"}
                                    </button>
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                        </div>

                        {employerType === "REGISTERED_BUSINESS" && (
                          <div className="space-y-3 rounded-2xl border border-slate-200/80 bg-white p-5 dark:border-slate-800 dark:bg-slate-800/40">
                            <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500">Registered Business Verification</h3>
                            {[
                              { type: "CIN", label: "CIN *", field: "cin_number", supported: true },
                              { type: "GSTIN", label: "GSTIN (Optional)", field: "gstin", supported: true },
                              { type: "PAN", label: "PAN (Optional)", field: "pan_number", supported: true },
                              { type: "REGISTRATION_NUMBER", label: "Registration Number (Optional)", field: "registration_number", supported: false },
                              { type: "AADHAAR", label: "Authorized Signatory Aadhaar *", field: "director_aadhaar", supported: true },
                            ].map((item) => {
                              const record = getVerificationRecord(item.type);
                              const provided = Boolean(formData[item.field]?.trim());
                              const verified = record?.status === "VERIFIED";
                              const displayStatus = !item.supported
                                ? "NOT SUPPORTED"
                                : record?.failure_reason === "OTP_SENT"
                                ? "OTP SENT / AWAITING OTP"
                                : getVerificationStatus(record, provided);
                              const failureMessage = record?.status === "FAILED" || record?.status === "NOT_CONFIGURED"
                                ? getVerificationFailureMessage(item.type, record.failure_reason, record, formData.business_name || "")
                                : "";
                              const otpSent = item.type === "AADHAAR" && record?.status === "PENDING" && record.failure_reason === "OTP_SENT";
                              return (
                                <div key={item.type} className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 p-4 sm:grid-cols-[1fr_auto] sm:items-end dark:border-slate-700">
                                  <FormField
                                    label={item.label}
                                    field={item.field}
                                    value={formData[item.field]}
                                    onChange={updateField}
                                    placeholder={item.type === "AADHAAR" ? "12-digit Aadhaar number" : `Enter ${item.type.replaceAll("_", " ")}`}
                                    icon={CreditCard}
                                    error={fieldErrors[item.field]}
                                    readOnly={verified}
                                  />
                                  <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end">
                                    <span className={`text-xs font-bold ${verified ? "text-emerald-600" : record?.status === "FAILED" || record?.status === "NOT_CONFIGURED" ? "text-red-600" : "text-slate-500"}`}>
                                      {verified ? "✓" : record?.status === "FAILED" ? "❌" : ""} {item.type === "AADHAAR" ? "Authorized Signatory Aadhaar" : item.type} {displayStatus}
                                    </span>
                                    {failureMessage && (
                                      <span className="max-w-xs text-right text-xs font-semibold text-red-600">
                                        {failureMessage}
                                      </span>
                                    )}
                                    {otpSent && (
                                      <span className="max-w-xs text-right text-xs font-semibold text-blue-700">
                                        OTP sent successfully. Enter the OTP sent to the Aadhaar-linked mobile number.
                                      </span>
                                    )}
                                    {otpSent && (
                                      <div className="flex items-center gap-2">
                                        <input
                                          value={aadhaarOtp}
                                          onChange={(event) => setAadhaarOtp(event.target.value.replace(/\D/g, "").slice(0, 8))}
                                          inputMode="numeric"
                                          autoComplete="one-time-code"
                                          placeholder="OTP"
                                          aria-label="Aadhaar OTP"
                                          className="w-24 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold dark:border-slate-700 dark:bg-slate-900"
                                        />
                                        <button
                                          type="button"
                                          onClick={handleVerifyAadhaarOtp}
                                          disabled={isSubmitting || !aadhaarOtp.trim()}
                                          className="inline-flex items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-2 text-xs font-bold text-blue-700 disabled:opacity-50 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300"
                                        >
                                          <ShieldCheck size={14} /> Verify OTP
                                        </button>
                                      </div>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => handleRequestVerification(item.type)}
                                      disabled={isSubmitting || !provided || !item.supported || verified}
                                      className="inline-flex items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-2 text-xs font-bold text-blue-700 disabled:opacity-50 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300"
                                    >
                                      {verified ? <CheckCircle2 size={14} /> : <ShieldCheck size={14} />}
                                      {verified ? "Verified" : record?.status === "FAILED" ? "Verify Again" : `Verify ${item.type === "AADHAAR" ? "Aadhaar" : item.type}`}
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Document Verification Items */}
                        {verification.required.length > 0 && employerType !== "REGISTERED_BUSINESS" && employerType !== "UNREGISTERED_BUSINESS" && (
                          <div className="space-y-3 rounded-2xl border border-slate-200/80 bg-white p-5 dark:border-slate-800 dark:bg-slate-800/40">
                            <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
                              Document Verification Mapping
                            </h3>

                            {verification.required.map((type) => {
                              const record = getVerificationRecord(type);
                              const isVerifiedRecord = record?.status === "VERIFIED";

                              return (
                                <div
                                  key={type}
                                  className="flex flex-col gap-3 rounded-xl border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800"
                                >
                                  <div>
                                    <p className="text-xs font-bold text-slate-900 dark:text-slate-100">
                                      Document: {type.replaceAll("_", " ")}
                                    </p>
                                    <p
                                      className={`text-xs ${
                                        isVerifiedRecord
                                          ? "text-emerald-600 font-bold"
                                          : record?.status === "FAILED"
                                          ? "text-red-600"
                                          : "text-slate-500"
                                      }`}
                                    >
                                      Status: {record?.status || "PENDING"}
                                    </p>
                                  </div>

                                  {!isVerifiedRecord && (
                                    <button
                                      type="button"
                                      onClick={() => handleRequestVerification(type)}
                                      disabled={isSubmitting}
                                      className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-2 text-xs font-bold text-blue-700 transition hover:bg-blue-100 disabled:opacity-50 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300"
                                    >
                                      {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : null}
                                      {record?.status === "FAILED" ? "Retry Verification" : "Verify Document"}
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Summary Confirmation Box */}
                        <div className="space-y-3 rounded-2xl border border-slate-200/80 bg-slate-50/60 p-5 dark:border-slate-800 dark:bg-slate-800/40">
                          <div className="flex items-center justify-between border-b border-slate-200/60 pb-3 dark:border-slate-700">
                            <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
                              Profile Summary Confirmation
                            </h3>
                            <span className="text-[10px] font-semibold text-slate-400">Ready to Submit</span>
                          </div>

                          <div className="grid grid-cols-1 gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
                            <div className="flex justify-between py-1 border-b border-slate-200/40 dark:border-slate-700/40">
                              <span className="text-slate-500">Category:</span>
                              <span className="font-bold text-slate-900 dark:text-white">
                                {employerType.replaceAll("_", " ")}
                              </span>
                            </div>

                            <div className="flex justify-between py-1 border-b border-slate-200/40 dark:border-slate-700/40">
                              <span className="text-slate-500">Enterprise Name:</span>
                              <span className="font-bold text-slate-900 dark:text-white">
                                {formData.business_name || "N/A"}
                              </span>
                            </div>

                            <div className="flex justify-between py-1 border-b border-slate-200/40 dark:border-slate-700/40">
                              <span className="text-slate-500">Email:</span>
                              <span className="font-bold text-slate-900 dark:text-white">
                                {formData.company_email || "N/A"}
                              </span>
                            </div>

                            <div className="flex justify-between py-1 border-b border-slate-200/40 dark:border-slate-700/40">
                              <span className="text-slate-500">Phone:</span>
                              <span className="font-bold text-slate-900 dark:text-white">
                                {formData.company_phone || "N/A"}
                              </span>
                            </div>

                            <div className="flex justify-between py-1 border-b border-slate-200/40 dark:border-slate-700/40">
                              <span className="text-slate-500">City / State:</span>
                              <span className="font-bold text-slate-900 dark:text-white">
                                {formData.city ? `${formData.city}, ${formData.state || ""}` : "N/A"}
                              </span>
                            </div>

                            <div className="flex justify-between py-1 border-b border-slate-200/40 dark:border-slate-700/40">
                              <span className="text-slate-500">Work Location:</span>
                              <span className="font-bold text-slate-900 dark:text-white truncate max-w-[170px]">
                                {formData.work_location || "N/A"}
                              </span>
                            </div>
                          </div>
                        </div>

                        {formError && (
                          <div className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs font-semibold text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
                            {formError}
                          </div>
                        )}

                        <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:justify-between">
                          <button
                            type="button"
                            onClick={() => {
                              setFormError("");
                              transitionToStep(2, "prev");
                            }}
                            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                          >
                            <ArrowLeft size={16} />
                            Back
                          </button>

                          <button
                            type="button"
                            onClick={handleComplete}
                            disabled={isSubmitting || isAnimating}
                            className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-600 px-7 py-4 text-xs font-bold text-white shadow-xl shadow-blue-500/30 transition hover:from-blue-700 hover:to-indigo-700 active:scale-[0.99] disabled:opacity-50"
                          >
                            {isSubmitting ? (
                              <>
                                <Loader2 size={16} className="animate-spin" /> Completing Onboarding...
                              </>
                            ) : (
                              <>
                                Verify & Complete Onboarding <CheckCircle2 size={16} />
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    )}

                    {activeStep === 4 && employerType === "REGISTERED_INDUSTRY" && (
                      <div className="space-y-6">
                        <div className="space-y-3 rounded-2xl border border-slate-200/80 bg-white p-5 dark:border-slate-800 dark:bg-slate-800/40">
                          <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500">Work Location</h3>
                          <LocationPicker value={formData.work_location} onSelect={selectWorkLocation} />
                          {fieldErrors.work_location && <p className="text-[11px] font-semibold text-red-600">{fieldErrors.work_location}</p>}
                        </div>
                        {formError && <div className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs font-semibold text-red-700">{formError}</div>}
                        <div className="flex justify-between gap-3 pt-2">
                          <button type="button" onClick={() => transitionToStep(3, "prev")} className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3.5 text-xs font-bold text-slate-700"><ArrowLeft size={16} /> Back</button>
                          <button type="button" onClick={handleComplete} disabled={isSubmitting || isAnimating} className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-6 py-4 text-xs font-bold text-white disabled:opacity-50">
                            {isSubmitting ? <><Loader2 size={16} className="animate-spin" /> Completing Onboarding...</> : <>Complete Onboarding <CheckCircle2 size={16} /></>}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function FormField({
  label,
  field,
  value,
  onChange,
  placeholder = "",
  icon: Icon,
  error,
  wide = false,
  readOnly = false,
  type = "text",
  min,
}: {
  label: string;
  field: string;
  value?: string;
  onChange: (field: string, value: string) => void;
  placeholder?: string;
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  error?: string;
  wide?: boolean;
  readOnly?: boolean;
  type?: "text" | "number";
  min?: number;
}) {
  return (
    <label className={`space-y-1.5 ${wide ? "sm:col-span-2" : ""}`}>
      <span className="block text-xs font-bold text-slate-700 dark:text-slate-300">
        {label}
      </span>
      <div className="relative">
        {Icon && (
          <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
            <Icon size={16} />
          </div>
        )}
        <input
          type={type}
          value={value || ""}
          min={min}
          readOnly={readOnly}
          placeholder={placeholder}
          onChange={(event) => onChange(field, event.target.value)}
          className={`w-full rounded-2xl border ${
            error
              ? "border-red-400 ring-2 ring-red-100 dark:border-red-700 dark:ring-red-950"
              : "border-slate-200/90 dark:border-slate-700"
          } ${Icon ? "pl-10" : "pl-4"} pr-4 py-3 text-xs font-medium text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100 dark:bg-slate-800/80 dark:text-slate-100 dark:focus:ring-blue-900/40 ${
            readOnly
              ? "bg-slate-100 cursor-not-allowed opacity-80 dark:bg-slate-800/80"
              : "bg-slate-50/50 dark:bg-slate-900/80"
          }`}
        />
      </div>
      {error && <p className="text-[11px] font-semibold text-red-600 mt-1">{error}</p>}
    </label>
  );
}

function SelectFormField({
  label,
  field,
  value,
  options,
  onChange,
  placeholder = "Select an option",
  customPlaceholder = "Enter custom value",
  icon: Icon,
  error,
  wide = false,
}: {
  label: string;
  field: string;
  value?: string;
  options: string[];
  onChange: (field: string, value: string) => void;
  placeholder?: string;
  customPlaceholder?: string;
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  error?: string;
  wide?: boolean;
}) {
  const isPresetOption = options.includes(value || "");
  const isOtherSelected = value !== undefined && value !== "" && !isPresetOption;
  const [showOtherInput, setShowOtherInput] = useState(isOtherSelected);

  useEffect(() => {
    if (value && !options.includes(value)) {
      setShowOtherInput(true);
    } else if (value && options.includes(value) && value !== "Other") {
      setShowOtherInput(false);
    }
  }, [value, options]);

  const selectValue = showOtherInput ? "Other" : isPresetOption ? value || "" : "";

  const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selected = e.target.value;
    if (selected === "Other") {
      setShowOtherInput(true);
      if (isPresetOption) {
        onChange(field, "");
      }
    } else {
      setShowOtherInput(false);
      onChange(field, selected);
    }
  };

  return (
    <div className={`space-y-1.5 ${wide ? "sm:col-span-2" : ""}`}>
      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
        {label}
      </label>
      <div className="relative">
        {Icon && (
          <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none z-10">
            <Icon size={16} />
          </div>
        )}
        <select
          value={selectValue}
          onChange={handleSelectChange}
          className={`w-full appearance-none rounded-2xl border ${
            error
              ? "border-red-400 ring-2 ring-red-100 dark:border-red-700 dark:ring-red-950"
              : "border-slate-200/90 dark:border-slate-700"
          } ${Icon ? "pl-10" : "pl-4"} pr-10 py-3 text-xs font-medium text-slate-900 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100 dark:bg-slate-900 dark:text-slate-100 dark:focus:ring-blue-900/40 bg-slate-50/50 cursor-pointer`}
        >
          <option value="" disabled className="text-slate-400 dark:bg-slate-900">
            {placeholder}
          </option>
          {options.map((opt) => (
            <option key={opt} value={opt} className="text-slate-900 dark:bg-slate-900 dark:text-slate-100">
              {opt}
            </option>
          ))}
        </select>
        <div className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none z-10">
          <ChevronRight size={16} className="rotate-90" />
        </div>
      </div>

      {showOtherInput && (
        <div className="pt-1.5">
          <input
            type="text"
            value={value || ""}
            placeholder={customPlaceholder}
            onChange={(e) => onChange(field, e.target.value)}
            className={`w-full rounded-2xl border ${
              error
                ? "border-red-400 ring-2 ring-red-100 dark:border-red-700 dark:ring-red-950"
                : "border-blue-300 dark:border-blue-700"
            } px-4 py-3 text-xs font-medium text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100 dark:bg-slate-800/80 dark:text-slate-100 dark:focus:ring-blue-900/40 bg-white`}
          />
        </div>
      )}

      {error && <p className="text-[11px] font-semibold text-red-600 mt-1">{error}</p>}
    </div>
  );
}
