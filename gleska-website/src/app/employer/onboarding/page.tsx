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
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

type EmployerType =
  | "REGISTERED_INDUSTRY"
  | "REGISTERED_BUSINESS"
  | "UNREGISTERED_BUSINESS"
  | "INDIVIDUAL";

type OnboardingFormData = Record<string, string>;

type VerificationRecord = {
  verification_type: string;
  status: "PENDING" | "VERIFIED" | "FAILED" | "NOT_CONFIGURED";
  failure_reason?: string | null;
  provider_reference_id?: string | null;
  verified_at?: string | null;
  provider_metadata?: Record<string, unknown> | null;
};

type VerificationState = {
  required: string[];
  records: VerificationRecord[];
};

const REQUIRED_FIELDS: Record<EmployerType, string[]> = {
  REGISTERED_INDUSTRY: ["industry_type", "industry_category", "registered_address", "company_email", "company_phone", "city", "state", "pincode", "work_location"],
  REGISTERED_BUSINESS: ["business_name", "business_type", "industry_category", "registered_address", "company_email", "company_phone", "city", "state", "pincode", "work_location"],
  UNREGISTERED_BUSINESS: ["business_name", "business_type", "nature_of_business", "number_of_proprietors", "company_email", "company_phone", "proprietor_name", "proprietor_aadhaar", "industry_category", "address", "city", "state", "pincode", "work_location"],
  INDIVIDUAL: ["address", "company_email", "company_phone", "city", "state", "pincode", "work_location"],
};

const LEGAL_VERIFICATION_TYPES = new Set(["CIN", "GSTIN", "PAN", "REGISTRATION_NUMBER", "UDYAM", "AADHAAR"]);

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
  if (detail && typeof detail === "object" && "code" in detail) {
    return String((detail as { code: unknown }).code);
  }
  return candidate.message || fallback;
}

function hasCompleteDetails(type: EmployerType, details: Record<string, unknown>): boolean {
  return requiredFieldsFor(type).every((field) => {
    const value = details[field];
    return value !== null && value !== undefined && String(value).trim() !== "";
  });
}

function maskAadhaar(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length === 12 ? `XXXX XXXX ${digits.slice(-4)}` : "Masked";
}

function hasVerifiedLegalIdentity(verification: VerificationState): boolean {
  const requiredIdentityTypes = verification.required.filter((type) => LEGAL_VERIFICATION_TYPES.has(type));
  return requiredIdentityTypes.length === 0 || requiredIdentityTypes.every((type) =>
    verification.records.some((record) => record.verification_type === type && record.status === "VERIFIED"),
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
  "udyam_number",
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
];

export default function EmployerOnboarding() {
  const router = useRouter();
  const { user, isLoading, nextStep, logout, refreshUser } = useAuth();

  const [step, setStep] = useState<"type" | "identity" | "details" | "verification" | "review">("type");
  const [employerType, setEmployerType] = useState<EmployerType | "">("");
  const [formData, setFormData] = useState<OnboardingFormData>({});
  const [formError, setFormError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isHydrating, setIsHydrating] = useState(true);
  const [verification, setVerification] = useState<VerificationState>({ required: [], records: [] });

  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/employer/auth");
    }

    if (!isLoading && user && user.role !== "EMPLOYER") {
      router.push("/");
    }

    // If onboarding is complete, redirect to dashboard
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
          ONBOARDING_FIELDS
            .filter((field) => details[field] !== null && details[field] !== undefined)
            .map((field) => [field, String(details[field])]),
        );
          if (!savedFormData.company_email && user.email) savedFormData.company_email = user.email;
          if (!savedFormData.company_phone && user.mobile) savedFormData.company_phone = user.mobile;

        if (employer?.employer_type) {
          setEmployerType(employer.employer_type as EmployerType);
          setFormData(savedFormData);
          setVerification({
            required: savedVerification.required || [],
            records: savedVerification.records || [],
          });
          const selectedType = employer.employer_type as EmployerType;
          const loadedVerification = {
            required: savedVerification.required || [],
            records: savedVerification.records || [],
          };
          const savedDetailsComplete = hasCompleteDetails(selectedType, details);
          const requiredTypes = loadedVerification.required;
          const savedVerificationComplete = requiredTypes.length === 0
            || requiredTypes.every((type: string) => savedVerification.records?.some(
              (record: VerificationRecord) => record.verification_type === type && record.status === "VERIFIED",
            ));
          setStep(
            nextStep === "DASHBOARD"
              ? "type"
              : !hasVerifiedLegalIdentity(loadedVerification) && selectedType !== "INDIVIDUAL"
                ? "identity"
              : !savedDetailsComplete
                ? "details"
                : savedVerificationComplete
                  ? "review"
                  : "verification",
          );
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
  }, [isLoading, user, nextStep]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#eef1fb] dark:bg-slate-950">
        <div className="flex flex-col items-center gap-4">
          <Loader2 size={40} className="animate-spin text-blue-600" />
          <p className="text-slate-600 dark:text-slate-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user || isHydrating) {
    return null;
  }

  const handleSelectType = async (type: string) => {
    if (isSubmitting) return;
    setFormError("");
    setIsSubmitting(true);
    try {
      await apiClient.post("/api/v1/employers/onboarding/type", {
        employer_type: type as EmployerType,
      });
      const verificationResponse = await apiClient.get("/api/v1/employers/onboarding/verifications", { withCredentials: true });
      const nextVerification = { required: verificationResponse.data?.required || [], records: verificationResponse.data?.records || [] };
      setVerification(nextVerification);
      setEmployerType(type as EmployerType);
      setFormData((current) => ({
        ...current,
        company_email: user.email || current.company_email || "",
        company_phone: user.mobile || current.company_phone || "",
      }));
      setStep(type !== "INDIVIDUAL" && !hasVerifiedLegalIdentity(nextVerification) ? "identity" : "details");
      toast.success("Employer type selected");
    } catch (err: unknown) {
      const message = getErrorDetail(err, "Failed to select type");
      setFormError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateField = (field: string, value: string) => {
    setFormData((current) => ({ ...current, [field]: value }));
    setFormError("");
  };

  const endpointByType: Record<EmployerType, string> = {
    REGISTERED_INDUSTRY: "/api/v1/employers/onboarding/registered-industry",
    REGISTERED_BUSINESS: "/api/v1/employers/onboarding/registered-business",
    UNREGISTERED_BUSINESS: "/api/v1/employers/onboarding/unregistered-business",
    INDIVIDUAL: "/api/v1/employers/onboarding/individual",
  };

  const validateDetails = () => {
    if (!employerType) return "Select an employer type first";

    const missingField = REQUIRED_FIELDS[employerType].find(
      (field) => !formData[field]?.trim(),
    );
    if (missingField) return `${missingField.replaceAll("_", " ")} is required`;
    if (!/^\d{6}$/.test(formData.pincode || "")) return "pincode must be a valid 6-digit number";
    return "";
  };

  const validateIdentity = () => {
    if (employerType === "REGISTERED_INDUSTRY") {
      if (!formData.business_name?.trim()) return "Legal / company name is required before verification";
      if (!formData.cin_number?.trim()) return "CIN is required before verification";
    }
    const missingType = verification.required.find((type) => {
      if (!LEGAL_VERIFICATION_TYPES.has(type)) return false;
      const field = type === "CIN" ? "cin_number"
        : type === "GSTIN" ? "gstin"
          : type === "PAN" ? "pan_number"
            : type === "UDYAM" ? "udyam_number"
              : type === "AADHAAR" ? "proprietor_aadhaar"
                : "registration_number";
      return !formData[field]?.trim();
    });
    return missingType ? `${missingType.replaceAll("_", " ")} is required before verification` : "";
  };

  const buildPayload = () => Object.fromEntries(
    Object.entries(formData).filter(([, value]) => value.trim() !== ""),
  );

  const handleSaveDetails = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSubmitting) return;
    const validationError = validateDetails();
    if (validationError) {
      const message = validationError;
      setFormError(message);
      toast.error(message);
      return;
    }

    setFormError("");
    setIsSubmitting(true);
    try {
      const selectedType = employerType;
      if (!selectedType) return;
      await apiClient.put(endpointByType[selectedType], buildPayload(), {
        withCredentials: true,
      });
      const verificationResponse = await apiClient.get("/api/v1/employers/onboarding/verifications", {
        withCredentials: true,
      });
      setVerification({
        required: verificationResponse.data?.required || [],
        records: verificationResponse.data?.records || [],
      });
      setStep((verificationResponse.data?.required || []).length > 0 ? "verification" : "review");
      toast.success("Details saved. Review before submitting.");
    } catch (err: unknown) {
      const message = getErrorDetail(err, "Failed to save onboarding details");
      setFormError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveIdentity = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSubmitting) return;
    const validationError = validateIdentity();
    if (validationError) {
      setFormError(validationError);
      toast.error(validationError);
      return;
    }
    setIsSubmitting(true);
    setFormError("");
    try {
      await apiClient.put("/api/v1/employers/onboarding/legal-identity", buildPayload(), { withCredentials: true });
      const response = await apiClient.get("/api/v1/employers/onboarding/verifications", { withCredentials: true });
      setVerification({ required: response.data?.required || [], records: response.data?.records || [] });
      setStep("verification");
    } catch (err: unknown) {
      const message = getErrorDetail(err, "Unable to save legal identity");
      setFormError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const getVerificationRecord = (type: string) =>
    verification.records.find((record) => record.verification_type === type);

  const handleRequestVerification = async (type: string) => {
    if (isSubmitting) return;
    setFormError("");
    setIsSubmitting(true);
    try {
      const response = await apiClient.post(`/api/v1/employers/onboarding/verifications/${type}`, {}, {
        withCredentials: true,
      });
      const record = response.data as VerificationRecord;
      setVerification((current) => ({
        ...current,
        records: [
          ...current.records.filter((item) => item.verification_type !== type),
          record,
        ],
      }));
      const nextRecords = [
        ...verification.records.filter((item) => item.verification_type !== type),
        record,
      ];
      if (hasVerifiedLegalIdentity({ ...verification, records: nextRecords })) setStep("details");
      toast.success(`${type.replaceAll("_", " ")} verification ${record.status.toLowerCase()}`);
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } }).response?.data?.detail;
      const record = detail && typeof detail === "object" && "verification" in detail
        ? (detail as { verification?: VerificationRecord }).verification
        : undefined;
      if (record) {
        setVerification((current) => ({
          ...current,
          records: [
            ...current.records.filter((item) => item.verification_type !== type),
            record,
          ],
        }));
      }
      const detailCode = detail && typeof detail === "object" && "code" in detail
        ? String((detail as { code: unknown }).code)
        : "";
      const message = detailCode === "VERIFICATION_PROVIDER_NOT_CONFIGURED"
        ? "Verification is unavailable until the provider is configured. It was not completed."
        : getErrorDetail(err, "Verification failed");
      setFormError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleComplete = async () => {
    if (isSubmitting) return;
    setFormError("");
    setIsSubmitting(true);
    try {
      await apiClient.post("/api/v1/employers/onboarding/complete", {});
      await refreshUser();
      const refreshedState = await apiClient.get("/api/v1/auth/me", {
        withCredentials: true,
      });
      const refreshedNextStep = refreshedState.data?.next_step;

      if (refreshedNextStep !== "DASHBOARD") {
        throw new Error(
          `Onboarding completed but session state is ${refreshedNextStep || "unknown"}. Please refresh and try again.`,
        );
      }

      toast.success("Onboarding completed!");
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
      <main className="mx-auto max-w-4xl px-6 py-12">
        {/* Step Indicator */}
        <div className="mb-12 flex items-center justify-center gap-4">
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-full font-bold ${
              step === "type" || step === "details" || step === "verification" || step === "review"
                ? "bg-linear-to-br from-blue-600 to-blue-700 text-white"
                : "bg-slate-200 text-slate-600 dark:bg-slate-700"
            }`}
          >
            1
          </div>
          <div className="h-1 w-12 bg-slate-200 dark:bg-slate-700"></div>
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-full font-bold ${
              step === "details" || step === "verification" || step === "review"
                ? "bg-linear-to-br from-blue-600 to-blue-700 text-white"
                : "bg-slate-200 text-slate-600 dark:bg-slate-700"
            }`}
          >
            2
          </div>
          <div className="h-1 w-12 bg-slate-200 dark:bg-slate-700"></div>
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-full font-bold ${
              step === "verification" || step === "review"
                ? "bg-linear-to-br from-blue-600 to-blue-700 text-white"
                : "bg-slate-200 text-slate-600 dark:bg-slate-700"
            }`}
          >
            3
          </div>
          <div className="h-1 w-12 bg-slate-200 dark:bg-slate-700"></div>
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-full font-bold ${
              step === "review"
                ? "bg-linear-to-br from-blue-600 to-blue-700 text-white"
                : "bg-slate-200 text-slate-600 dark:bg-slate-700"
            }`}
          >
            4
          </div>
        </div>

        {/* Content */}
        {step === "type" && (
          <div className="space-y-8">
            <div className="text-center">
              <h1 className="font-(--font-anton) text-4xl uppercase text-slate-900 dark:text-white">
                What type of employer are you?
              </h1>
              <p className="mt-3 text-lg text-slate-600 dark:text-slate-400">
                Select your business structure to get started
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {[
                {
                  id: "REGISTERED_INDUSTRY",
                  name: "Registered Industry",
                  desc: "Large factory, manufacturing, or industrial facility",
                  icon: Factory,
                },
                {
                  id: "REGISTERED_BUSINESS",
                  name: "Registered Business",
                  desc: "Pvt. Ltd., Partnership, or other registered entity",
                  icon: Building2,
                },
                {
                  id: "UNREGISTERED_BUSINESS",
                  name: "Unregistered Business",
                  desc: "Sole proprietorship or informal business",
                  icon: User,
                },
                {
                  id: "INDIVIDUAL",
                  name: "Individual Employer",
                  desc: "Personal hiring for one-off projects",
                  icon: User,
                },
              ].map((type) => (
                <button
                  key={type.id}
                  onClick={() => handleSelectType(type.id)}
                  disabled={isSubmitting}
                  className="group rounded-2xl border-2 border-slate-200 bg-white p-6 text-left transition hover:border-blue-500 hover:shadow-lg dark:border-slate-800 dark:bg-slate-900 dark:hover:border-blue-500"
                >
                  <div className="flex items-start gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-blue-50 group-hover:bg-blue-100 dark:bg-blue-950">
                      <type.icon size={24} className="text-blue-600 dark:text-blue-400" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-bold text-slate-900 dark:text-white">
                        {type.name}
                      </h3>
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        {type.desc}
                      </p>
                    </div>
                    <ArrowRight className="text-blue-600 opacity-0 transition group-hover:opacity-100" />
                  </div>
                </button>
              ))}
            </div>
            {formError && <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{formError}</p>}
          </div>
        )}

        {step === "details" && (
          <form onSubmit={handleSaveDetails} className="space-y-8 rounded-2xl border border-slate-200 bg-white p-8 dark:border-slate-800 dark:bg-slate-900">
            <div>
              <h2 className="font-(--font-anton) text-2xl uppercase text-slate-900 dark:text-white">
                {employerType === "REGISTERED_INDUSTRY"
                  ? "Registered industry details"
                  : employerType === "REGISTERED_BUSINESS"
                    ? "Registered business details"
                    : employerType === "UNREGISTERED_BUSINESS"
                      ? "Unregistered business details"
                      : "Individual employer details"}
              </h2>
              <p className="mt-2 text-slate-600 dark:text-slate-400">
                Complete the required details to finish your employer profile.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {employerType === "REGISTERED_INDUSTRY" && (
                <>
                  <FormField label="Legal / company name" field="business_name" value={formData.business_name} onChange={updateField} />
                  <FormField label="Industry type" field="industry_type" value={formData.industry_type} onChange={updateField} />
                  <FormField label="Industry category" field="industry_category" value={formData.industry_category} onChange={updateField} />
                  <FormField label="Registered address" field="registered_address" value={formData.registered_address} onChange={updateField} wide />
                </>
              )}

              {(employerType === "REGISTERED_BUSINESS" || employerType === "UNREGISTERED_BUSINESS") && (
                <>
                  <FormField label="Business name" field="business_name" value={formData.business_name} onChange={updateField} />
                  <FormField label="Business type" field="business_type" value={formData.business_type} onChange={updateField} />
                  <FormField label="Business category" field="business_category" value={formData.business_category} onChange={updateField} />
                  <FormField label="Industry category" field="industry_category" value={formData.industry_category} onChange={updateField} />
                  <FormField label={employerType === "REGISTERED_BUSINESS" ? "Registered address" : "Address"} field={employerType === "REGISTERED_BUSINESS" ? "registered_address" : "address"} value={formData[employerType === "REGISTERED_BUSINESS" ? "registered_address" : "address"]} onChange={updateField} wide />
                </>
              )}

              {employerType === "INDIVIDUAL" && (
                <FormField label="Address" field="address" value={formData.address} onChange={updateField} wide />
              )}

              {employerType === "UNREGISTERED_BUSINESS" && (
                <>
                  <FormField label="Nature of business" field="nature_of_business" value={formData.nature_of_business} onChange={updateField} />
                  <FormField label="Number of proprietors" field="number_of_proprietors" value={formData.number_of_proprietors} onChange={updateField} />
                  <FormField label="Proprietor name" field="proprietor_name" value={formData.proprietor_name} onChange={updateField} />
                  <FormField label="Proprietor Aadhaar" field="proprietor_aadhaar" value={formData.proprietor_aadhaar} onChange={updateField} />
                </>
              )}

              {(employerType === "REGISTERED_BUSINESS" || employerType === "UNREGISTERED_BUSINESS") && (
                <>
                  <FormField label="Website" field="website_url" value={formData.website_url} onChange={updateField} />
                  <FormField label="Annual revenue" field="annual_revenue" value={formData.annual_revenue} onChange={updateField} />
                  <FormField label="Business description" field="description" value={formData.description} onChange={updateField} wide />
                </>
              )}

              {(employerType === "REGISTERED_BUSINESS" || employerType === "REGISTERED_INDUSTRY") && (
                <>
                  <FormField label="Authorized signatory name" field="director_name" value={formData.director_name} onChange={updateField} />
                  <FormField label="Authorized signatory phone" field="director_phone" value={formData.director_phone} onChange={updateField} />
                  <FormField label="Authorized signatory email" field="director_email" value={formData.director_email} onChange={updateField} />
                  <FormField label="Authorized signatory address" field="director_address" value={formData.director_address} onChange={updateField} wide />
                  <FormField label="Authorized signatory Aadhaar" field="director_aadhaar" value={formData.director_aadhaar} onChange={updateField} />
                </>
              )}

              <FormField label="Account email" field="company_email" value={formData.company_email} onChange={updateField} readOnly />
              <FormField label="Account phone" field="company_phone" value={formData.company_phone} onChange={updateField} readOnly />

              <FormField label="City" field="city" value={formData.city} onChange={updateField} />
              <FormField label="State" field="state" value={formData.state} onChange={updateField} />
              <FormField label="Pincode" field="pincode" value={formData.pincode} onChange={updateField} />
              <FormField label="Work location" field="work_location" value={formData.work_location} onChange={updateField} />

              {employerType === "REGISTERED_INDUSTRY" && (
                <>
                  <FormField label="GSTIN" field="gstin" value={formData.gstin} onChange={updateField} />
                  <FormField label="CIN" field="cin_number" value={formData.cin_number} onChange={updateField} />
                  <FormField label="PAN" field="pan_number" value={formData.pan_number} onChange={updateField} />
                  <FormField label="Registration number" field="registration_number" value={formData.registration_number} onChange={updateField} />
                </>
              )}
              {employerType === "REGISTERED_BUSINESS" && (
                <>
                  <FormField label="GSTIN" field="gstin" value={formData.gstin} onChange={updateField} />
                  <FormField label="CIN" field="cin_number" value={formData.cin_number} onChange={updateField} />
                  <FormField label="PAN" field="pan_number" value={formData.pan_number} onChange={updateField} />
                  <FormField label="Registration number" field="registration_number" value={formData.registration_number} onChange={updateField} />
                </>
              )}
              {employerType === "UNREGISTERED_BUSINESS" && (
                <FormField label="Udyam number" field="udyam_number" value={formData.udyam_number} onChange={updateField} />
              )}
            </div>

            {formError && <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{formError}</p>}

            <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
              <button type="button" onClick={() => { setFormError(""); setStep("type"); }} className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-6 py-3 font-bold text-slate-600 transition hover:bg-slate-50">
                Back to employer type
              </button>
              <button type="submit" disabled={isSubmitting} className="inline-flex items-center justify-center gap-2 rounded-lg bg-linear-to-r from-blue-600 to-blue-700 px-6 py-3 font-bold text-white transition hover:from-blue-700 hover:to-blue-800 disabled:opacity-50">
                {isSubmitting ? <><Loader2 size={16} className="animate-spin" /> Saving...</> : <>Next: Review <ArrowRight size={16} /></>}
              </button>
            </div>
          </form>
        )}

        {step === "identity" && employerType && employerType !== "INDIVIDUAL" && (
          <form onSubmit={handleSaveIdentity} className="space-y-8 rounded-2xl border border-slate-200 bg-white p-8 dark:border-slate-800 dark:bg-slate-900">
            <div>
              <h2 className="font-(--font-anton) text-2xl uppercase text-slate-900 dark:text-white">Legal / company identity</h2>
              <p className="mt-2 text-slate-600 dark:text-slate-400">Verify the legal identity before completing the remaining onboarding details.</p>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField label="Legal / company name" field="business_name" value={formData.business_name} onChange={updateField} />
              {employerType === "REGISTERED_INDUSTRY" && <FormField label="CIN" field="cin_number" value={formData.cin_number} onChange={updateField} />}
              {(employerType === "REGISTERED_INDUSTRY" || verification.required.includes("GSTIN")) && <FormField label="GSTIN (optional)" field="gstin" value={formData.gstin} onChange={updateField} />}
              {verification.required.includes("PAN") && <FormField label="PAN" field="pan_number" value={formData.pan_number} onChange={updateField} />}
              {verification.required.includes("REGISTRATION_NUMBER") && <FormField label="Registration number" field="registration_number" value={formData.registration_number} onChange={updateField} />}
              {verification.required.includes("UDYAM") && <FormField label="Udyam number" field="udyam_number" value={formData.udyam_number} onChange={updateField} />}
              {verification.required.includes("AADHAAR") && <FormField label="Proprietor Aadhaar" field="proprietor_aadhaar" value={formData.proprietor_aadhaar} onChange={updateField} />}
            </div>
            {formError && <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{formError}</p>}
            <button type="submit" disabled={isSubmitting} className="inline-flex items-center justify-center gap-2 rounded-lg bg-linear-to-r from-blue-600 to-blue-700 px-6 py-3 font-bold text-white disabled:opacity-50">
              {isSubmitting ? <><Loader2 size={16} className="animate-spin" /> Saving...</> : <>Continue to verification <ArrowRight size={16} /></>}
            </button>
          </form>
        )}

        {step === "verification" && (
          <div className="space-y-8 rounded-2xl border border-slate-200 bg-white p-8 dark:border-slate-800 dark:bg-slate-900">
            <div>
              <h2 className="font-(--font-anton) text-2xl uppercase text-slate-900 dark:text-white">Verification</h2>
              <p className="mt-2 text-slate-600 dark:text-slate-400">Complete every configured verification before review.</p>
            </div>

            <div className="space-y-3">
              {verification.required.map((type) => {
                const record = getVerificationRecord(type);
                const verified = record?.status === "VERIFIED";
                const failureMessage = record?.failure_reason === "CASHFREE_AUTHENTICATION_FAILED"
                  ? "Cashfree credentials were rejected. Contact the administrator."
                  : record?.failure_reason;
                return (
                  <div key={type} className="flex flex-col gap-3 rounded-xl border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-bold text-slate-300">Document: {type.replaceAll("_", " ")}</p>
                      <p className={`text-sm ${verified ? "text-emerald-600" : record?.status === "FAILED" ? "text-red-600" : record?.status === "NOT_CONFIGURED" ? "text-amber-700" : "text-slate-500"}`}>
                        {record?.status === "NOT_CONFIGURED" ? "Verification is not configured; success cannot be claimed" : record?.status || "PENDING"}{failureMessage && record?.status !== "NOT_CONFIGURED" ? ` - ${failureMessage}` : ""}
                      </p>
                    </div>
                    {!verified && record?.status !== "NOT_CONFIGURED" && (
                      <button type="button" onClick={() => handleRequestVerification(type)} disabled={isSubmitting} className="inline-flex items-center justify-center gap-2 rounded-lg border border-blue-200 px-4 py-2 text-sm font-bold text-blue-700 transition hover:bg-blue-50 disabled:opacity-50">
                        {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : null}
                        {record?.status === "FAILED" ? "Retry" : "Verify"}
                      </button>
                    )}
                  </div>
                );
              })}
              {verification.required.length === 0 && (
                <p className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                  No mandatory verification mapping is configured for this employer type. No verification success is claimed.
                </p>
              )}
            </div>

            {formError && <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{formError}</p>}
            <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
              <button type="button" onClick={() => { setFormError(""); setStep("details"); }} className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-6 py-3 font-bold text-slate-600 transition hover:bg-slate-50">Back to details</button>
              <button type="button" onClick={() => {
                const incomplete = verification.required.find((type) => getVerificationRecord(type)?.status !== "VERIFIED");
                if (incomplete) {
                  const message = `${incomplete.replaceAll("_", " ")} verification is required`;
                  setFormError(message);
                  toast.error(message);
                  return;
                }
                setFormError("");
                setStep("review");
              }} disabled={isSubmitting} className="inline-flex items-center justify-center gap-2 rounded-lg bg-linear-to-r from-blue-600 to-blue-700 px-6 py-3 font-bold text-white transition hover:from-blue-700 hover:to-blue-800 disabled:opacity-50">Next: Review <ArrowRight size={16} /></button>
            </div>
          </div>
        )}

        {step === "review" && (
          <div className="space-y-8 rounded-2xl border border-slate-200 bg-white p-8 dark:border-slate-800 dark:bg-slate-900">
            <div>
              <h2 className="font-(--font-anton) text-2xl uppercase text-slate-900 dark:text-white">Review your details</h2>
              <p className="mt-2 text-slate-600 dark:text-slate-400">Confirm the information before completing onboarding.</p>
            </div>
            <div className="grid grid-cols-1 gap-3 rounded-xl bg-slate-50 p-5 md:grid-cols-2">
              {ONBOARDING_FIELDS.filter((field) => formData[field] && !(employerType === "INDIVIDUAL" && ["gstin", "registration_number"].includes(field))).map((field) => (
                <div key={field} className="flex items-start justify-between gap-4 border-b border-slate-200 py-2 last:border-0">
                  <span className="text-xs font-semibold uppercase text-slate-500">{field.replaceAll("_", " ")}</span>
                  <span className="text-right text-sm font-semibold text-slate-800">{field === "proprietor_aadhaar" || field === "director_aadhaar" ? maskAadhaar(formData[field]) : formData[field]}</span>
                </div>
              ))}
            </div>
            {verification.required.length > 0 && (
              <div className="rounded-xl border border-slate-200 p-5">
                <p className="mb-2 text-xs font-semibold uppercase text-slate-500">Verification status</p>
                {verification.required.map((type) => (
                  <p key={type} className={`text-sm font-semibold ${getVerificationRecord(type)?.status === "VERIFIED" ? "text-emerald-700" : getVerificationRecord(type)?.status === "FAILED" ? "text-red-700" : getVerificationRecord(type)?.status === "NOT_CONFIGURED" ? "text-amber-700" : "text-slate-700"}`}>
                    {type.replaceAll("_", " ")}: {getVerificationRecord(type)?.status === "NOT_CONFIGURED" ? "NOT CONFIGURED" : getVerificationRecord(type)?.status || "PENDING"}
                  </p>
                ))}
                {verification.required.map((type) => {
                  const metadata = getVerificationRecord(type)?.provider_metadata;
                  if (!metadata || Object.keys(metadata).length === 0) return null;
                  return (
                    <div key={`${type}-metadata`} className="mt-3 text-sm text-slate-600">
                      {Object.entries(metadata).map(([key, value]) => (
                        <p key={key}><span className="font-semibold">{key.replaceAll("_", " ")}:</span> {key.toLowerCase().includes("aadhaar") ? "Masked" : String(value)}</p>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
            {formError && <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{formError}</p>}
            <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
              <div className="flex flex-col gap-3 sm:flex-row">
                {verification.required.length > 0 && <button type="button" onClick={() => { setFormError(""); setStep("verification"); }} className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-6 py-3 font-bold text-slate-600 transition hover:bg-slate-50">Edit verification</button>}
                <button type="button" onClick={() => { setFormError(""); setStep("details"); }} className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-6 py-3 font-bold text-slate-600 transition hover:bg-slate-50">Edit details</button>
              </div>
              <button type="button" onClick={handleComplete} disabled={isSubmitting} className="inline-flex items-center justify-center gap-2 rounded-lg bg-linear-to-r from-blue-600 to-blue-700 px-6 py-3 font-bold text-white transition hover:from-blue-700 hover:to-blue-800 disabled:opacity-50">
                {isSubmitting ? <><Loader2 size={16} className="animate-spin" /> Submitting...</> : <>Submit onboarding <ArrowRight size={16} /></>}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function FormField({
  label,
  field,
  value,
  onChange,
  wide = false,
  readOnly = false,
}: {
  label: string;
  field: string;
  value?: string;
  onChange: (field: string, value: string) => void;
  wide?: boolean;
  readOnly?: boolean;
}) {
  return (
    <label className={`space-y-1 ${wide ? "md:col-span-2" : ""}`}>
      <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">{label}</span>
      <input
        type="text"
        value={value || ""}
        readOnly={readOnly}
        onChange={(event) => onChange(field, event.target.value)}
        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100"
      />
    </label>
  );
}
