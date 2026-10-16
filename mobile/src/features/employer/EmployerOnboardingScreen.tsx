import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Building2, Check, LoaderCircle, MapPin, ShieldCheck, UserRound } from "lucide-react";
import { useAuth, errorMessage } from "../auth/AuthProvider";
import { apiGet, apiPost, apiPut, ApiError } from "../../lib/api";
import type { EmployerType } from "../../types/auth";

type BusinessType = Exclude<EmployerType, "INDIVIDUAL">;
type FormData = Record<string, string>;
type VerificationRecord = {
  verification_type: string;
  status: "PENDING" | "VERIFIED" | "FAILED" | "NOT_CONFIGURED" | "REJECTED" | "MISMATCHED";
  failure_reason?: string | null;
  verified_at?: string | null;
};
type OnboardingResponse = {
  employer: {
    employer_type?: EmployerType | null;
    onboarding_status?: string;
  };
  details?: Record<string, unknown> | null;
  verification?: {
    required?: string[];
    records?: VerificationRecord[];
  };
};
type VerificationState = { required: string[]; records: VerificationRecord[] };
type LocationOption = {
  address: string;
  locality?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  latitude: number;
  longitude: number;
};

const BUSINESS_TYPES = [
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

const BUSINESS_CATEGORIES = [
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

const BUSINESS_TYPE_LABELS: Record<BusinessType, string> = {
  REGISTERED_BUSINESS: "Registered Business",
  REGISTERED_INDUSTRY: "Industrial Business",
  UNREGISTERED_BUSINESS: "Unregistered Business",
};

const ENDPOINTS: Record<BusinessType, string> = {
  REGISTERED_BUSINESS: "/api/v1/employers/onboarding/registered-business",
  REGISTERED_INDUSTRY: "/api/v1/employers/onboarding/registered-industry",
  UNREGISTERED_BUSINESS: "/api/v1/employers/onboarding/unregistered-business",
};

const COMMON_FIELDS = [
  "business_name",
  "business_category",
  "website_url",
  "annual_revenue",
  "description",
  "company_email",
  "company_phone",
  "work_location",
  "latitude",
  "longitude",
  "address",
];
const REGISTERED_FIELDS = [
  "business_type",
  "industry_category",
  "registered_address",
  "gstin",
  "registration_number",
  "cin_number",
  "pan_number",
  "director_name",
  "director_phone",
  "director_email",
  "director_address",
  "director_aadhaar",
];
const INDUSTRY_FIELDS = ["industry_type", "nature_of_business", "services_required", "director_data"];
const UNREGISTERED_FIELDS = ["number_of_proprietors", "proprietor_names", "proprietor_name", "proprietor_aadhaar"];

const FORM_FIELDS = [
  "business_name",
  "business_type",
  "business_category",
  "industry_type",
  "industry_category",
  "registered_address",
  "address",
  "gstin",
  "registration_number",
  "cin_number",
  "pan_number",
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
];

const REQUIRED_IDENTITY_FIELD: Record<string, string> = {
  CIN: "cin_number",
  GSTIN: "gstin",
  PAN: "pan_number",
  REGISTRATION_NUMBER: "registration_number",
  AADHAAR: "director_aadhaar",
};

function formDataFromDetails(details: Record<string, unknown> | null | undefined, email?: string | null, mobile?: string | null): FormData {
  const data = Object.fromEntries(
    FORM_FIELDS.flatMap((field) => {
      const value = details?.[field];
      return value === null || value === undefined ? [] : [[field, String(value)]];
    }),
  );
  const proprietorNames = Array.isArray(details?.proprietor_names)
    ? details.proprietor_names.map((name) => String(name ?? ""))
    : details?.proprietor_name
      ? [String(details.proprietor_name)]
      : [];
  const count = Math.max(0, Number(data.number_of_proprietors) || 0);
  for (let index = 0; index < count; index += 1) {
    data[`proprietor_name_${index + 1}`] = proprietorNames[index] || (index === 0 ? data.proprietor_name || "" : "");
  }
  if (!data.company_email && email) data.company_email = email;
  if (!data.company_phone && mobile) data.company_phone = mobile;
  return data;
}

function isEmpty(value: string | undefined) {
  return !value?.trim() || value === "Other";
}

function coreDetailsComplete(type: BusinessType, data: FormData) {
  if (type === "UNREGISTERED_BUSINESS") {
    return !isEmpty(data.business_name) &&
      !isEmpty(data.business_category) &&
      Number(data.number_of_proprietors) >= 1;
  }
  const registeredComplete = !isEmpty(data.business_name) &&
    !isEmpty(data.business_type) &&
    !isEmpty(data.business_category);
  return type === "REGISTERED_INDUSTRY"
    ? registeredComplete && !isEmpty(data.industry_type) && !isEmpty(data.industry_category)
    : registeredComplete;
}

function contactDetailsComplete(type: BusinessType, data: FormData) {
  const required = [
    "company_email",
    "company_phone",
    "work_location",
    type === "UNREGISTERED_BUSINESS" ? "address" : "registered_address",
  ];
  if (type === "REGISTERED_BUSINESS") required.push("director_name", "director_phone", "director_email", "director_address", "director_aadhaar");
  if (type === "REGISTERED_INDUSTRY") required.push("director_name", "director_phone", "director_email", "director_address");
  if (required.some((field) => isEmpty(data[field]))) return false;
  if (type === "REGISTERED_BUSINESS" && !/^\d{12}$/.test(data.director_aadhaar || "")) return false;
  if (type === "UNREGISTERED_BUSINESS") {
    const count = Number(data.number_of_proprietors) || 0;
    for (let index = 1; index <= count; index += 1) {
      if (isEmpty(data[`proprietor_name_${index}`])) return false;
    }
  }
  return true;
}

function missingRequiredDetails(type: BusinessType, data: FormData): string[] {
  const required = type === "REGISTERED_INDUSTRY"
    ? ["business_name", "business_type", "business_category", "industry_type", "industry_category", "cin_number", "registered_address", "company_email", "company_phone", "work_location", "director_name", "director_phone", "director_email", "director_address", "director_aadhaar"]
    : type === "REGISTERED_BUSINESS"
      ? ["business_name", "business_type", "business_category", "cin_number", "registered_address", "company_email", "company_phone", "work_location", "director_name", "director_phone", "director_email", "director_address", "director_aadhaar"]
      : ["business_name", "business_category", "number_of_proprietors", "company_email", "company_phone", "proprietor_name", "proprietor_aadhaar", "address", "work_location"];
  const missing = required.filter((field) => isEmpty(data[field]));
  if (type === "UNREGISTERED_BUSINESS") {
    const count = Number(data.number_of_proprietors) || 0;
    for (let index = 1; index <= count; index += 1) {
      if (isEmpty(data[`proprietor_name_${index}`])) missing.push(`proprietor_name_${index}`);
    }
  }
  return missing;
}

function initialStep(type: BusinessType, data: FormData): 1 | 2 | 3 {
  if (!coreDetailsComplete(type, data)) return 1;
  if (!contactDetailsComplete(type, data)) return 2;
  return 3;
}

function draftPayload(type: BusinessType, data: FormData, verification: VerificationState, step: number) {
  const fields = new Set(COMMON_FIELDS);
  if (type === "REGISTERED_BUSINESS" || type === "REGISTERED_INDUSTRY") {
    REGISTERED_FIELDS.forEach((field) => fields.add(field));
  }
  if (type === "REGISTERED_INDUSTRY") INDUSTRY_FIELDS.forEach((field) => fields.add(field));
  if (type === "UNREGISTERED_BUSINESS") UNREGISTERED_FIELDS.forEach((field) => fields.add(field));

  const payload: Record<string, string | number | string[]> = {};
  for (const [field, value] of Object.entries(data)) {
    if (!fields.has(field) && !(type === "UNREGISTERED_BUSINESS" && /^proprietor_name_\d+$/.test(field))) continue;
    if (!value.trim() || value === "Other") continue;
    if (field === "number_of_proprietors") {
      payload[field] = Number(value);
    } else if (field === "latitude" || field === "longitude") {
      const coordinate = Number(value);
      if (Number.isFinite(coordinate)) payload[field] = coordinate;
    } else {
      payload[field] = value;
    }
  }

  if (type === "UNREGISTERED_BUSINESS") {
    const count = Number(data.number_of_proprietors) || 0;
    if (step > 1 && count > 0) {
      payload.proprietor_names = Array.from({ length: count }, (_, index) => data[`proprietor_name_${index + 1}`] || "");
      payload.proprietor_name = data.proprietor_name_1 || "";
    }
    delete payload.business_type;
    delete payload.industry_category;
  }

  if (type === "REGISTERED_INDUSTRY") {
    const cinVerified = verification.records.some((record) => record.verification_type === "CIN" && record.status === "VERIFIED");
    const aadhaarVerified = verification.records.some((record) => record.verification_type === "AADHAAR" && record.status === "VERIFIED");
    if (!cinVerified) {
      for (const field of ["director_name", "director_phone", "director_email", "director_address", "director_aadhaar"]) delete payload[field];
    }
    if (!cinVerified || !aadhaarVerified) {
      delete payload.work_location;
      delete payload.latitude;
      delete payload.longitude;
    }
  }
  return payload;
}

function recordFromError(error: unknown): VerificationRecord | null {
  if (!(error instanceof ApiError) || typeof error.detail !== "object" || error.detail === null || !("verification" in error.detail)) return null;
  const record = (error.detail as { verification?: unknown }).verification;
  return typeof record === "object" && record !== null && "verification_type" in record && "status" in record
    ? record as VerificationRecord
    : null;
}

function onboardingErrorMessage(error: unknown): string {
  if (error instanceof ApiError && typeof error.detail === "object" && error.detail !== null) {
    const detail = error.detail as { code?: unknown; verification?: { verification_type?: unknown; failure_reason?: unknown } };
    const code = typeof detail.code === "string" ? detail.code : "";
    if (code === "CIN_INVALID") return "Enter a valid 21-character CIN.";
    if (code === "CIN_MISSING") return "Enter the CIN before verification.";
    if (code === "BUSINESS_NAME_MISSING") return "Enter the business name before verifying the CIN.";
    const record = detail.verification;
    if (record && typeof record.verification_type === "string" && typeof record.failure_reason === "string") {
      return `${record.verification_type.replaceAll("_", " ")} verification failed: ${record.failure_reason}`;
    }
    if (code) return code.replaceAll("_", " ");
  }
  return errorMessage(error);
}

function Field({ label, value, onChange, placeholder, type = "text", inputMode, error, required = false, readOnly = false }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  inputMode?: "text" | "numeric" | "decimal" | "email" | "tel" | "url";
  error?: string;
  required?: boolean;
  readOnly?: boolean;
}) {
  return <label className="employer-onboarding-field">
    <span>{label}{required ? " *" : ""}</span>
    <input
      className="auth-input"
      value={value || ""}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      type={type}
      inputMode={inputMode}
      readOnly={readOnly}
      aria-invalid={Boolean(error)}
    />
    {error && <small className="employer-onboarding-field-error">{error}</small>}
  </label>;
}

function SelectField({ label, value, options, onChange, error, required = false }: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  error?: string;
  required?: boolean;
}) {
  const isCustom = value === "Other" || (Boolean(value) && !options.includes(value));
  return <div className="employer-onboarding-field">
    <label>
      <span>{label}{required ? " *" : ""}</span>
      <select className="auth-input" value={isCustom ? "Other" : value || ""} onChange={(event) => onChange(event.target.value)}>
        <option value="">Select an option</option>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
    {isCustom && <input
      className="auth-input employer-onboarding-custom-option"
      value={value === "Other" ? "" : value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={`Enter custom ${label.toLowerCase()}`}
      aria-label={`Custom ${label}`}
    />}
    {error && <small className="employer-onboarding-field-error">{error}</small>}
  </div>;
}

export default function EmployerOnboardingScreen() {
  const auth = useAuth();
  const navigate = useNavigate();
  const submissionLock = useRef(false);
  const loadedUserId = useRef<string | null>(null);
  const [employerType, setEmployerType] = useState<BusinessType | "">("");
  const [isIndividual, setIsIndividual] = useState(false);
  const [form, setForm] = useState<FormData>({});
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  const [verification, setVerification] = useState<VerificationState>({ required: [], records: [] });
  const [aadhaarOtp, setAadhaarOtp] = useState("");
  const [locationQuery, setLocationQuery] = useState("");
  const [locationResults, setLocationResults] = useState<LocationOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const applyOnboardingResponse = useCallback((response: OnboardingResponse, selectedUser = auth.user) => {
    const type = response.employer?.employer_type;
    const records = response.verification?.records || [];
    const currentVerification = { required: response.verification?.required || [], records };
    if (type === "INDIVIDUAL") {
      setIsIndividual(true);
      setEmployerType("");
      setVerification(currentVerification);
      return currentVerification;
    }
    setIsIndividual(false);
    const businessType = type === "REGISTERED_BUSINESS" || type === "REGISTERED_INDUSTRY" || type === "UNREGISTERED_BUSINESS"
      ? type
      : "";
    const data = formDataFromDetails(response.details, selectedUser?.email, selectedUser?.mobile);
    setEmployerType(businessType);
    setForm(data);
    setVerification(currentVerification);
    setStep(businessType ? initialStep(businessType, data) : 0);
    return currentVerification;
  }, [auth.user]);

  const loadOnboarding = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    setError("");
    try {
      const response = await apiGet<OnboardingResponse>("/api/v1/employers/onboarding");
      const currentVerification = applyOnboardingResponse(response);
      if (response.employer?.employer_type === "INDIVIDUAL") {
        const state = await auth.refreshAuth();
        if (state.user.role === "EMPLOYER" && state.next_step === "DASHBOARD") navigate("/employer/dashboard", { replace: true });
        else setError("Your individual employer profile is not ready for the dashboard yet. Refresh your account state or try again.");
      } else if (auth.nextStep === "DASHBOARD") {
        navigate("/employer/dashboard", { replace: true });
      } else if (response.employer?.onboarding_status === "COMPLETED") {
        const state = await auth.refreshAuth();
        if (state.next_step === "DASHBOARD") navigate("/employer/dashboard", { replace: true });
      }
      return currentVerification;
    } catch (loadError) {
      setLoadFailed(true);
      setError(onboardingErrorMessage(loadError));
      return null;
    } finally {
      setLoading(false);
    }
  }, [applyOnboardingResponse, auth, navigate]);

  useEffect(() => {
    if (auth.isLoading) return;
    if (!auth.user || auth.user.role !== "EMPLOYER") return;
    if (loadedUserId.current === auth.user.id) return;
    loadedUserId.current = auth.user.id;
    void loadOnboarding();
  }, [auth.isLoading, auth.user, loadOnboarding]);

  const updateField = (field: string, rawValue: string) => {
    const value = ["cin_number", "pan_number", "gstin"].includes(field)
      ? rawValue.toUpperCase().replace(/\s+/g, "")
      : field === "director_aadhaar" || field === "proprietor_aadhaar"
        ? rawValue.replace(/\D/g, "").slice(0, 12)
        : field === "number_of_proprietors"
          ? rawValue.replace(/\D/g, "")
          : rawValue;
    setForm((current) => {
      const next = { ...current, [field]: value };
      if (field === "number_of_proprietors" && employerType === "UNREGISTERED_BUSINESS") {
        const count = Number(value) || 0;
        for (let index = 1; index <= count; index += 1) next[`proprietor_name_${index}`] = current[`proprietor_name_${index}`] || (index === 1 ? current.proprietor_name || "" : "");
        for (const nameField of Object.keys(next)) {
          const match = nameField.match(/^proprietor_name_(\d+)$/);
          if (match && Number(match[1]) > count) delete next[nameField];
        }
        next.proprietor_name = next.proprietor_name_1 || "";
      }
      return next;
    });
    setFieldErrors((current) => ({ ...current, [field]: "" }));
    setError("");
  };

  const hasRecord = useCallback((type: string) =>
    verification.records.some((record) => record.verification_type === type && record.status === "VERIFIED"),
  [verification.records]);

  const saveDraft = useCallback(async (draftStep = step) => {
    if (!employerType) return false;
    await apiPut(ENDPOINTS[employerType], draftPayload(employerType, form, verification, draftStep));
    return true;
  }, [employerType, form, step, verification]);

  const refreshDetails = useCallback(async () => {
    const response = await apiGet<OnboardingResponse>("/api/v1/employers/onboarding");
    const records = response.verification?.records || [];
    setVerification({ required: response.verification?.required || [], records });
    return response;
  }, []);

  const runExclusive = async (operation: () => Promise<void>) => {
    if (submissionLock.current) return;
    submissionLock.current = true;
    setSubmitting(true);
    setError("");
    try {
      await operation();
    } catch (operationError) {
      const record = recordFromError(operationError);
      if (record) {
        setVerification((current) => ({
          ...current,
          records: [...current.records.filter((item) => item.verification_type !== record.verification_type), record],
        }));
      }
      setError(onboardingErrorMessage(operationError));
    } finally {
      submissionLock.current = false;
      setSubmitting(false);
    }
  };

  const selectType = (type: EmployerType) => runExclusive(async () => {
    await apiPost("/api/v1/employers/onboarding/type", { employer_type: type });
    const state = await auth.refreshAuth();
    if (state.user.role === "EMPLOYER" && state.next_step === "DASHBOARD") {
      navigate("/employer/dashboard", { replace: true });
      return;
    }
    const response = await apiGet<OnboardingResponse>("/api/v1/employers/onboarding");
    applyOnboardingResponse(response, state.user);
    setStep(type === "INDIVIDUAL" ? 0 : 1);
  });

  const searchLocations = async () => {
    if (locationQuery.trim().length < 2) {
      setError("Enter at least 2 characters to search for a location.");
      return;
    }
    setLocationLoading(true);
    setError("");
    try {
      const result = await apiGet<{ locations?: LocationOption[] }>(`/api/v1/locations/search?q=${encodeURIComponent(locationQuery.trim())}`);
      setLocationResults(result.locations || []);
      if (!result.locations?.length) setError("No matching locations found. Enter a more specific area, city or pincode.");
    } catch (searchError) {
      setError(onboardingErrorMessage(searchError));
    } finally {
      setLocationLoading(false);
    }
  };

  const chooseLocation = (location: LocationOption) => {
    setForm((current) => ({
      ...current,
      work_location: location.address,
      latitude: String(location.latitude),
      longitude: String(location.longitude),
    }));
    setLocationQuery(location.address);
    setLocationResults([]);
    setFieldErrors((current) => ({ ...current, work_location: "" }));
    setError("");
  };

  const validateStepOne = () => {
    if (!employerType) return "Choose a business type to continue.";
    const errors: Record<string, string> = {};
    if (isEmpty(form.business_name)) errors.business_name = "Business name is required.";
    if (employerType === "UNREGISTERED_BUSINESS") {
      if (isEmpty(form.business_category)) errors.business_category = "Category is required.";
      if (!form.number_of_proprietors || Number(form.number_of_proprietors) < 1) errors.number_of_proprietors = "Enter at least one proprietor.";
    } else {
      if (isEmpty(form.business_type)) errors.business_type = "Business type is required.";
      if (isEmpty(form.business_category)) errors.business_category = "Category is required.";
      if (employerType === "REGISTERED_INDUSTRY") {
        if (isEmpty(form.industry_type)) errors.industry_type = "Business activity is required.";
        if (isEmpty(form.industry_category)) errors.industry_category = "Industry category is required.";
      }
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length) return "Please fill in all required business details.";
    return "";
  };

  const validateStepTwo = () => {
    if (!employerType) return "Choose a business type to continue.";
    const errors: Record<string, string> = {};
    if (isEmpty(form.company_email)) errors.company_email = "Company email is required.";
    if (isEmpty(form.company_phone)) errors.company_phone = "Company phone is required.";
    const addressField = employerType === "UNREGISTERED_BUSINESS" ? "address" : "registered_address";
    if (isEmpty(form[addressField])) errors[addressField] = "Business address is required.";
    if (isEmpty(form.work_location)) errors.work_location = "Work location is required.";
    if (employerType === "REGISTERED_BUSINESS" || employerType === "REGISTERED_INDUSTRY") {
      for (const field of ["director_name", "director_phone", "director_email", "director_address"]) {
        if (isEmpty(form[field])) errors[field] = `${field === "director_name" ? "Authorized person name" : field.replace("director_", "Director ")} is required.`;
      }
    }
    if (employerType === "REGISTERED_BUSINESS" && !/^\d{12}$/.test(form.director_aadhaar || "")) {
      errors.director_aadhaar = "A valid 12-digit Aadhaar is required.";
    }
    if (employerType === "UNREGISTERED_BUSINESS") {
      const count = Number(form.number_of_proprietors) || 0;
      for (let index = 1; index <= count; index += 1) {
        if (isEmpty(form[`proprietor_name_${index}`])) errors[`proprietor_name_${index}`] = `Proprietor name ${index} is required.`;
      }
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length) return "Please correct the highlighted details before continuing.";
    return "";
  };

  const continueStep = (targetStep: 2 | 3) => runExclusive(async () => {
    const validation = targetStep === 2 ? validateStepOne() : validateStepTwo();
    if (validation) {
      setError(validation);
      return;
    }
    await saveDraft(targetStep === 2 ? 1 : 2);
    setStep(targetStep);
  });

  const saveLegalIdentity = async () => {
    if (!employerType || (employerType !== "REGISTERED_BUSINESS" && employerType !== "REGISTERED_INDUSTRY")) return;
    const cin = (form.cin_number || "").trim().toUpperCase();
    if (!form.business_name?.trim()) throw new Error("Business name is required before legal identity verification.");
    if (!/^[A-Z][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/.test(cin)) {
      setFieldErrors((current) => ({ ...current, cin_number: "Enter a valid 21-character CIN." }));
      throw new Error("Enter a valid 21-character CIN before verification.");
    }
    await apiPut("/api/v1/employers/onboarding/legal-identity", {
      business_name: form.business_name.trim(),
      cin_number: cin,
      ...(form.gstin?.trim() ? { gstin: form.gstin.trim() } : {}),
      ...(form.pan_number?.trim() ? { pan_number: form.pan_number.trim() } : {}),
      ...(form.registration_number?.trim() ? { registration_number: form.registration_number.trim() } : {}),
    });
  };

  const requestVerification = (type: string) => runExclusive(async () => {
    if (!employerType) return;
    if (type === "CIN") {
      await saveLegalIdentity();
    } else {
      if (type === "AADHAAR") {
        const aadhaarField = employerType === "UNREGISTERED_BUSINESS" ? "proprietor_aadhaar" : "director_aadhaar";
        if (!/^\d{12}$/.test(form[aadhaarField] || "")) throw new Error("Enter a valid 12-digit Aadhaar number.");
      }
      await saveDraft(3);
    }
    const referenceField = REQUIRED_IDENTITY_FIELD[type];
    const reference = referenceField ? form[referenceField]?.trim() : "";
    const record = await apiPost<VerificationRecord>(
      `/api/v1/employers/onboarding/verifications/${encodeURIComponent(type)}`,
      type === "CIN" && reference ? { reference: reference.toUpperCase() } : {},
    );
    setVerification((current) => ({
      ...current,
      records: [...current.records.filter((item) => item.verification_type !== type), record],
    }));
    if (record.status === "VERIFIED") {
      if (type === "CIN" || type === "AADHAAR") {
        try {
          await saveDraft(3);
        } catch (saveError) {
          setError(`Verification succeeded, but the saved onboarding details could not be updated: ${onboardingErrorMessage(saveError)}`);
          return;
        }
      }
      await refreshDetails();
    } else if (record.status === "PENDING" && record.failure_reason === "OTP_SENT") {
      setError("Aadhaar OTP sent. Enter the OTP received on the Aadhaar-linked mobile number.");
    } else if (record.status === "FAILED" || record.status === "NOT_CONFIGURED") {
      setError(record.failure_reason || `${type} verification failed. Please try again.`);
    }
  });

  const verifyAadhaarOtp = () => runExclusive(async () => {
    if (!aadhaarOtp.trim()) {
      setError("Enter the Aadhaar OTP to continue.");
      return;
    }
    const record = await apiPost<VerificationRecord>("/api/v1/employers/onboarding/verifications/AADHAAR/otp", { otp: aadhaarOtp.trim() });
    setVerification((current) => ({
      ...current,
      records: [...current.records.filter((item) => item.verification_type !== "AADHAAR"), record],
    }));
    if (record.status === "VERIFIED") {
      setAadhaarOtp("");
      await saveDraft(3);
      await refreshDetails();
    } else if (record.status === "FAILED") {
      setError(record.failure_reason || "Aadhaar verification failed. Please try again.");
    } else {
      setError("Aadhaar verification is still in progress.");
    }
  });

  const completeOnboarding = () => runExclusive(async () => {
    if (!employerType) return;
    const missingFields = missingRequiredDetails(employerType, form);
    if (missingFields.length) {
      const firstMissingField = missingFields[0];
      setFieldErrors((current) => ({ ...current, [firstMissingField]: "This field is required." }));
      setError(`${firstMissingField.replaceAll("_", " ")} is required before completing onboarding.`);
      return;
    }
    const missing = verification.required.filter((type) => !hasRecord(type));
    if (missing.length) {
      setError(`Complete required verification first: ${missing.join(", ")}.`);
      return;
    }
    await saveDraft(3);
    await apiPost("/api/v1/employers/onboarding/complete", {});
    const state = await auth.refreshAuth();
    if (state.user.role === "EMPLOYER" && state.next_step === "DASHBOARD") {
      navigate("/employer/dashboard", { replace: true });
    } else {
      setError(`The backend has not marked onboarding complete yet (current step: ${state.next_step}). Refresh and try again.`);
    }
  });

  const requiredMissing = useMemo(
    () => verification.required.filter((type) => !hasRecord(type)),
    [hasRecord, verification.required],
  );

  if (auth.isLoading) {
    return <main className="auth-content"><section className="auth-card employer-onboarding-loading"><LoaderCircle className="employer-onboarding-spinner" size={24} /><span>Loading your saved onboarding details…</span></section></main>;
  }
  if (!auth.user) return <Navigate to="/auth/signin?role=EMPLOYER" replace />;
  if (auth.user.role !== "EMPLOYER") return <Navigate to="/" replace />;
  if (loading) {
    return <main className="auth-content"><section className="auth-card employer-onboarding-loading"><LoaderCircle className="employer-onboarding-spinner" size={24} /><span>Loading your saved onboarding details…</span></section></main>;
  }
  if (auth.nextStep === "DASHBOARD") return <Navigate to="/employer/dashboard" replace />;

  return <main className="auth-content employer-onboarding-content">
    <section className="employer-onboarding-card" aria-labelledby="employer-onboarding-title">
      <header className="employer-onboarding-header">
        <div>
          <p className="auth-eyebrow">Employer onboarding</p>
          <h1 id="employer-onboarding-title">Create a Business Profile</h1>
          <p className="auth-description">
            {employerType
              ? <>Business type: <strong>{BUSINESS_TYPE_LABELS[employerType]}</strong></>
              : "Choose the business directory that best describes your organization."}
          </p>
        </div>
        {employerType && <button className="employer-onboarding-change" type="button" onClick={() => { setError(""); setStep(0); }}>
          Change business type
        </button>}
      </header>

      {employerType && <nav className="employer-onboarding-progress" aria-label="Onboarding progress">
        {[
          ["Business", 1],
          ["Company & work", 2],
          ["Verification", 3],
        ].map(([label, number]) => {
          const stepNumber = number as 1 | 2 | 3;
          const current = step === stepNumber;
          const complete = step > stepNumber;
          return <div className={`employer-onboarding-progress-item${current ? " current" : ""}${complete ? " complete" : ""}`} key={label}>
            <span>{complete ? <Check size={15} /> : stepNumber}</span>
            <small>{label}</small>
          </div>;
        })}
      </nav>}

      {error && <p className="auth-error employer-onboarding-alert" role="alert">{error}</p>}

      {isIndividual && <section className="employer-onboarding-individual">
        <h2>Individual employer</h2>
        <p>Individual employers do not need business registration onboarding. GLESKA will send you to the dashboard when the backend reports onboarding complete.</p>
        <button className="auth-secondary" type="button" onClick={() => void loadOnboarding()} disabled={loading}>Refresh account status</button>
      </section>}

      {loadFailed && <section className="employer-onboarding-load-retry">
        <p>We could not load your saved employer onboarding state. Your business type was not changed.</p>
        <button className="auth-secondary" type="button" onClick={() => void loadOnboarding()} disabled={loading}>Retry loading</button>
      </section>}

      {step === 0 && !isIndividual && !loadFailed && <div className="employer-onboarding-type-list">
        <button className="employer-onboarding-type-card" type="button" onClick={() => void selectType("INDIVIDUAL")} disabled={submitting}>
          <span className="employer-onboarding-type-icon"><UserRound size={20} /></span>
          <span><strong>Individual Employer</strong><small>Hire workers as an individual without business registration onboarding</small></span>
          {submitting ? <LoaderCircle className="employer-onboarding-spinner" size={18} /> : <ArrowRight size={18} />}
        </button>
        {(["REGISTERED_BUSINESS", "REGISTERED_INDUSTRY", "UNREGISTERED_BUSINESS"] as BusinessType[]).map((type) => (
          <button className="employer-onboarding-type-card" key={type} type="button" onClick={() => void selectType(type)} disabled={submitting}>
            <span className="employer-onboarding-type-icon">{type === "UNREGISTERED_BUSINESS" ? <UserRound size={20} /> : <Building2 size={20} />}</span>
            <span><strong>{BUSINESS_TYPE_LABELS[type]}</strong><small>{type === "REGISTERED_INDUSTRY" ? "Registered industrial and manufacturing organizations" : type === "REGISTERED_BUSINESS" ? "Companies registered as a formal business entity" : "A business operating without formal registration"}</small></span>
            {submitting ? <LoaderCircle className="employer-onboarding-spinner" size={18} /> : <ArrowRight size={18} />}
          </button>
        ))}
      </div>}

      {step === 1 && employerType && <form className="employer-onboarding-form" onSubmit={(event) => { event.preventDefault(); void continueStep(2); }}>
        <h2>Business information</h2>
        <Field label="Business name" required value={form.business_name || ""} onChange={(value) => updateField("business_name", value)} placeholder="Enter business or company name" error={fieldErrors.business_name} />
        {employerType !== "UNREGISTERED_BUSINESS" && <SelectField label="Business type" required value={form.business_type || ""} options={BUSINESS_TYPES} onChange={(value) => updateField("business_type", value)} error={fieldErrors.business_type} />}
        <SelectField label="Category" required value={form.business_category || ""} options={BUSINESS_CATEGORIES} onChange={(value) => updateField("business_category", value)} error={fieldErrors.business_category} />
        {employerType === "REGISTERED_INDUSTRY" && <>
          <Field label="Business activity" required value={form.industry_type || ""} onChange={(value) => updateField("industry_type", value)} placeholder="e.g. Heavy Manufacturing" error={fieldErrors.industry_type} />
          <Field label="Industry category" required value={form.industry_category || ""} onChange={(value) => updateField("industry_category", value)} placeholder="e.g. Engineering & Services" error={fieldErrors.industry_category} />
        </>}
        {employerType === "UNREGISTERED_BUSINESS" && <Field label="Number of proprietors" required value={form.number_of_proprietors || ""} onChange={(value) => updateField("number_of_proprietors", value)} placeholder="e.g. 2" type="number" inputMode="numeric" error={fieldErrors.number_of_proprietors} />}
        <Field label="Website URL" value={form.website_url || ""} onChange={(value) => updateField("website_url", value)} placeholder="https://yourbusiness.com" type="url" />
        <Field label="Annual revenue (approx.)" value={form.annual_revenue || ""} onChange={(value) => updateField("annual_revenue", value)} placeholder="e.g. ₹50 Lakhs – ₹1 Crore" />
        <Field label="Business description" value={form.description || ""} onChange={(value) => updateField("description", value)} placeholder="Briefly describe your business operations" />
        <div className="employer-onboarding-actions">
          <button className="auth-secondary" type="button" onClick={() => setStep(0)} disabled={submitting}><ArrowLeft size={16} /> Back</button>
          <button className="auth-primary" type="submit" disabled={submitting}>{submitting ? <LoaderCircle className="employer-onboarding-spinner" size={17} /> : null}Save and continue <ArrowRight size={16} /></button>
        </div>
      </form>}

      {step === 2 && employerType && <form className="employer-onboarding-form" onSubmit={(event) => { event.preventDefault(); void continueStep(3); }}>
        <h2>Company, contact and work details</h2>
        {(employerType === "REGISTERED_BUSINESS" || employerType === "REGISTERED_INDUSTRY") && <div className="employer-onboarding-section-title">Authorized person</div>}
        {employerType !== "UNREGISTERED_BUSINESS" && <>
          <Field label="Authorized person name" required value={form.director_name || ""} onChange={(value) => updateField("director_name", value)} placeholder="Full name as on official ID" error={fieldErrors.director_name} />
          <Field label={employerType === "REGISTERED_INDUSTRY" ? "Director phone" : "Authorized person phone"} required value={form.director_phone || ""} onChange={(value) => updateField("director_phone", value)} placeholder="Mobile number" type="tel" inputMode="tel" error={fieldErrors.director_phone} />
          <Field label={employerType === "REGISTERED_INDUSTRY" ? "Director email" : "Authorized person email"} required value={form.director_email || ""} onChange={(value) => updateField("director_email", value)} placeholder="Official email address" type="email" inputMode="email" error={fieldErrors.director_email} />
          {employerType === "REGISTERED_BUSINESS" && <Field label="Authorized person Aadhaar" required value={form.director_aadhaar || ""} onChange={(value) => updateField("director_aadhaar", value)} placeholder="12-digit Aadhaar number" inputMode="numeric" error={fieldErrors.director_aadhaar} readOnly={hasRecord("AADHAAR")} />}
          <Field label={employerType === "REGISTERED_INDUSTRY" ? "Director address" : "Authorized person address"} required value={form.director_address || ""} onChange={(value) => updateField("director_address", value)} placeholder="Personal address" error={fieldErrors.director_address} />
        </>}
        {employerType === "UNREGISTERED_BUSINESS" && <>
          <div className="employer-onboarding-section-title">Proprietor details</div>
          {Array.from({ length: Number(form.number_of_proprietors) || 0 }, (_, index) => (
            <Field key={index} label={`Proprietor name ${index + 1}`} required value={form[`proprietor_name_${index + 1}`] || ""} onChange={(value) => updateField(`proprietor_name_${index + 1}`, value)} placeholder={`Proprietor ${index + 1} full name`} error={fieldErrors[`proprietor_name_${index + 1}`]} />
          ))}
        </>}
        <div className="employer-onboarding-section-title">Company contact & work location</div>
        <Field label="Company email" required value={form.company_email || ""} onChange={(value) => updateField("company_email", value)} placeholder="contact@company.com" type="email" inputMode="email" error={fieldErrors.company_email} />
        <Field label="Company phone" required value={form.company_phone || ""} onChange={(value) => updateField("company_phone", value)} placeholder="10-digit mobile number" type="tel" inputMode="tel" error={fieldErrors.company_phone} />
        <Field label={employerType === "UNREGISTERED_BUSINESS" ? "Business address" : "Registered business address"} required value={form[employerType === "UNREGISTERED_BUSINESS" ? "address" : "registered_address"] || ""} onChange={(value) => updateField(employerType === "UNREGISTERED_BUSINESS" ? "address" : "registered_address", value)} placeholder="Full address of the office or business" error={fieldErrors[employerType === "UNREGISTERED_BUSINESS" ? "address" : "registered_address"]} />
        <div className="employer-onboarding-field">
          <label><span>Work location *</span><div className="employer-onboarding-location-search">
            <input className="auth-input" value={locationQuery} onChange={(event) => setLocationQuery(event.target.value)} placeholder="Search area, city or pincode" aria-label="Search for work location" />
            <button className="auth-secondary" type="button" onClick={() => void searchLocations()} disabled={locationLoading}>{locationLoading ? <LoaderCircle className="employer-onboarding-spinner" size={17} /> : <MapPin size={17} />}Search</button>
          </div></label>
          {form.work_location && <small className="employer-onboarding-location-selected">Selected: {form.work_location}</small>}
          {fieldErrors.work_location && <small className="employer-onboarding-field-error">{fieldErrors.work_location}</small>}
          {locationResults.length > 0 && <div className="employer-onboarding-location-results">
            {locationResults.map((location) => <button key={`${location.latitude}-${location.longitude}-${location.address}`} type="button" onClick={() => chooseLocation(location)}>
              <MapPin size={16} /><span><strong>{location.locality || location.city || location.address}</strong><small>{[location.city, location.state, location.pincode].filter(Boolean).join(", ") || location.address}</small></span>
            </button>)}
          </div>}
        </div>
        <div className="employer-onboarding-actions">
          <button className="auth-secondary" type="button" onClick={() => setStep(1)} disabled={submitting}><ArrowLeft size={16} /> Back</button>
          <button className="auth-primary" type="submit" disabled={submitting}>{submitting ? <LoaderCircle className="employer-onboarding-spinner" size={17} /> : null}Save and continue <ArrowRight size={16} /></button>
        </div>
      </form>}

      {step === 3 && employerType && <div className="employer-onboarding-form">
        <h2>Verification & review</h2>
        {(employerType === "REGISTERED_BUSINESS" || employerType === "REGISTERED_INDUSTRY") && <div className="employer-onboarding-verification-panel">
          <h3>Registered business identity</h3>
          <p>Enter the legal identifiers used by your business. Required verification types are provided by GLESKA.</p>
          <Field label="CIN" required value={form.cin_number || ""} onChange={(value) => updateField("cin_number", value)} placeholder="21-character CIN" error={fieldErrors.cin_number} readOnly={hasRecord("CIN")} />
          <Field label="GSTIN (optional)" value={form.gstin || ""} onChange={(value) => updateField("gstin", value)} placeholder="Enter GSTIN" readOnly={hasRecord("GSTIN")} />
          <Field label="PAN (optional)" value={form.pan_number || ""} onChange={(value) => updateField("pan_number", value)} placeholder="Enter PAN" readOnly={hasRecord("PAN")} />
          <Field label="Registration number (optional)" value={form.registration_number || ""} onChange={(value) => updateField("registration_number", value)} placeholder="Enter registration number" readOnly={hasRecord("REGISTRATION_NUMBER")} />
          {employerType === "REGISTERED_INDUSTRY" && <Field label={`Director Aadhaar${form.director_name ? ` — ${form.director_name}` : ""}`} required value={form.director_aadhaar || ""} onChange={(value) => updateField("director_aadhaar", value)} placeholder="12-digit Aadhaar number" inputMode="numeric" error={fieldErrors.director_aadhaar} readOnly={hasRecord("AADHAAR")} />}
        </div>}
        {employerType === "REGISTERED_BUSINESS" && <Field label="Authorized person Aadhaar" required value={form.director_aadhaar || ""} onChange={(value) => updateField("director_aadhaar", value)} placeholder="12-digit Aadhaar number" inputMode="numeric" error={fieldErrors.director_aadhaar} readOnly={hasRecord("AADHAAR")} />}
        {employerType === "UNREGISTERED_BUSINESS" && <div className="employer-onboarding-verification-panel">
          <h3>Business registrant Aadhaar</h3>
          <p>{auth.user.name} is the registering proprietor. Only the proprietor registering this business needs to complete Aadhaar verification.</p>
          <Field label="Aadhaar number" required value={form.proprietor_aadhaar || ""} onChange={(value) => updateField("proprietor_aadhaar", value)} placeholder="12-digit Aadhaar number" inputMode="numeric" error={fieldErrors.proprietor_aadhaar} readOnly={hasRecord("AADHAAR")} />
        </div>}

        {(employerType === "REGISTERED_BUSINESS" || employerType === "REGISTERED_INDUSTRY") && <button className="auth-secondary employer-onboarding-save-identity" type="button" disabled={submitting} onClick={() => void runExclusive(async () => {
          await saveLegalIdentity();
          await saveDraft(3);
          await refreshDetails();
        })}>{submitting ? <LoaderCircle className="employer-onboarding-spinner" size={17} /> : null}Save identity details</button>}

        {verification.required.length > 0 ? <section className="employer-onboarding-verification-panel">
          <h3>Required verification</h3>
          {verification.required.map((type) => {
            const record = verification.records.find((item) => item.verification_type === type);
            const verified = record?.status === "VERIFIED";
            const otpSent = type === "AADHAAR" && record?.status === "PENDING" && record.failure_reason === "OTP_SENT";
            const aadhaarField = employerType === "UNREGISTERED_BUSINESS" ? "proprietor_aadhaar" : "director_aadhaar";
            const requiredField = type === "AADHAAR" ? aadhaarField : REQUIRED_IDENTITY_FIELD[type];
            const missingIdentifier = Boolean(requiredField && isEmpty(form[type === "AADHAAR" ? aadhaarField : requiredField]));
            const needsCinBeforeAadhaar = employerType === "REGISTERED_INDUSTRY" && type === "AADHAAR" && !hasRecord("CIN");
            return <div className="employer-onboarding-verification-row" key={type}>
              <div>
                <strong>{type.replaceAll("_", " ")}</strong>
                <small className={verified ? "verified" : record?.status === "FAILED" || record?.status === "NOT_CONFIGURED" ? "failed" : ""}>
                  {verified ? "Verified" : otpSent ? "OTP sent — awaiting code" : record?.status || "Not verified"}
                </small>
                {record?.failure_reason && !otpSent && !verified && <small className="employer-onboarding-field-error">{record.failure_reason}</small>}
              </div>
              {otpSent ? <div className="employer-onboarding-otp-row">
                <input className="auth-input" value={aadhaarOtp} onChange={(event) => setAadhaarOtp(event.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="Aadhaar OTP" inputMode="numeric" autoComplete="one-time-code" aria-label="Aadhaar OTP" />
                <button className="auth-secondary" type="button" onClick={() => void verifyAadhaarOtp()} disabled={submitting || !aadhaarOtp.trim()}>{submitting ? <LoaderCircle className="employer-onboarding-spinner" size={16} /> : null}Verify OTP</button>
              </div> : !verified && <button className="employer-onboarding-verify-button" type="button" onClick={() => void requestVerification(type)} disabled={submitting || missingIdentifier || needsCinBeforeAadhaar}>
                {submitting ? <LoaderCircle className="employer-onboarding-spinner" size={16} /> : <ShieldCheck size={16} />}
                {record?.status === "FAILED" || record?.status === "NOT_CONFIGURED" ? "Try again" : `Verify ${type.replaceAll("_", " ")}`}
              </button>}
              {needsCinBeforeAadhaar && <small className="employer-onboarding-hint">Verify CIN first to unlock authorized person verification.</small>}
            </div>;
          })}
        </section> : <p className="employer-onboarding-info">The backend has not configured any verification requirements for this business type. Completion will still be validated by the backend.</p>}

        <section className="employer-onboarding-review">
          <h3>Review your details</h3>
          {[
            ["Business name", form.business_name],
            ["Category", form.business_category],
            ["Company email", form.company_email],
            ["Company phone", form.company_phone],
            ["Business address", form.registered_address || form.address],
            ["Work location", form.work_location],
          ].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value || "Not provided"}</strong></div>)}
        </section>
        {requiredMissing.length > 0 && <p className="employer-onboarding-info">Complete required verification before submitting your profile.</p>}
        <div className="employer-onboarding-actions">
          <button className="auth-secondary" type="button" onClick={() => setStep(2)} disabled={submitting}><ArrowLeft size={16} /> Back</button>
          <button className="auth-primary" type="button" onClick={() => void completeOnboarding()} disabled={submitting}>
            {submitting ? <LoaderCircle className="employer-onboarding-spinner" size={17} /> : <Check size={17} />}
            Complete profile
          </button>
        </div>
      </div>}
    </section>
  </main>;
}
