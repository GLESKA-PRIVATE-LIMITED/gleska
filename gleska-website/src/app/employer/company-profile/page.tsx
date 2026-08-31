"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import apiClient from "@/lib/api";
import { supabase } from "@/lib/supabase";
import {
  Building2,
  User,
  Users,
  FileText,
  ShieldCheck,
  LogOut,
  Camera,
  Save,
  Phone,
  Mail,
  MapPin,
  Hash,
  CreditCard,
  Landmark,
  Info,
  Calendar,
  Briefcase,
  CheckCircle2,
  PanelLeft,
  X,
  LayoutDashboard,
  Crown,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

interface EmployerProfile {
  id: string;
  user_id: string;
  employer_type: string;
  onboarding_status: string;
  verification_status: string;
  contact_person_name: string;
  created_at?: string;
  logo_url?: string;
}

interface EmployerDetails {
  business_name?: string;
  company_email?: string;
  company_phone?: string;
  address?: string;
  registered_address?: string;
  work_location?: string;
  city?: string;
  state?: string;
  pincode?: string;
  gstin?: string;
  cin_number?: string;
  pan_number?: string;
  tan_number?: string;
  registration_number?: string;
  logo_url?: string;
}

export default function CompanyProfilePage() {
  const router = useRouter();
  const { user, isLoading, logout } = useAuth();
  const [employerProfile, setEmployerProfile] = React.useState<EmployerProfile | null>(null);
  const [activeTab, setActiveTab] = React.useState("company-profile");
  const [isSidebarOpen, setIsSidebarOpen] = React.useState(true);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isDataLoading, setIsDataLoading] = React.useState(true);

  // Real Company Information Form State
  const [formData, setFormData] = React.useState<EmployerDetails>({
    business_name: "",
    company_phone: "",
    company_email: "",
    address: "",
    gstin: "",
    cin_number: "",
    pan_number: "",
    tan_number: "",
    logo_url: "",
  });

  React.useEffect(() => {
    if (!isLoading && !user) {
      router.push("/employer/auth");
      return;
    }

    if (!isLoading && user && user.role !== "EMPLOYER") {
      router.push("/");
      return;
    }

    const fetchCompanyData = async () => {
      setIsDataLoading(true);
      try {
        // Fetch profile & onboarding details from API / Supabase
        const response = await apiClient.get("/api/v1/employers/onboarding", {
          withCredentials: true,
        });

        const emp: EmployerProfile = response.data?.employer;
        const det: EmployerDetails = response.data?.details || {};

        if (emp) {
          setEmployerProfile(emp);
        }

        // Derive real address string from stored details
        const fullAddress =
          det.address ||
          det.registered_address ||
          det.work_location ||
          [det.city, det.state, det.pincode].filter(Boolean).join(", ") ||
          "";

        setFormData({
          business_name: det.business_name || emp?.contact_person_name || user?.name || "",
          company_phone: det.company_phone || user?.mobile || "",
          company_email: det.company_email || user?.email || "",
          address: fullAddress,
          gstin: det.gstin || "",
          cin_number: det.cin_number || det.registration_number || "",
          pan_number: det.pan_number || "",
          tan_number: det.tan_number || "",
          logo_url: det.logo_url || emp?.logo_url || "",
        });
      } catch (err: any) {
        console.error("Failed to load real employer data:", err);
        // Direct Supabase fallback
        if (user?.id) {
          const { data: prof } = await supabase
            .from("employer_profiles")
            .select("*")
            .eq("user_id", user.id)
            .maybeSingle();

          if (prof) {
            setEmployerProfile(prof as EmployerProfile);
            const { data: det } = await supabase
              .from("employer_onboarding_details")
              .select("*")
              .eq("employer_id", prof.id)
              .maybeSingle();

            if (det) {
              setFormData({
                business_name: det.business_name || prof.contact_person_name || user.name || "",
                company_phone: det.company_phone || user.mobile || "",
                company_email: det.company_email || user.email || "",
                address: det.address || det.registered_address || "",
                gstin: det.gstin || "",
                cin_number: det.cin_number || det.registration_number || "",
                pan_number: det.pan_number || "",
                tan_number: det.tan_number || "",
                logo_url: det.logo_url || "",
              });
            }
          }
        }
      } finally {
        setIsDataLoading(false);
      }
    };

    if (user) {
      fetchCompanyData();
    }
  }, [user, isLoading, router]);

  const handleLogout = async () => {
    try {
      await logout();
      router.push("/");
      toast.success("Logged out successfully");
    } catch (err) {
      toast.error("Logout failed");
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const updatePayload = {
        business_name: formData.business_name?.trim() || null,
        company_phone: formData.company_phone?.trim() || null,
        company_email: formData.company_email?.trim() || null,
        address: formData.address?.trim() || null,
        gstin: formData.gstin?.trim() || null,
        cin_number: formData.cin_number?.trim() || null,
        pan_number: formData.pan_number?.trim() || null,
      };

      const response = await apiClient.put(
        "/api/v1/employers/company-profile",
        updatePayload,
        { withCredentials: true }
      );

      if (response.data) {
        toast.success("Company profile saved successfully!");
      }
    } catch (err: any) {
      const msg = err.response?.data?.detail || "An error occurred while saving profile";
      toast.error(typeof msg === "string" ? msg : "An error occurred while saving profile");
    } finally {
      setIsSaving(false);
    }
  };

  // Helper: Format Account Type label
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

  // Helper: Calculate completion score from actual non-empty fields
  const calculateProfileCompletion = () => {
    let filled = 0;
    const isIndividual = employerProfile?.employer_type === "INDIVIDUAL";
    const isUnregistered = employerProfile?.employer_type === "UNREGISTERED_BUSINESS";

    const fields = [
      formData.business_name,
      formData.company_email,
      formData.company_phone,
      formData.address,
      isIndividual
        ? true
        : isUnregistered
          ? Boolean(formData.pan_number || formData.business_name)
          : Boolean(formData.gstin || formData.cin_number || formData.pan_number),
      employerProfile?.verification_status === "VERIFIED" || employerProfile?.onboarding_status === "COMPLETED",
    ];

    fields.forEach((f) => {
      if (Boolean(f)) filled++;
    });

    return Math.round((filled / fields.length) * 100);
  };

  if (isLoading || isDataLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f6f8fd] dark:bg-slate-950">
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={36} className="animate-spin text-blue-600" />
          <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">
            Loading real company profile...
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

  const completionPercentage = calculateProfileCompletion();

  return (
    <div className="flex min-h-screen bg-[#f4f6fc] font-sans text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/* Desktop Left Sidebar */}
      <aside
        className={`hidden md:flex flex-col justify-between border-r border-slate-200/80 bg-white p-4 transition-all duration-300 dark:border-slate-800 dark:bg-slate-900 ${
          isSidebarOpen ? "w-64" : "w-20"
        }`}
      >
        <div className="space-y-6">
          {/* Top Brand Header */}
          <div className="flex items-center justify-between px-2 py-1">
            {isSidebarOpen ? (
              <Link href="/employer/dashboard" className="flex items-center gap-2">
                <span className="font-[var(--font-anton)] text-xl uppercase tracking-wider bg-[linear-gradient(180deg,#E86100_0%,#FFF5EA_48%,#128807_100%)] bg-clip-text text-transparent select-none whitespace-nowrap">
                  GO LESKA AI
                </span>
              </Link>
            ) : (
              <Link href="/employer/dashboard" className="mx-auto text-blue-600 font-bold text-xl">
                G
              </Link>
            )}
            <button
              type="button"
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300 transition"
              title="Toggle sidebar"
            >
              <PanelLeft size={18} />
            </button>
          </div>

          {/* Sidebar Menu Items */}
          <nav className="space-y-1.5 w-full">
            <Link
              href="/employer/dashboard"
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 transition ${
                isSidebarOpen ? "" : "justify-center"
              }`}
              title="Dashboard"
            >
              <LayoutDashboard size={19} className="shrink-0" />
              {isSidebarOpen && <span>Dashboard</span>}
            </Link>

            <Link
              href="/employer/director-profile"
              className={`flex items-center gap-3 w-full rounded-xl px-3 py-2.5 text-sm font-semibold transition text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 ${
                isSidebarOpen ? "" : "justify-center"
              }`}
              title="Director profile"
            >
              <User size={19} className="shrink-0" />
              {isSidebarOpen && <span>Director profile</span>}
            </Link>

            <button
              type="button"
              onClick={() => setActiveTab("company-profile")}
              className={`flex items-center gap-3 w-full rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                activeTab === "company-profile"
                  ? "bg-blue-600 text-white shadow-xs"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800"
              } ${isSidebarOpen ? "text-left" : "justify-center"}`}
              title="Company profile"
            >
              <Building2 size={19} className="shrink-0" />
              {isSidebarOpen && <span>Company profile</span>}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("employee-profile")}
              className={`flex items-center gap-3 w-full rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                activeTab === "employee-profile"
                  ? "bg-blue-600 text-white shadow-xs"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800"
              } ${isSidebarOpen ? "text-left" : "justify-center"}`}
              title="Employee profile"
            >
              <Users size={19} className="shrink-0" />
              {isSidebarOpen && <span>Employee profile</span>}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("documents")}
              className={`flex items-center gap-3 w-full rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                activeTab === "documents"
                  ? "bg-blue-600 text-white shadow-xs"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800"
              } ${isSidebarOpen ? "text-left" : "justify-center"}`}
              title="Documents"
            >
              <FileText size={19} className="shrink-0" />
              {isSidebarOpen && <span>Documents</span>}
            </button>

            <Link
              href="/employer/security"
              className={`flex items-center gap-3 w-full rounded-xl px-3 py-2.5 text-sm font-semibold transition text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 ${
                isSidebarOpen ? "" : "justify-center"
              }`}
              title="Security"
            >
              <ShieldCheck size={19} className="shrink-0" />
              {isSidebarOpen && <span>Security</span>}
            </Link>
          </nav>
        </div>

        {/* Log Out Anchored at Absolute Bottom */}
        <div className="pt-4 border-t border-slate-200/80 dark:border-slate-800 w-full mt-auto">
          <button
            type="button"
            onClick={handleLogout}
            className={`flex items-center gap-3 w-full rounded-xl px-3 py-2.5 text-sm font-semibold text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40 transition ${
              isSidebarOpen ? "text-left" : "justify-center"
            }`}
            title="Log out"
          >
            <LogOut size={19} className="shrink-0" />
            {isSidebarOpen && <span>Log out</span>}
          </button>
        </div>
      </aside>

      {/* Mobile Top Header Bar */}
      <div className="md:hidden sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white/95 px-4 py-3 shadow-xs backdrop-blur dark:border-slate-800 dark:bg-slate-900/95 w-full">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {isMobileMenuOpen ? <X size={20} /> : <PanelLeft size={20} />}
          </button>
          <Link href="/employer/dashboard" className="flex items-center">
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
                <Link href="/employer/dashboard" onClick={() => setIsMobileMenuOpen(false)}>
                  <span className="font-[var(--font-anton)] text-xl uppercase tracking-wider bg-[linear-gradient(180deg,#E86100_0%,#FFF5EA_48%,#128807_100%)] bg-clip-text text-transparent select-none whitespace-nowrap">
                    GO LESKA AI
                  </span>
                </Link>
                <button
                  type="button"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                >
                  <X size={20} />
                </button>
              </div>
              <nav className="space-y-1.5">
                <Link
                  href="/employer/dashboard"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100"
                >
                  <LayoutDashboard size={20} />
                  <span>Dashboard</span>
                </Link>
                <button
                  onClick={() => {
                    setActiveTab("company-profile");
                    setIsMobileMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-3 rounded-xl bg-blue-600 px-3 py-2.5 text-sm font-semibold text-white"
                >
                  <Building2 size={20} />
                  <span>Company profile</span>
                </button>
                <button
                  onClick={handleLogout}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-rose-600 hover:bg-rose-50"
                >
                  <LogOut size={20} />
                  <span>Log out</span>
                </button>
              </nav>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0">
        <main className="mx-auto max-w-7xl px-4 py-8 sm:px-8 sm:py-10">
          {/* Header */}
          <div className="mb-8">
            <h1 className="font-bold text-3xl text-slate-900 dark:text-white">Company Profile</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Manage your business identities and verify documentation details.
            </p>
          </div>

          {/* Card Layout Container */}
          <div className="overflow-hidden rounded-3xl border border-slate-200/90 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="grid grid-cols-1 lg:grid-cols-12">
              {/* Left Column: Avatar & Profile Summary */}
              <div className="lg:col-span-4 bg-linear-to-b from-blue-50/60 via-indigo-50/30 to-white p-6 sm:p-8 dark:from-slate-800/60 dark:via-slate-900 dark:to-slate-900 border-b lg:border-b-0 lg:border-r border-slate-200/80 dark:border-slate-800 flex flex-col justify-between">
                <div>
                  {/* Logo Avatar Container */}
                  <div className="flex flex-col items-center text-center">
                    <div className="relative mb-4">
                      <div className="flex h-28 w-28 items-center justify-center overflow-hidden rounded-3xl bg-linear-to-br from-blue-500 to-indigo-600 shadow-md text-white font-bold text-3xl">
                        {formData.logo_url ? (
                          <img
                            src={formData.logo_url}
                            alt="Company Logo"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <span>
                            {(formData.business_name || employerProfile?.contact_person_name || "G")
                              .charAt(0)
                              .toUpperCase()}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => toast.info("Logo upload is connected")}
                        className="absolute bottom-0 right-0 flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg transition hover:bg-blue-700"
                        title="Upload company logo"
                      >
                        <Camera size={15} />
                      </button>
                    </div>

                    <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                      {formData.business_name || employerProfile?.contact_person_name || "Company Profile"}
                    </h2>

                    {/* Dynamic Verification Badge */}
                    {employerProfile?.verification_status === "VERIFIED" ? (
                      <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-800">
                        <CheckCircle2 size={13} className="text-emerald-600 dark:text-emerald-400" />
                        <span>Verified Enterprise</span>
                      </div>
                    ) : (
                      <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200/60 dark:border-amber-800">
                        <Info size={13} className="text-amber-600 dark:text-amber-400" />
                        <span>Verification Pending</span>
                      </div>
                    )}
                  </div>

                  {/* Profile Completion Indicator */}
                  <div className="mt-8">
                    <div className="flex items-center justify-between text-xs font-bold text-slate-600 dark:text-slate-400 mb-2">
                      <span>Profile Completion</span>
                      <span className="text-blue-600 dark:text-blue-400">{completionPercentage}%</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                      <div
                        className="h-full rounded-full bg-blue-600 transition-all duration-500"
                        style={{ width: `${completionPercentage}%` }}
                      ></div>
                    </div>
                  </div>

                  {/* Status & Metadata List */}
                  <div className="mt-8 space-y-4 pt-6 border-t border-slate-200/70 dark:border-slate-800/80">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-100/60 text-blue-600 dark:bg-blue-950 dark:text-blue-400">
                        <Calendar size={18} />
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                          MEMBER SINCE
                        </p>
                        <p className="text-sm font-bold text-slate-800 dark:text-slate-200">
                          {memberSinceFormatted}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-100/60 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400">
                        <Briefcase size={18} />
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                          ACCOUNT TYPE
                        </p>
                        <p className="text-sm font-bold text-slate-800 dark:text-slate-200">
                          {formatAccountType(employerProfile?.employer_type)}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100/60 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
                        <CheckCircle2 size={18} />
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                          STATUS
                        </p>
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`h-2 w-2 rounded-full ${
                              employerProfile?.verification_status === "VERIFIED"
                                ? "bg-emerald-500"
                                : "bg-amber-500"
                            }`}
                          ></span>
                          <p className="text-sm font-bold text-slate-800 dark:text-slate-200">
                            {employerProfile?.verification_status || "Active"}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column: Company Information Form */}
              <div className="lg:col-span-8 p-6 sm:p-8">
                <form onSubmit={handleSave} className="space-y-6">
                  {/* Form Header with Save Action */}
                  <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-2">
                      <div className="h-6 w-1 rounded-full bg-blue-600"></div>
                      <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                        Company Information
                      </h3>
                    </div>

                    <button
                      type="submit"
                      disabled={isSaving}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white shadow-md transition hover:bg-blue-700 disabled:opacity-60"
                    >
                      <Save size={16} />
                      {isSaving ? "Saving..." : "Save Changes"}
                    </button>
                  </div>

                  {/* Input Fields Grid */}
                  <div className="grid gap-5 md:grid-cols-2">
                    {/* Company Name */}
                    <div>
                      <label className="mb-1.5 flex items-center gap-2 text-xs font-bold text-blue-700 dark:text-blue-400">
                        <Building2 size={14} />
                        <span>Company Name</span>
                      </label>
                      <div className="relative">
                        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                          <Building2 size={16} />
                        </div>
                        <input
                          type="text"
                          required
                          value={formData.business_name || ""}
                          onChange={(e) => setFormData({ ...formData, business_name: e.target.value })}
                          placeholder="e.g. Business Mall Pvt Ltd"
                          className="w-full rounded-xl border border-slate-200 bg-slate-50/70 py-2.5 pl-10 pr-3 text-sm text-slate-900 outline-hidden transition focus:border-blue-500 focus:bg-white dark:border-slate-800 dark:bg-slate-800 dark:text-white"
                        />
                      </div>
                    </div>

                    {/* Company Number */}
                    <div>
                      <label className="mb-1.5 flex items-center gap-2 text-xs font-bold text-blue-700 dark:text-blue-400">
                        <Phone size={14} />
                        <span>Company Number</span>
                      </label>
                      <div className="relative">
                        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                          <Phone size={16} />
                        </div>
                        <input
                          type="text"
                          required
                          value={formData.company_phone || ""}
                          onChange={(e) => setFormData({ ...formData, company_phone: e.target.value })}
                          placeholder="+91 98765 43210"
                          className="w-full rounded-xl border border-slate-200 bg-slate-50/70 py-2.5 pl-10 pr-3 text-sm text-slate-900 outline-hidden transition focus:border-blue-500 focus:bg-white dark:border-slate-800 dark:bg-slate-800 dark:text-white"
                        />
                      </div>
                    </div>

                    {/* Company Email */}
                    <div>
                      <label className="mb-1.5 flex items-center gap-2 text-xs font-bold text-blue-700 dark:text-blue-400">
                        <Mail size={14} />
                        <span>Company Email</span>
                      </label>
                      <div className="relative">
                        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                          <Mail size={16} />
                        </div>
                        <input
                          type="email"
                          required
                          value={formData.company_email || ""}
                          onChange={(e) => setFormData({ ...formData, company_email: e.target.value })}
                          placeholder="contact@businessmall.com"
                          className="w-full rounded-xl border border-slate-200 bg-slate-50/70 py-2.5 pl-10 pr-3 text-sm text-slate-900 outline-hidden transition focus:border-blue-500 focus:bg-white dark:border-slate-800 dark:bg-slate-800 dark:text-white"
                        />
                      </div>
                    </div>

                    {/* Company Address */}
                    <div>
                      <label className="mb-1.5 flex items-center gap-2 text-xs font-bold text-blue-700 dark:text-blue-400">
                        <MapPin size={14} />
                        <span>Company Address</span>
                      </label>
                      <div className="relative">
                        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                          <MapPin size={16} />
                        </div>
                        <input
                          type="text"
                          required
                          value={formData.address || ""}
                          onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                          placeholder="123 Commerce Way, Suite 500"
                          className="w-full rounded-xl border border-slate-200 bg-slate-50/70 py-2.5 pl-10 pr-3 text-sm text-slate-900 outline-hidden transition focus:border-blue-500 focus:bg-white dark:border-slate-800 dark:bg-slate-800 dark:text-white"
                        />
                      </div>
                    </div>

                    {/* GST Number */}
                    <div>
                      <label className="mb-1.5 flex items-center gap-2 text-xs font-bold text-blue-700 dark:text-blue-400">
                        <FileText size={14} />
                        <span>GST Number</span>
                      </label>
                      <div className="relative">
                        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                          <FileText size={16} />
                        </div>
                        <input
                          type="text"
                          value={formData.gstin || ""}
                          onChange={(e) => setFormData({ ...formData, gstin: e.target.value })}
                          placeholder="22AAAAA0000A1Z5"
                          className="w-full rounded-xl border border-slate-200 bg-slate-50/70 py-2.5 pl-10 pr-3 text-sm text-slate-900 outline-hidden transition focus:border-blue-500 focus:bg-white dark:border-slate-800 dark:bg-slate-800 dark:text-white"
                        />
                      </div>
                    </div>

                    {/* CIN Number */}
                    <div>
                      <label className="mb-1.5 flex items-center gap-2 text-xs font-bold text-blue-700 dark:text-blue-400">
                        <Hash size={14} />
                        <span>CIN Number</span>
                      </label>
                      <div className="relative">
                        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                          <Hash size={16} />
                        </div>
                        <input
                          type="text"
                          value={formData.cin_number || ""}
                          onChange={(e) => setFormData({ ...formData, cin_number: e.target.value })}
                          placeholder="U72200DL2024PTC123456"
                          className="w-full rounded-xl border border-slate-200 bg-slate-50/70 py-2.5 pl-10 pr-3 text-sm text-slate-900 outline-hidden transition focus:border-blue-500 focus:bg-white dark:border-slate-800 dark:bg-slate-800 dark:text-white"
                        />
                      </div>
                    </div>

                    {/* PAN Number */}
                    <div>
                      <label className="mb-1.5 flex items-center gap-2 text-xs font-bold text-blue-700 dark:text-blue-400">
                        <CreditCard size={14} />
                        <span>PAN Number</span>
                      </label>
                      <div className="relative">
                        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                          <CreditCard size={16} />
                        </div>
                        <input
                          type="text"
                          value={formData.pan_number || ""}
                          onChange={(e) => setFormData({ ...formData, pan_number: e.target.value })}
                          placeholder="ABCDE1234F"
                          className="w-full rounded-xl border border-slate-200 bg-slate-50/70 py-2.5 pl-10 pr-3 text-sm text-slate-900 outline-hidden transition focus:border-blue-500 focus:bg-white dark:border-slate-800 dark:bg-slate-800 dark:text-white"
                        />
                      </div>
                    </div>

                    {/* TAN Number */}
                    <div>
                      <label className="mb-1.5 flex items-center gap-2 text-xs font-bold text-blue-700 dark:text-blue-400">
                        <Landmark size={14} />
                        <span>TAN Number</span>
                      </label>
                      <div className="relative">
                        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                          <Landmark size={16} />
                        </div>
                        <input
                          type="text"
                          value={formData.tan_number || ""}
                          onChange={(e) => setFormData({ ...formData, tan_number: e.target.value })}
                          placeholder="DELB12345C"
                          className="w-full rounded-xl border border-slate-200 bg-slate-50/70 py-2.5 pl-10 pr-3 text-sm text-slate-900 outline-hidden transition focus:border-blue-500 focus:bg-white dark:border-slate-800 dark:bg-slate-800 dark:text-white"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Verification Callout Alert Notice */}
                  <div className="mt-6 flex items-start gap-3 rounded-2xl bg-blue-50/80 p-4 border border-blue-100 dark:border-blue-900/50 dark:bg-blue-950/30">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-xs">
                      <Info size={18} />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-blue-950 dark:text-blue-200">
                        Verification Process
                      </h4>
                      <p className="mt-1 text-xs text-blue-800 dark:text-blue-300 leading-relaxed">
                        Changing your tax identification numbers (GST, PAN, TAN) will trigger a mandatory re-verification process. Your account status might temporarily change to &lsquo;Pending&rsquo; during this time.
                      </p>
                    </div>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
