"use client";

import React from "react";
import Link from "next/link";
import axios from "axios";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import apiClient from "@/lib/api";
import { useEmployerProfilePhoto } from "@/lib/useEmployerProfilePhoto";
import {
  Building2,
  FileText,
  Camera,
  Save,
  Phone,
  Mail,
  MapPin,
  Hash,
  CreditCard,
  Info,
  Calendar,
  Briefcase,
  CheckCircle2,
  Loader2,
  ShieldCheck,
  User,
  ArrowRight,
  Lock,
  Edit3,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import AccountManagementShell, { formatEmployerType } from "@/components/AccountManagementShell";

interface EmployerProfile {
  id: string;
  employer_type: string;
  onboarding_status: string;
  verification_status: string;
  contact_person_name: string;
  created_at?: string;
  profile_photo_url?: string | null;
}

interface EmployerDetails {
  business_name?: string | null;
  company_email?: string | null;
  company_phone?: string | null;
  address?: string | null;
  registered_address?: string | null;
  work_location?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  gstin?: string | null;
  cin_number?: string | null;
  pan_number?: string | null;
  tan_number?: string | null;
  registration_number?: string | null;
  number_of_proprietors?: number | null;
  proprietor_names?: string[] | null;
  proprietor_name?: string | null;
}

interface EmployerMeResponse {
  employer: EmployerProfile;
  profile_photo_url?: string | null;
  account: {
    name: string;
    email?: string | null;
    mobile?: string | null;
  };
  profile: EmployerDetails;
}

function apiErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError<{ detail?: unknown }>(error)) {
    const detail = error.response?.data?.detail;
    if (typeof detail === "string") {
      return detail;
    }
  }
  return fallback;
}

function companyFormFromProfile(
  employer: EmployerProfile,
  details: EmployerDetails,
  account: EmployerMeResponse["account"],
): EmployerDetails {
  const registered = employer.employer_type === "REGISTERED_BUSINESS" ||
    employer.employer_type === "REGISTERED_INDUSTRY";
  const addressKey = registered ? "registered_address" : "address";
  const hasDetail = (key: keyof EmployerDetails) =>
    Object.prototype.hasOwnProperty.call(details, key);
  const address = hasDetail(addressKey)
    ? details[addressKey] ?? ""
    : details.address ??
      details.registered_address ??
      details.work_location ??
      [details.city, details.state, details.pincode].filter(Boolean).join(", ");
  const optionalValue = (
    key: "business_name" | "company_phone" | "company_email",
    fallback: string | null | undefined,
  ) => hasDetail(key) ? details[key] ?? "" : fallback ?? "";
  return {
    business_name:
      employer.employer_type === "INDIVIDUAL"
        ? employer.contact_person_name
        : optionalValue("business_name", employer.contact_person_name ?? account.name),
    company_phone: optionalValue("company_phone", account.mobile),
    company_email: optionalValue("company_email", account.email),
    address,
    city: details.city ?? "",
    state: details.state ?? "",
    pincode: details.pincode ?? "",
    work_location: details.work_location ?? "",
    gstin: details.gstin ?? "",
    cin_number: details.cin_number ?? "",
    pan_number: details.pan_number ?? "",
    tan_number: details.tan_number ?? "",
  };
}

export default function CompanyProfilePage() {
  const router = useRouter();
  const { user, isLoading, logout, refreshUser } = useAuth();
  const { isUploading: isPhotoUploading, uploadPhoto, removePhoto } = useEmployerProfilePhoto();
  const profilePhotoInputRef = React.useRef<HTMLInputElement>(null);
  const [employerProfile, setEmployerProfile] = React.useState<EmployerProfile | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isDataLoading, setIsDataLoading] = React.useState(true);
  const [proprietorDetails, setProprietorDetails] = React.useState<{
    count: number | null;
    names: string[];
  }>({ count: null, names: [] });
  const [isEditingProprietors, setIsEditingProprietors] = React.useState(false);
  const originalFormData = React.useRef<EmployerDetails | null>(null);
  const originalProprietorDetails = React.useRef<{ count: number | null; names: string[] } | null>(null);

  // Company Information Form State
  const [formData, setFormData] = React.useState<EmployerDetails>({
    business_name: "",
    company_phone: "",
    company_email: "",
    address: "",
    city: "",
    state: "",
    pincode: "",
    work_location: "",
    gstin: "",
    cin_number: "",
    pan_number: "",
    tan_number: "",
  });

  // Per-section edit toggles
  const [isEditingIdentity, setIsEditingIdentity] = React.useState(false);
  const [isEditingContact, setIsEditingContact] = React.useState(false);
  const [isEditingAddress, setIsEditingAddress] = React.useState(false);

  React.useEffect(() => {
    if (!isLoading && !user) {
      router.replace("/employer/auth");
      return;
    }

    if (!isLoading && user && user.role !== "EMPLOYER") {
      router.replace("/");
      return;
    }

    const fetchCompanyData = async () => {
      setIsDataLoading(true);
      try {
        const response = await apiClient.get<EmployerMeResponse>("/api/v1/employers/me", {
          withCredentials: true,
        });

        const emp = response.data.employer;
        const det = response.data.profile || {};
        const account = response.data.account;

        if (emp) {
          setEmployerProfile({ ...emp, profile_photo_url: response.data.profile_photo_url ?? null });
        }
        const activeProprietorDetails = emp?.employer_type === "UNREGISTERED_BUSINESS"
          ? det.proprietor_names || (det.proprietor_name ? [det.proprietor_name] : [])
          : [];
        const loadedProprietorDetails = {
          count: emp?.employer_type === "UNREGISTERED_BUSINESS" && typeof det.number_of_proprietors === "number"
            ? det.number_of_proprietors
            : null,
          names: activeProprietorDetails ?? [],
        };
        originalProprietorDetails.current = loadedProprietorDetails;
        setProprietorDetails(loadedProprietorDetails);

        const loadedFormData = companyFormFromProfile(emp, det, account);
        originalFormData.current = loadedFormData;
        setFormData(loadedFormData);
      } catch (err: unknown) {
        console.error("Failed to load employer data:", err);
        toast.error(apiErrorMessage(err, "Unable to load employer profile"));
      } finally {
        setIsDataLoading(false);
      }
    };

    if (user) {
      fetchCompanyData();
    }
  }, [user, isLoading, router]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const isIndividual = employerProfile?.employer_type === "INDIVIDUAL";
      const isUnregistered = employerProfile?.employer_type === "UNREGISTERED_BUSINESS";
      const identityLocked =
        !isIndividual &&
        (employerProfile?.onboarding_status === "COMPLETED" ||
          ((employerProfile?.employer_type === "REGISTERED_BUSINESS" ||
            employerProfile?.employer_type === "REGISTERED_INDUSTRY") &&
            employerProfile?.verification_status === "VERIFIED"));
      const previous = originalFormData.current || {};
      const updatePayload: Record<string, string | number | string[] | null> = {};
      const editableFields: (keyof EmployerDetails)[] = [
        "business_name",
        "company_phone",
        "company_email",
        "address",
        "city",
        "state",
        "pincode",
        "work_location",
        ...(!isIndividual && !isUnregistered ? ["gstin", "cin_number", "pan_number"] as const : []),
      ];
      for (const field of editableFields) {
        if (identityLocked && ["business_name", "gstin", "cin_number", "pan_number"].includes(field)) {
          continue;
        }
        const currentValue = String(formData[field] ?? "").trim();
        const previousValue = String(previous[field] ?? "").trim();
        if (currentValue !== previousValue) {
          const apiField =
            isIndividual && field === "business_name"
              ? "contact_person_name"
              : field === "address" && !isIndividual && !isUnregistered
                ? "registered_address"
                : field;
          updatePayload[apiField] = currentValue || null;
        }
      }
      const previousProprietors = originalProprietorDetails.current || { count: null, names: [] };
      const proprietorsChanged =
        proprietorDetails.count !== previousProprietors.count ||
        JSON.stringify(proprietorDetails.names) !== JSON.stringify(previousProprietors.names);
      if (isUnregistered && proprietorsChanged) {
        if (
          proprietorDetails.count === null ||
          !Number.isInteger(proprietorDetails.count) ||
          proprietorDetails.count < 1 ||
          proprietorDetails.names.length !== proprietorDetails.count ||
          proprietorDetails.names.some((name) => !name.trim())
        ) {
          toast.error("Enter a name for each proprietor and make the count match the list");
          return;
        }
        updatePayload.number_of_proprietors = proprietorDetails.count;
        updatePayload.proprietor_names = proprietorDetails.names.map((name) => name.trim());
      }
      if (!Object.keys(updatePayload).length) {
        toast.info("There are no profile changes to save");
        return;
      }

      const response = await apiClient.put<EmployerMeResponse>(
        "/api/v1/employers/company-profile",
        updatePayload,
        { withCredentials: true }
      );

      const savedEmployer = response.data.employer;
      const savedProfile = {
        ...(response.data.profile || {}),
        ...Object.fromEntries(
          Object.entries(updatePayload)
            .filter(([key]) => key !== "contact_person_name")
            .map(([key, value]) => [key, value]),
        ),
      } as EmployerDetails;
      const savedAccount = response.data.account;
      const savedFormData = companyFormFromProfile(savedEmployer, savedProfile, savedAccount);
      setEmployerProfile({
        ...savedEmployer,
        profile_photo_url: response.data.profile_photo_url ?? employerProfile?.profile_photo_url ?? null,
      });
      originalFormData.current = savedFormData;
      setFormData(savedFormData);
      const savedProprietors = savedEmployer.employer_type === "UNREGISTERED_BUSINESS"
        ? savedProfile.proprietor_names || (savedProfile.proprietor_name ? [savedProfile.proprietor_name] : [])
        : [];
      setProprietorDetails({
        count: savedEmployer.employer_type === "UNREGISTERED_BUSINESS" && typeof savedProfile.number_of_proprietors === "number"
          ? savedProfile.number_of_proprietors
          : null,
        names: savedProprietors,
      });
      originalProprietorDetails.current = {
        count: savedEmployer.employer_type === "UNREGISTERED_BUSINESS" && typeof savedProfile.number_of_proprietors === "number"
          ? savedProfile.number_of_proprietors
          : null,
        names: savedProprietors,
      };
      setIsEditingProprietors(false);
      toast.success(`${isIndividual ? "Individual" : isUnregistered ? "Business" : "Company"} profile saved successfully!`);
    } catch (err: unknown) {
      toast.error(apiErrorMessage(err, "An error occurred while saving profile"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleProfilePhotoChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const profilePhotoUrl = await uploadPhoto(file);
      setEmployerProfile((previous) =>
        previous ? { ...previous, profile_photo_url: profilePhotoUrl } : previous,
      );
      await refreshUser();
      toast.success("Employer profile image updated");
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : apiErrorMessage(error, "Unable to upload profile image"));
    }
  };

  const handleRemoveProfilePhoto = async () => {
    if (!window.confirm("Remove your employer profile image?")) return;
    try {
      await removePhoto();
      setEmployerProfile((previous) =>
        previous ? { ...previous, profile_photo_url: null } : previous,
      );
      await refreshUser();
      toast.success("Employer profile image removed");
    } catch (error: unknown) {
      toast.error(apiErrorMessage(error, "Unable to remove profile image"));
    }
  };

  const formatAccountType = (type?: string) => {
    if (!type) return "Employer Account";
    switch (type) {
      case "REGISTERED_INDUSTRY":
        return "Registered Industry";
      case "REGISTERED_BUSINESS":
        return "Registered Business";
      case "UNREGISTERED_BUSINESS":
        return "Unregistered Business";
      case "INDIVIDUAL":
        return "Individual Employer";
      default:
        return type.replaceAll("_", " ");
    }
  };

  if (isLoading || isDataLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f6f8fd] dark:bg-slate-950">
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={36} className="animate-spin text-blue-600" />
          <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">
            Loading profile...
          </p>
        </div>
      </div>
    );
  }

  const rawCreatedAt = employerProfile?.created_at || user?.created_at;
  const memberSinceFormatted = rawCreatedAt
    ? new Date(rawCreatedAt).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "Recently Joined";

  const employerType = employerProfile?.employer_type;
  const isIndividual = employerType === "INDIVIDUAL";
  const isUnregistered = employerType === "UNREGISTERED_BUSINESS";
  const isRegistered = employerType === "REGISTERED_INDUSTRY" || employerType === "REGISTERED_BUSINESS";
  const profileTitle = isIndividual ? "Individual Profile" : isUnregistered ? "Business Profile" : "Company Profile";
  const profileDescription = isIndividual
    ? "Manage your personal contact details, location, and account settings."
    : isUnregistered
      ? "Manage your business details, operating address, and proprietor information."
      : "Manage your registered business identity, tax credentials, and company address.";

  // Preserve verification-sensitive identity rules
  const isIdentityLocked = isRegistered && (employerProfile?.onboarding_status === "COMPLETED" || employerProfile?.verification_status === "VERIFIED");

  const accountSummaryCard = (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900 space-y-4">
      <h3 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider pb-3 border-b border-slate-100 dark:border-slate-800">
        Account Summary
      </h3>

      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400">
          <Calendar size={18} />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">MEMBER SINCE</p>
          <p className="truncate text-sm font-bold text-slate-800 dark:text-slate-200">{memberSinceFormatted}</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400">
          <Briefcase size={18} />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">ACCOUNT TYPE</p>
          <p className="truncate text-sm font-bold text-slate-800 dark:text-slate-200">{formatAccountType(employerProfile?.employer_type)}</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
          <CheckCircle2 size={18} />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">STATUS</p>
          <div className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${employerProfile?.verification_status === "VERIFIED" ? "bg-emerald-500" : "bg-amber-500"}`} />
            <p className="truncate text-sm font-bold text-slate-800 dark:text-slate-200">
              {employerProfile?.verification_status || "Active"}
            </p>
          </div>
        </div>
      </div>

      {!isIndividual && (
        <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
          <Link
            href="/employer/director-profile"
            className="flex w-full items-center justify-between rounded-xl bg-slate-50 px-3.5 py-2.5 text-xs font-bold text-slate-700 transition hover:bg-blue-50 hover:text-blue-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-800/80 dark:hover:text-blue-400"
          >
            <span>{isUnregistered ? "Proprietor Profile" : "Director Profile"}</span>
            <ArrowRight size={14} />
          </Link>
        </div>
      )}
    </div>
  );

  return (
    <AccountManagementShell
      kind="employer"
      name={employerProfile?.contact_person_name || user?.name || "Employer"}
      accountLabel={formatEmployerType(employerType)}
      employerType={employerType}
      profileHref="/employer/company-profile"
      onLogout={() => void logout()}
    >
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6 pb-12">
        {/* Top Banner Card matching visual hierarchy */}
        <div className="relative overflow-hidden rounded-3xl bg-linear-to-r from-blue-700 via-indigo-700 to-slate-900 p-5 sm:p-6 text-white shadow-xl">
          {/* Ambient Background Accents */}
          <div className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-blue-500/20 blur-3xl" />

          <div className="relative z-10 flex flex-row items-center justify-between gap-4 sm:gap-5">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-bold uppercase tracking-wide text-white">
                  <Briefcase size={13} />
                  {formatAccountType(employerType)}
                </span>
                {employerProfile?.verification_status === "VERIFIED" ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 border border-emerald-400/40 px-3 py-1 text-xs font-semibold text-emerald-200">
                    <CheckCircle2 size={13} className="text-emerald-300" />
                    {isIndividual ? "Verified Individual" : "Verified Enterprise"}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 border border-amber-400/40 px-3 py-1 text-xs font-semibold text-amber-200">
                    <Info size={13} className="text-amber-300" />
                    Verification Pending
                  </span>
                )}
              </div>

              <h1 className="break-words text-2xl font-bold text-white sm:text-3xl">
                {formData.business_name || employerProfile?.contact_person_name || profileTitle}
              </h1>
              <p className="mt-1 text-sm text-blue-100 max-w-xl">
                {profileDescription}
              </p>
            </div>

            <div className="flex shrink-0 flex-col items-center gap-2">
              <div className="flex h-16 w-16 sm:h-20 sm:w-20 items-center justify-center overflow-hidden rounded-full border-4 border-white/20 bg-linear-to-br from-blue-500 to-indigo-600 text-2xl sm:text-3xl font-extrabold text-white shadow-xl backdrop-blur-md">
                {employerProfile?.profile_photo_url ? (
                  <img src={employerProfile.profile_photo_url} alt={isIndividual ? "Profile photo" : "Business logo"} className="h-full w-full object-cover" />
                ) : (
                  (formData.business_name || employerProfile?.contact_person_name || "E").charAt(0).toUpperCase()
                )}
              </div>
              <input
                ref={profilePhotoInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleProfilePhotoChange}
                className="hidden"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => profilePhotoInputRef.current?.click()}
                  disabled={isPhotoUploading}
                  className="inline-flex min-h-8 items-center gap-1 rounded-full bg-white/95 px-2.5 text-xs font-semibold text-blue-700 shadow-sm transition hover:bg-white disabled:opacity-50"
                  title={employerProfile?.profile_photo_url ? "Change profile image" : "Upload profile image"}
                >
                  {isPhotoUploading ? <Loader2 size={13} className="animate-spin" /> : <Camera size={13} />}
                  Edit
                </button>
                {employerProfile?.profile_photo_url && (
                  <button
                    type="button"
                    onClick={() => void handleRemoveProfilePhoto()}
                    disabled={isPhotoUploading}
                    className="inline-flex min-h-8 items-center gap-1 rounded-full bg-white/95 px-2.5 text-xs font-semibold text-red-700 shadow-sm transition hover:bg-white disabled:opacity-50"
                    title="Remove profile image"
                  >
                    <Trash2 size={13} />
                    Delete
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Mobile Profile Summary: Visible at top after header */}
        <div className="lg:hidden">
          {accountSummaryCard}
        </div>

        {/* Two-Column Grid Layout matching Worker Profile structure */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          {/* Left Column (Span 2): Type-specific profile forms */}
          <div className="lg:col-span-2 space-y-6">
            <form onSubmit={handleSave} className="space-y-6">
              {/* Section 1: Business / Personal Identity */}
              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100 dark:border-slate-800">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400">
                      {isIndividual ? <User size={20} /> : <Building2 size={20} />}
                    </div>
                    <div>
                      <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                        {isIndividual ? "Personal Information" : isUnregistered ? "Business Details" : "Company Details"}
                      </h2>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {isIndividual
                          ? "Your primary individual employer identity details"
                          : isUnregistered
                            ? "Identity and registration information for your unregistered business"
                            : "Verified enterprise identity details and registration codes"}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsEditingIdentity((v) => !v)}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40 transition cursor-pointer"
                  >
                    <Edit3 size={13} />
                    {isEditingIdentity ? "Done" : "Edit"}
                  </button>
                </div>

                <div className="space-y-3">
                  {/* Business / Personal Name */}
                  {isEditingIdentity ? (
                    <div>
                      <label className="mb-1.5 flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-300">
                        <span className="flex items-center gap-1.5">
                          {isIndividual ? (
                            <User size={14} className="text-blue-600 dark:text-blue-400" />
                          ) : (
                            <Building2 size={14} className="text-blue-600 dark:text-blue-400" />
                          )}
                          {isIndividual ? "Full Name" : isUnregistered ? "Business Name" : "Company Name"}
                        </span>
                        {isIdentityLocked && (
                          <span className="flex items-center gap-1 text-[11px] font-medium text-slate-400 dark:text-slate-500">
                            <Lock size={12} /> Verified Identity
                          </span>
                        )}
                      </label>
                      <input
                        type="text"
                        required
                        value={formData.business_name || ""}
                        onChange={(e) => setFormData({ ...formData, business_name: e.target.value })}
                        disabled={isIdentityLocked}
                        placeholder={isIndividual ? "Your full name" : isUnregistered ? "e.g. Acme Stores" : "e.g. Acme Technologies Pvt Ltd"}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-sm font-semibold text-slate-900 outline-hidden transition focus:border-blue-500 focus:bg-white disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-white dark:disabled:bg-slate-800/80 dark:disabled:text-slate-400"
                      />
                      {isIdentityLocked && (
                        <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                          Verified legal entity name is locked. To modify registered legal details, contact support.
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-xl bg-slate-50 p-3 border border-slate-100 dark:bg-slate-800/50 dark:border-slate-800">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                        {isIndividual ? "FULL NAME" : isUnregistered ? "BUSINESS NAME" : "COMPANY NAME"}
                        {isIdentityLocked && (
                          <span className="ml-2 inline-flex items-center gap-1 normal-case font-medium text-slate-400 dark:text-slate-500">
                            <Lock size={11} /> Verified Identity
                          </span>
                        )}
                      </p>
                      <p className="mt-1 text-sm font-bold text-slate-800 dark:text-slate-100">
                        {formData.business_name || "Not set"}
                      </p>
                    </div>
                  )}

                  {/* Tax / Registration Codes for Registered Enterprise */}
                  {isRegistered && (
                    <div className={`grid gap-3 sm:grid-cols-3 pt-2`}>
                      {isEditingIdentity ? (
                        <>
                          <div>
                            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300">
                              <FileText size={14} className="text-blue-600 dark:text-blue-400" />
                              <span>GSTIN</span>
                            </label>
                            <input
                              type="text"
                              value={formData.gstin || ""}
                              onChange={(e) => setFormData({ ...formData, gstin: e.target.value })}
                              placeholder="22AAAAA0000A1Z5"
                              className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2.5 text-sm font-semibold text-slate-900 outline-hidden transition focus:border-blue-500 focus:bg-white dark:border-slate-800 dark:bg-slate-800/50 dark:text-white"
                            />
                          </div>
                          <div>
                            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300">
                              <Hash size={14} className="text-blue-600 dark:text-blue-400" />
                              <span>CIN Number</span>
                            </label>
                            <input
                              type="text"
                              value={formData.cin_number || ""}
                              onChange={(e) => setFormData({ ...formData, cin_number: e.target.value })}
                              placeholder="U72200DL2024PTC123456"
                              className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2.5 text-sm font-semibold text-slate-900 outline-hidden transition focus:border-blue-500 focus:bg-white dark:border-slate-800 dark:bg-slate-800/50 dark:text-white"
                            />
                          </div>
                          <div>
                            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300">
                              <CreditCard size={14} className="text-blue-600 dark:text-blue-400" />
                              <span>PAN Number</span>
                            </label>
                            <input
                              type="text"
                              value={formData.pan_number || ""}
                              onChange={(e) => setFormData({ ...formData, pan_number: e.target.value })}
                              placeholder="ABCDE1234F"
                              className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2.5 text-sm font-semibold text-slate-900 outline-hidden transition focus:border-blue-500 focus:bg-white dark:border-slate-800 dark:bg-slate-800/50 dark:text-white"
                            />
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="rounded-xl bg-slate-50 p-3 border border-slate-100 dark:bg-slate-800/50 dark:border-slate-800">
                            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">GSTIN</p>
                            <p className="mt-1 text-sm font-bold text-slate-800 dark:text-slate-100">{formData.gstin || "Not set"}</p>
                          </div>
                          <div className="rounded-xl bg-slate-50 p-3 border border-slate-100 dark:bg-slate-800/50 dark:border-slate-800">
                            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">CIN NUMBER</p>
                            <p className="mt-1 text-sm font-bold text-slate-800 dark:text-slate-100">{formData.cin_number || "Not set"}</p>
                          </div>
                          <div className="rounded-xl bg-slate-50 p-3 border border-slate-100 dark:bg-slate-800/50 dark:border-slate-800">
                            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">PAN NUMBER</p>
                            <p className="mt-1 text-sm font-bold text-slate-800 dark:text-slate-100">{formData.pan_number || "Not set"}</p>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {/* Proprietor Information Summary for Unregistered Business */}
                  {isUnregistered && (
                    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-800/40">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-bold text-slate-900 dark:text-white">Proprietor Information</h4>
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => setIsEditingProprietors((editing) => !editing)}
                            className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                          >
                            {isEditingProprietors ? "Done" : "Edit"}
                          </button>
                          <Link
                            href="/employer/director-profile"
                            className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                          >
                            Manage Proprietor Details <ArrowRight size={13} />
                          </Link>
                        </div>
                      </div>
                      {isEditingProprietors ? (
                        <div className="mt-3 space-y-3">
                          <div>
                            <label className="mb-1.5 block text-xs font-bold text-slate-700 dark:text-slate-300">
                              Number of Proprietors
                            </label>
                            <input
                              type="number"
                              min={1}
                              step={1}
                              value={proprietorDetails.count ?? ""}
                              onChange={(event) => setProprietorDetails((current) => ({
                                ...current,
                                count: event.target.value === "" ? null : Number(event.target.value),
                              }))}
                              className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-900 outline-hidden transition focus:border-blue-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
                            />
                          </div>
                          <div>
                            <label className="mb-1.5 block text-xs font-bold text-slate-700 dark:text-slate-300">
                              Proprietor Names
                            </label>
                            <textarea
                              rows={Math.min(6, Math.max(2, proprietorDetails.count || 2))}
                              value={proprietorDetails.names.join("\n")}
                              onChange={(event) => setProprietorDetails((current) => ({
                                ...current,
                                names: event.target.value.split(/\r?\n/).map((name) => name.trim()).filter(Boolean),
                              }))}
                              placeholder="Enter one proprietor name per line"
                              className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-900 outline-hidden transition focus:border-blue-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
                            />
                          </div>
                        </div>
                      ) : (
                        <>
                          {proprietorDetails.count !== null && (
                            <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                              Number of Proprietors: <span className="font-semibold text-slate-900 dark:text-white">{proprietorDetails.count}</span>
                            </p>
                          )}
                          {proprietorDetails.names.length > 0 && (
                            <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                              Proprietor Names: <span className="font-semibold text-slate-900 dark:text-white">{proprietorDetails.names.join(", ")}</span>
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </section>

              {/* Section 2: Contact Information */}
              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100 dark:border-slate-800">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400">
                      <Phone size={20} />
                    </div>
                    <div>
                      <h2 className="text-lg font-bold text-slate-900 dark:text-white">Contact Information</h2>
                      <p className="text-xs text-slate-500 dark:text-slate-400">Primary phone and email used for communication and notifications</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsEditingContact((v) => !v)}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40 transition cursor-pointer"
                  >
                    <Edit3 size={13} />
                    {isEditingContact ? "Done" : "Edit"}
                  </button>
                </div>

                {isEditingContact ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300">
                        <Phone size={14} className="text-blue-600 dark:text-blue-400" />
                        <span>{isIndividual ? "Phone Number" : "Company Phone"}</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={formData.company_phone || ""}
                        onChange={(e) => setFormData({ ...formData, company_phone: e.target.value })}
                        placeholder="+91 98765 43210"
                        className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-sm font-semibold text-slate-900 outline-hidden transition focus:border-blue-500 focus:bg-white dark:border-slate-800 dark:bg-slate-800/50 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300">
                        <Mail size={14} className="text-blue-600 dark:text-blue-400" />
                        <span>{isIndividual ? "Email Address" : "Company Email"}</span>
                      </label>
                      <input
                        type="email"
                        required
                        value={formData.company_email || ""}
                        onChange={(e) => setFormData({ ...formData, company_email: e.target.value })}
                        placeholder="contact@businessmall.com"
                        className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-sm font-semibold text-slate-900 outline-hidden transition focus:border-blue-500 focus:bg-white dark:border-slate-800 dark:bg-slate-800/50 dark:text-white"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl bg-slate-50 p-3 border border-slate-100 dark:bg-slate-800/50 dark:border-slate-800">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                        {isIndividual ? "PHONE NUMBER" : "COMPANY PHONE"}
                      </p>
                      <p className="mt-1 text-sm font-bold text-slate-800 dark:text-slate-100">{formData.company_phone || "Not set"}</p>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-3 border border-slate-100 dark:bg-slate-800/50 dark:border-slate-800">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                        {isIndividual ? "EMAIL ADDRESS" : "COMPANY EMAIL"}
                      </p>
                      <p className="mt-1 text-sm font-bold text-slate-800 dark:text-slate-100">{formData.company_email || "Not set"}</p>
                    </div>
                  </div>
                )}
              </section>

              {/* Section 3: Location & Address */}
              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100 dark:border-slate-800">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400">
                      <MapPin size={20} />
                    </div>
                    <div>
                      <h2 className="text-lg font-bold text-slate-900 dark:text-white">Location &amp; Address</h2>
                      <p className="text-xs text-slate-500 dark:text-slate-400">Physical address and regional work location details</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsEditingAddress((v) => !v)}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40 transition cursor-pointer"
                  >
                    <Edit3 size={13} />
                    {isEditingAddress ? "Done" : "Edit"}
                  </button>
                </div>

                <div className="space-y-3">
                  {/* Address field */}
                  {isEditingAddress ? (
                    <div>
                      <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300">
                        <MapPin size={14} className="text-blue-600 dark:text-blue-400" />
                        <span>{isIndividual ? "Address" : isUnregistered ? "Business Address" : "Registered Office Address"}</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={formData.address || ""}
                        onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                        placeholder="123 Commerce Way, Suite 500"
                        className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-sm font-semibold text-slate-900 outline-hidden transition focus:border-blue-500 focus:bg-white dark:border-slate-800 dark:bg-slate-800/50 dark:text-white"
                      />
                    </div>
                  ) : (
                    <div className="rounded-xl bg-slate-50 p-3 border border-slate-100 dark:bg-slate-800/50 dark:border-slate-800">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                        {isIndividual ? "ADDRESS" : isUnregistered ? "BUSINESS ADDRESS" : "REGISTERED OFFICE ADDRESS"}
                      </p>
                      <p className="mt-1 text-sm font-bold text-slate-800 dark:text-slate-100">{formData.address || "Not set"}</p>
                    </div>
                  )}

                  {/* City / State / Pincode / Work Location — Individual & Unregistered */}
                  {(isIndividual || isUnregistered) && (
                    isEditingAddress ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300">
                            <MapPin size={14} className="text-blue-600 dark:text-blue-400" />
                            <span>City</span>
                          </label>
                          <input
                            type="text"
                            value={formData.city || ""}
                            onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                            placeholder="e.g. Pune"
                            className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-sm font-semibold text-slate-900 outline-hidden transition focus:border-blue-500 focus:bg-white dark:border-slate-800 dark:bg-slate-800/50 dark:text-white"
                          />
                        </div>
                        <div>
                          <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300">
                            <MapPin size={14} className="text-blue-600 dark:text-blue-400" />
                            <span>State</span>
                          </label>
                          <input
                            type="text"
                            value={formData.state || ""}
                            onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                            placeholder="e.g. Maharashtra"
                            className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-sm font-semibold text-slate-900 outline-hidden transition focus:border-blue-500 focus:bg-white dark:border-slate-800 dark:bg-slate-800/50 dark:text-white"
                          />
                        </div>
                        <div>
                          <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300">
                            <MapPin size={14} className="text-blue-600 dark:text-blue-400" />
                            <span>Pincode</span>
                          </label>
                          <input
                            type="text"
                            value={formData.pincode || ""}
                            onChange={(e) => setFormData({ ...formData, pincode: e.target.value })}
                            placeholder="6-digit postal code"
                            className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-sm font-semibold text-slate-900 outline-hidden transition focus:border-blue-500 focus:bg-white dark:border-slate-800 dark:bg-slate-800/50 dark:text-white"
                          />
                        </div>
                        <div>
                          <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300">
                            <MapPin size={14} className="text-blue-600 dark:text-blue-400" />
                            <span>Work Location</span>
                          </label>
                          <input
                            type="text"
                            value={formData.work_location || ""}
                            onChange={(e) => setFormData({ ...formData, work_location: e.target.value })}
                            placeholder="Operating area or landmark"
                            className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-sm font-semibold text-slate-900 outline-hidden transition focus:border-blue-500 focus:bg-white dark:border-slate-800 dark:bg-slate-800/50 dark:text-white"
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-xl bg-slate-50 p-3 border border-slate-100 dark:bg-slate-800/50 dark:border-slate-800">
                          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">CITY</p>
                          <p className="mt-1 text-sm font-bold text-slate-800 dark:text-slate-100">{formData.city || "Not set"}</p>
                        </div>
                        <div className="rounded-xl bg-slate-50 p-3 border border-slate-100 dark:bg-slate-800/50 dark:border-slate-800">
                          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">STATE</p>
                          <p className="mt-1 text-sm font-bold text-slate-800 dark:text-slate-100">{formData.state || "Not set"}</p>
                        </div>
                        <div className="rounded-xl bg-slate-50 p-3 border border-slate-100 dark:bg-slate-800/50 dark:border-slate-800">
                          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">PINCODE</p>
                          <p className="mt-1 text-sm font-bold text-slate-800 dark:text-slate-100">{formData.pincode || "Not set"}</p>
                        </div>
                        <div className="rounded-xl bg-slate-50 p-3 border border-slate-100 dark:bg-slate-800/50 dark:border-slate-800">
                          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">WORK LOCATION</p>
                          <p className="mt-1 text-sm font-bold text-slate-800 dark:text-slate-100">{formData.work_location || "Not set"}</p>
                        </div>
                      </div>
                    )
                  )}

                  {isRegistered && (
                    <div className="mt-4 flex items-start gap-3 rounded-xl border border-blue-100 bg-blue-50/70 p-4 dark:border-blue-900/40 dark:bg-blue-950/30">
                      <Info size={18} className="shrink-0 text-blue-600 dark:text-blue-400 mt-0.5" />
                      <p className="text-xs text-blue-900 dark:text-blue-200 leading-relaxed">
                        Changes to verified tax identifiers (GST, PAN) or registered entity address will trigger a mandatory compliance re-verification.
                      </p>
                    </div>
                  )}
                </div>
              </section>


              {/* Save Action Area */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">Save Profile Changes</h3>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Ensure your {isIndividual ? "personal and contact" : "business and operational"} information is accurate.
                  </p>
                </div>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="w-full sm:w-auto inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-bold text-white shadow-md transition hover:bg-blue-700 active:scale-95 disabled:opacity-50 cursor-pointer shrink-0"
                >
                  {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                  <span>{isSaving ? "Saving Changes..." : "Save Changes"}</span>
                </button>
              </div>
            </form>
          </div>

          {/* Right Column (Span 1): Account Overview + Informational/Safety Card */}
          <div className="space-y-6 lg:sticky lg:top-6">
            {/* Desktop Account Summary */}
            <div className="hidden lg:block">
              {accountSummaryCard}
            </div>

            {/* Informational / Safety Card with Employer Blue/Indigo Identity */}
            <section className="relative overflow-hidden rounded-2xl bg-linear-to-br from-blue-700 via-indigo-700 to-blue-900 p-6 text-white text-center shadow-lg">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-white/20 backdrop-blur-md">
                <ShieldCheck size={32} className="text-white" />
              </div>
              <h3 className="text-lg font-bold text-white">
                Verified Employer Network
              </h3>
              <p className="mt-2 text-xs text-blue-100 leading-relaxed max-w-xs mx-auto">
                Your business credentials, hiring records, and payment data are encrypted with enterprise-grade security.
              </p>
              <div className="mt-6 flex justify-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-white" />
                <span className="h-2 w-2 rounded-full bg-white/40" />
                <span className="h-2 w-2 rounded-full bg-white/40" />
              </div>
            </section>
          </div>
        </div>
      </main>
    </AccountManagementShell>
  );
}
