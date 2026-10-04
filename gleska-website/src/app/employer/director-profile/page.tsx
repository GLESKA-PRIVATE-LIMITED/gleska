"use client";

import React from "react";
import Link from "next/link";
import axios from "axios";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import apiClient from "@/lib/api";
import { useEmployerProfilePhoto } from "@/lib/useEmployerProfilePhoto";
import {
  User,
  Camera,
  Save,
  Phone,
  Mail,
  MapPin,
  Hash,
  CreditCard,
  Heart,
  Calendar,
  Briefcase,
  CheckCircle2,
  Loader2,
  ShieldCheck,
  FileText,
  ArrowLeft,
  Building2,
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

interface DirectorFormData {
  director_name: string;
  director_email: string;
  director_phone: string;
  director_address: string;
  director_aadhaar: string;
  director_pan: string;
  director_din: string;
  director_blood_group: string;
}

type DirectorUpdateField =
  | "director_name"
  | "director_email"
  | "director_phone"
  | "director_address"
  | "director_aadhaar"
  | "director_pan"
  | "director_din"
  | "director_blood_group";

interface EmployerMeResponse {
  employer: EmployerProfile;
  profile_photo_url?: string | null;
  account: {
    name: string;
    email?: string | null;
    mobile?: string | null;
  };
  profile: Record<string, unknown>;
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

function directorFormFromProfile(
  employer: EmployerProfile,
  details: Record<string, unknown>,
  account: EmployerMeResponse["account"],
): DirectorFormData {
  const metadata =
    Array.isArray(details.director_data) &&
    details.director_data[0] &&
    typeof details.director_data[0] === "object"
      ? details.director_data[0] as Record<string, unknown>
      : {};
  const isUnregistered = employer.employer_type === "UNREGISTERED_BUSINESS";
  const value = (key: string, fallback: unknown = ""): string => {
    const candidate = Object.prototype.hasOwnProperty.call(details, key)
      ? details[key]
      : fallback;
    return candidate == null ? "" : String(candidate);
  };
  const directorNameKey = isUnregistered ? "proprietor_name" : "director_name";
  const aadhaarKey = isUnregistered ? "proprietor_aadhaar" : "director_aadhaar";
  const directorNameFallback = isUnregistered
    ? (Array.isArray(details.proprietor_names) ? details.proprietor_names[0] : employer.contact_person_name)
    : employer.contact_person_name || account.name;

  return {
    director_name: value(directorNameKey, directorNameFallback),
    director_email: value("director_email", details.company_email ?? account.email),
    director_phone: value("director_phone", details.company_phone ?? account.mobile),
    director_address: value(
      "director_address",
      details.address ?? details.registered_address ?? [details.city, details.state].filter(Boolean).join(", "),
    ),
    director_aadhaar: value(aadhaarKey),
    director_pan: value("pan_number"),
    director_din: metadata.din == null ? "" : String(metadata.din),
    director_blood_group: metadata.blood_group == null ? "" : String(metadata.blood_group),
  };
}

export default function DirectorProfilePage() {
  const router = useRouter();
  const { user, isLoading, logout, refreshUser } = useAuth();
  const [employerProfile, setEmployerProfile] = React.useState<EmployerProfile | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isDataLoading, setIsDataLoading] = React.useState(true);
  const [isUnregistered, setIsUnregistered] = React.useState(false);
  const [isEditingInfo, setIsEditingInfo] = React.useState(false);
  const [isEditingVerification, setIsEditingVerification] = React.useState(false);
  const originalFormData = React.useRef<DirectorFormData | null>(null);
  const profilePhotoInputRef = React.useRef<HTMLInputElement>(null);
  const { isUploading: isPhotoUploading, uploadPhoto, removePhoto } = useEmployerProfilePhoto();

  // Director / Proprietor Form State
  const [formData, setFormData] = React.useState<DirectorFormData>({
    director_name: "",
    director_email: "",
    director_phone: "",
    director_address: "",
    director_aadhaar: "",
    director_pan: "",
    director_din: "",
    director_blood_group: "",
  });

  React.useEffect(() => {
    if (!isLoading && !user) {
      router.replace("/employer/auth");
      return;
    }

    if (!isLoading && user && user.role !== "EMPLOYER") {
      router.replace("/");
      return;
    }

    const fetchDirectorData = async () => {
      setIsDataLoading(true);
      try {
        const response = await apiClient.get<EmployerMeResponse>("/api/v1/employers/me", {
          withCredentials: true,
        });

        const emp = response.data.employer;
        const det = response.data.profile || {};

        if (emp) {
          setEmployerProfile({ ...emp, profile_photo_url: response.data.profile_photo_url ?? null });
          if (emp.employer_type === "INDIVIDUAL") {
            router.replace("/employer/company-profile");
            return;
          }
          setIsUnregistered(emp.employer_type === "UNREGISTERED_BUSINESS");
        }

        const loadedFormData = directorFormFromProfile(emp, det, response.data.account);
        originalFormData.current = loadedFormData;
        setFormData(loadedFormData);
      } catch (err: unknown) {
        console.error("Failed to load director details from API:", err);
        toast.error(apiErrorMessage(err, "Unable to load director profile"));
      } finally {
        setIsDataLoading(false);
      }
    };

    if (user) {
      fetchDirectorData();
    }
  }, [user, isLoading, router]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const employerType = employerProfile?.employer_type;
      const identityLocked = employerProfile?.onboarding_status === "COMPLETED";
      const previous = originalFormData.current || formData;
      const editableFields: DirectorUpdateField[] = isUnregistered
        ? (["director_name", "director_aadhaar"] as DirectorUpdateField[])
        : [
            "director_name",
            "director_email",
            "director_phone",
            "director_address",
            "director_aadhaar",
            "director_pan",
            ...(employerType === "REGISTERED_INDUSTRY" ? ["director_din", "director_blood_group"] : []),
          ] as DirectorUpdateField[];
      const updatePayload: Record<string, string | null> = {};
      for (const field of editableFields) {
        if (identityLocked && ["director_name", "director_aadhaar", "director_pan"].includes(field)) {
          continue;
        }
        const currentValue = formData[field].trim();
        const previousValue = previous[field]?.trim() || "";
        if (currentValue !== previousValue) {
          updatePayload[field] = currentValue || null;
        }
      }
      if (!Object.keys(updatePayload).length) {
        toast.info("There are no profile changes to save");
        return;
      }

      const response = await apiClient.put<EmployerMeResponse>(
        "/api/v1/employers/director-profile",
        updatePayload,
        { withCredentials: true }
      );

      const savedEmployer = response.data.employer || employerProfile;
      const savedDetails = { ...(response.data.profile || {}) };
      const mappedUpdates: Record<string, string | null> = {};
      for (const [field, value] of Object.entries(updatePayload)) {
        const storedField = field === "director_name" && isUnregistered
          ? "proprietor_name"
          : field === "director_aadhaar" && isUnregistered
            ? "proprietor_aadhaar"
            : field === "director_pan"
              ? "pan_number"
              : field;
        if (!Object.prototype.hasOwnProperty.call(savedDetails, storedField)) {
          mappedUpdates[storedField] = value;
        }
      }
      const savedFormData = directorFormFromProfile(
        savedEmployer,
        { ...savedDetails, ...mappedUpdates },
        response.data.account || { name: user?.name || "" },
      );
      setEmployerProfile({
        ...savedEmployer,
        profile_photo_url: response.data.profile_photo_url ?? employerProfile?.profile_photo_url ?? null,
      });
      originalFormData.current = savedFormData;
      setFormData(savedFormData);
      toast.success(`${isUnregistered ? "Proprietor" : "Director"} Profile saved successfully!`);
    } catch (err: unknown) {
      toast.error(apiErrorMessage(err, "An error occurred while saving director details"));
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
            Loading {isUnregistered ? "Proprietor" : "Director"} Profile...
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

  const pageTitle = isUnregistered ? "Proprietor Profile" : "Director Profile";
  const pageDescription = isUnregistered
    ? "Manage your proprietor identity, contact, and address details."
    : "Manage your director identity, verification numbers, and contact credentials.";
  const isRegisteredIndustry = employerProfile?.employer_type === "REGISTERED_INDUSTRY";
  const identityLocked = employerProfile?.onboarding_status === "COMPLETED";

  const profileOverviewCard = (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900 space-y-4">
      <h3 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider pb-3 border-b border-slate-100 dark:border-slate-800">
        Profile Overview
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
            <span className={`h-2 w-2 rounded-full ${employerProfile?.verification_status === "VERIFIED" ? "bg-emerald-500" : "bg-blue-500"}`} />
            <p className="truncate text-sm font-bold text-slate-800 dark:text-slate-200">
              {employerProfile?.verification_status || "Active"}
            </p>
          </div>
        </div>
      </div>

      <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
        <Link
          href="/employer/company-profile"
          className="flex w-full items-center justify-between rounded-xl bg-slate-50 px-3.5 py-2.5 text-xs font-bold text-slate-700 transition hover:bg-blue-50 hover:text-blue-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-800/80 dark:hover:text-blue-400"
        >
          <span className="flex items-center gap-1.5">
            <Building2 size={14} /> Back to Company Profile
          </span>
          <ArrowLeft size={14} />
        </Link>
      </div>
    </div>
  );

  return (
    <AccountManagementShell
      kind="employer"
      name={employerProfile?.contact_person_name || user?.name || "Employer"}
      accountLabel={formatEmployerType(employerProfile?.employer_type)}
      employerType={employerProfile?.employer_type}
      profileHref="/employer/company-profile"
      onLogout={() => void logout()}
    >
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6 pb-12">
        {/* Top Banner Card matching Employer Visual Identity */}
        <div className="relative overflow-hidden rounded-3xl bg-linear-to-r from-blue-700 via-indigo-700 to-slate-900 p-5 sm:p-6 text-white shadow-xl">
          {/* Ambient Background Accents */}
          <div className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-blue-500/20 blur-3xl" />

          <div className="relative z-10 flex flex-row items-center justify-between gap-4 sm:gap-5">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-bold uppercase tracking-wide text-white">
                  <Briefcase size={13} />
                  {formatAccountType(employerProfile?.employer_type)}
                </span>
                {employerProfile?.verification_status === "VERIFIED" ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 border border-emerald-400/40 px-3 py-1 text-xs font-semibold text-emerald-200">
                    <CheckCircle2 size={13} className="text-emerald-300" />
                    Verified Enterprise
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/20 border border-blue-400/40 px-3 py-1 text-xs font-semibold text-blue-200">
                    <User size={13} className="text-blue-300" />
                    {isUnregistered ? "Proprietor Record" : "Director Record"}
                  </span>
                )}
              </div>

              <h1 className="break-words text-2xl font-bold text-white sm:text-3xl">
                {formData.director_name || employerProfile?.contact_person_name || pageTitle}
              </h1>
              <p className="mt-1 text-sm text-blue-100 max-w-xl">
                {pageDescription}
              </p>
            </div>

            <div className="flex shrink-0 flex-col items-center gap-2">
              <div className="flex h-16 w-16 sm:h-20 sm:w-20 items-center justify-center overflow-hidden rounded-full border-4 border-white/20 bg-linear-to-br from-blue-500 to-indigo-600 text-2xl sm:text-3xl font-extrabold text-white shadow-xl backdrop-blur-md">
                {employerProfile?.profile_photo_url ? (
                  <img src={employerProfile.profile_photo_url} alt="Employer profile image" className="h-full w-full object-cover" />
                ) : (
                  (formData.director_name || employerProfile?.contact_person_name || "D").charAt(0).toUpperCase()
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
                  title={employerProfile?.profile_photo_url ? "Change employer profile image" : "Upload employer profile image"}
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
                    title="Remove employer profile image"
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
          {profileOverviewCard}
        </div>

        {/* Two-Column Grid Layout matching Worker/Company Profile structure */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          {/* Left Column (Span 2): Director Form Cards */}
          <div className="lg:col-span-2 space-y-6">
            <form onSubmit={handleSave} className="space-y-6">
              {/* Section 1: Personal & Contact Information */}
              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100 dark:border-slate-800">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400">
                      <User size={20} />
                    </div>
                    <div>
                      <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                        {isUnregistered ? "Proprietor Information" : "Director Information"}
                      </h2>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Authorized {isUnregistered ? "proprietor" : "director"} personal and communication details
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsEditingInfo((v) => !v)}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40 transition cursor-pointer"
                  >
                    <Edit3 size={13} />
                    {isEditingInfo ? "Done" : "Edit"}
                  </button>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  {isEditingInfo ? (
                    <>
                      <div>
                        <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300">
                          <User size={14} className="text-blue-600 dark:text-blue-400" />
                          <span>{isUnregistered ? "Proprietor Name" : "Director Name"}</span>
                        </label>
                        <input
                          type="text"
                          required
                          disabled={identityLocked}
                          value={formData.director_name || ""}
                          onChange={(e) => setFormData({ ...formData, director_name: e.target.value })}
                          placeholder="Enter full name"
                          className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-sm font-semibold text-slate-900 outline-hidden transition focus:border-blue-500 focus:bg-white dark:border-slate-800 dark:bg-slate-800/50 dark:text-white"
                        />
                      </div>

                      <div>
                        <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300">
                          <Phone size={14} className="text-blue-600 dark:text-blue-400" />
                          <span>Phone Number</span>
                        </label>
                        <input
                          type="text"
                          required={!isUnregistered}
                          disabled={isUnregistered}
                          value={formData.director_phone || ""}
                          onChange={(e) => setFormData({ ...formData, director_phone: e.target.value })}
                          placeholder="+91 98765 43210"
                          className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-sm font-semibold text-slate-900 outline-hidden transition focus:border-blue-500 focus:bg-white dark:border-slate-800 dark:bg-slate-800/50 dark:text-white"
                        />
                      </div>

                      <div>
                        <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300">
                          <Mail size={14} className="text-blue-600 dark:text-blue-400" />
                          <span>Email Address</span>
                        </label>
                        <input
                          type="email"
                          required={!isUnregistered}
                          disabled={isUnregistered}
                          value={formData.director_email || ""}
                          onChange={(e) => setFormData({ ...formData, director_email: e.target.value })}
                          placeholder="director@company.com"
                          className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-sm font-semibold text-slate-900 outline-hidden transition focus:border-blue-500 focus:bg-white dark:border-slate-800 dark:bg-slate-800/50 dark:text-white"
                        />
                      </div>

                      <div>
                        <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300">
                          <MapPin size={14} className="text-blue-600 dark:text-blue-400" />
                          <span>Residential Address</span>
                        </label>
                        <input
                          type="text"
                          required={!isUnregistered}
                          disabled={isUnregistered}
                          value={formData.director_address || ""}
                          onChange={(e) => setFormData({ ...formData, director_address: e.target.value })}
                          placeholder="Enter residential address"
                          className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-sm font-semibold text-slate-900 outline-hidden transition focus:border-blue-500 focus:bg-white dark:border-slate-800 dark:bg-slate-800/50 dark:text-white"
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="rounded-xl bg-slate-50 p-3 border border-slate-100 dark:bg-slate-800/50 dark:border-slate-800">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">{isUnregistered ? "PROPRIETOR NAME" : "DIRECTOR NAME"}</p>
                        <p className="mt-1 text-sm font-bold text-slate-800 dark:text-slate-100">{formData.director_name || "Not set"}</p>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-3 border border-slate-100 dark:bg-slate-800/50 dark:border-slate-800">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">PHONE NUMBER</p>
                        <p className="mt-1 text-sm font-bold text-slate-800 dark:text-slate-100">{formData.director_phone || "Not set"}</p>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-3 border border-slate-100 dark:bg-slate-800/50 dark:border-slate-800">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">EMAIL ADDRESS</p>
                        <p className="mt-1 text-sm font-bold text-slate-800 dark:text-slate-100">{formData.director_email || "Not set"}</p>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-3 border border-slate-100 dark:bg-slate-800/50 dark:border-slate-800">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">RESIDENTIAL ADDRESS</p>
                        <p className="mt-1 text-sm font-bold text-slate-800 dark:text-slate-100">{formData.director_address || "Not set"}</p>
                      </div>
                    </>
                  )}
                </div>
              </section>

              {/* Section 2: Identification & Verification Numbers */}
              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100 dark:border-slate-800">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400">
                      <FileText size={20} />
                    </div>
                    <div>
                      <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                        Identity &amp; Verification
                      </h2>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Government identification numbers for statutory compliance
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsEditingVerification((v) => !v)}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40 transition cursor-pointer"
                  >
                    <Edit3 size={13} />
                    {isEditingVerification ? "Done" : "Edit"}
                  </button>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  {isEditingVerification ? (
                    <>
                      <div>
                        <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300">
                          <FileText size={14} className="text-blue-600 dark:text-blue-400" />
                          <span>{isUnregistered ? "Proprietor Aadhaar" : "Director Aadhaar"}</span>
                        </label>
                        <input
                          type="text"
                          disabled={identityLocked}
                          value={formData.director_aadhaar || ""}
                          onChange={(e) => setFormData({ ...formData, director_aadhaar: e.target.value })}
                          placeholder="12-digit Aadhaar Number"
                          className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-sm font-semibold text-slate-900 outline-hidden transition focus:border-blue-500 focus:bg-white dark:border-slate-800 dark:bg-slate-800/50 dark:text-white"
                        />
                      </div>

                      {!isUnregistered && (
                        <>
                          <div>
                            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300">
                              <Hash size={14} className="text-blue-600 dark:text-blue-400" />
                              <span>DIN Number</span>
                            </label>
                            <input
                              type="text"
                              disabled={!isRegisteredIndustry}
                              value={formData.director_din || ""}
                              onChange={(e) => setFormData({ ...formData, director_din: e.target.value })}
                              placeholder="8-digit DIN"
                              className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-sm font-semibold text-slate-900 outline-hidden transition focus:border-blue-500 focus:bg-white dark:border-slate-800 dark:bg-slate-800/50 dark:text-white"
                            />
                          </div>

                          <div>
                            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300">
                              <CreditCard size={14} className="text-blue-600 dark:text-blue-400" />
                              <span>Personal PAN Number</span>
                            </label>
                            <input
                              type="text"
                              disabled={identityLocked}
                              value={formData.director_pan || ""}
                              onChange={(e) => setFormData({ ...formData, director_pan: e.target.value })}
                              placeholder="ABCDE1234F"
                              className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-sm font-semibold text-slate-900 outline-hidden transition focus:border-blue-500 focus:bg-white dark:border-slate-800 dark:bg-slate-800/50 dark:text-white"
                            />
                          </div>

                          <div>
                            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300">
                              <Heart size={14} className="text-blue-600 dark:text-blue-400" />
                              <span>Blood Group</span>
                            </label>
                            <input
                              type="text"
                              disabled={!isRegisteredIndustry}
                              value={formData.director_blood_group || ""}
                              onChange={(e) => setFormData({ ...formData, director_blood_group: e.target.value })}
                              placeholder="e.g. O+ / A+ / B+"
                              className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-sm font-semibold text-slate-900 outline-hidden transition focus:border-blue-500 focus:bg-white dark:border-slate-800 dark:bg-slate-800/50 dark:text-white"
                            />
                          </div>
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="rounded-xl bg-slate-50 p-3 border border-slate-100 dark:bg-slate-800/50 dark:border-slate-800">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">{isUnregistered ? "PROPRIETOR AADHAAR" : "DIRECTOR AADHAAR"}</p>
                        <p className="mt-1 text-sm font-bold text-slate-800 dark:text-slate-100">
                          {formData.director_aadhaar
                            ? "XXXX XXXX " + formData.director_aadhaar.replace(/\s/g, "").slice(-4)
                            : "Not set"}
                        </p>
                      </div>

                      {!isUnregistered && (
                        <>
                          <div className="rounded-xl bg-slate-50 p-3 border border-slate-100 dark:bg-slate-800/50 dark:border-slate-800">
                            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">DIN NUMBER</p>
                            <p className="mt-1 text-sm font-bold text-slate-800 dark:text-slate-100">
                              {formData.director_din
                                ? formData.director_din.slice(0, 2) + "****" + formData.director_din.slice(-2)
                                : "Not set"}
                            </p>
                          </div>

                          <div className="rounded-xl bg-slate-50 p-3 border border-slate-100 dark:bg-slate-800/50 dark:border-slate-800">
                            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">PERSONAL PAN NUMBER</p>
                            <p className="mt-1 text-sm font-bold text-slate-800 dark:text-slate-100">
                              {formData.director_pan
                                ? formData.director_pan.slice(0, 2) + "****" + formData.director_pan.slice(-2)
                                : "Not set"}
                            </p>
                          </div>

                          <div className="rounded-xl bg-slate-50 p-3 border border-slate-100 dark:bg-slate-800/50 dark:border-slate-800">
                            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">BLOOD GROUP</p>
                            <p className="mt-1 text-sm font-bold text-slate-800 dark:text-slate-100">{formData.director_blood_group || "Not set"}</p>
                          </div>
                        </>
                      )}
                    </>
                  )}
                </div>
              </section>


              {/* Save Action Area */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">Save {pageTitle}</h3>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Keep your {isUnregistered ? "proprietor" : "director"} statutory details accurate and current.
                  </p>
                </div>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="w-full sm:w-auto inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-bold text-white shadow-md transition hover:bg-blue-700 active:scale-95 disabled:opacity-50 cursor-pointer shrink-0"
                >
                  {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                  <span>{isSaving ? "Saving..." : "Save Changes"}</span>
                </button>
              </div>
            </form>
          </div>

          {/* Right Column (Span 1): Overview + Informational Card */}
          <div className="space-y-6 lg:sticky lg:top-6">
            {/* Desktop Account Summary */}
            <div className="hidden lg:block">
              {profileOverviewCard}
            </div>

            {/* Informational / Safety Card with Employer Blue/Indigo Identity */}
            <section className="relative overflow-hidden rounded-2xl bg-linear-to-br from-blue-700 via-indigo-700 to-blue-900 p-6 text-white text-center shadow-lg">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-white/20 backdrop-blur-md">
                <ShieldCheck size={32} className="text-white" />
              </div>
              <h3 className="text-lg font-bold text-white">
                Verified Signatory Record
              </h3>
              <p className="mt-2 text-xs text-blue-100 leading-relaxed max-w-xs mx-auto">
                Signatory credentials and KYC records are securely verified and stored under ISO-grade encryption.
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
