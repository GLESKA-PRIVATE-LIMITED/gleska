"use client";

import React, { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  User,
  MapPin,
  Clock,
  Loader2,
  PanelLeft,
  LayoutDashboard,
  FileText,
  ShieldCheck,
  Building2,
  History,
  CreditCard,
  Settings,
  HelpCircle,
  ChevronUp,
  X,
  LogOut,
  CheckCircle2,
  Edit3,
  Plus,
  UploadCloud,
  Briefcase,
  Save,
  Camera,
  Star,
  Home,
  Check,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import LocationPicker, { LocationSelection } from "@/components/LocationPicker";
import { getBrowserLocation } from "@/lib/location";

type Profile = {
  trade_id?: string | null;
  experience_years?: number | null;
  expected_daily_wage?: number | null;
  city?: string | null;
  state?: string | null;
  address?: string | null;
  pincode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  location_source?: string | null;
  availability_status: "AVAILABLE" | "ON_JOB" | "OFFLINE";
  profile_completed?: boolean;
};

export default function WorkerProfilePage() {
  const router = useRouter();
  const { user, isLoading, refreshUser, logout } = useAuth();

  // Profile data states
  const [profile, setProfile] = useState<Profile>({ availability_status: "OFFLINE" });
  const [initialProfile, setInitialProfile] = useState<Profile>({ availability_status: "OFFLINE" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [detectedLocation, setDetectedLocation] = useState<LocationSelection | null>(null);

  // Local display states (matching Figma fields)
  const [maritalStatus, setMaritalStatus] = useState("Unmarried");
  const [bloodGroup, setBloodGroup] = useState("AB+");
  const [skills, setSkills] = useState<string[]>(["Electrician", "Wiring", "Panel Repair", "Troubleshooting"]);
  const [newSkillInput, setNewSkillInput] = useState("");
  const [showSkillInput, setShowSkillInput] = useState(false);

  // Layout & Editing UI states
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  const [isEditingPersonal, setIsEditingPersonal] = useState(false);
  const [isEditingAddress, setIsEditingAddress] = useState(false);
  const [isEditingProfessional, setIsEditingProfessional] = useState(false);

  // Form input local states for editable personal details
  const [displayNameInput, setDisplayNameInput] = useState("");
  const [phoneInput, setPhoneInput] = useState("");
  const [emailInput, setEmailInput] = useState("");

  // Close popover when clicking outside
  useEffect(() => {
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

  // Fetch worker profile on mount
  useEffect(() => {
    if (!isLoading && (!user || user.role !== "WORKER")) {
      router.push("/worker/auth");
      return;
    }
    if (isLoading || !user || user.role !== "WORKER") return;

    setDisplayNameInput(user.name || "");
    setPhoneInput(user.mobile || "");
    setEmailInput(user.email || "");

    apiClient
      .get("/api/v1/workers/me")
      .then((response) => {
        setProfile(response.data);
        setInitialProfile(response.data);

        // Populate skills from trade_id if available
        if (response.data.trade_id) {
          const trade = response.data.trade_id;
          if (!skills.includes(trade)) {
            setSkills((prev) => Array.from(new Set([trade, ...prev])));
          }
        }
      })
      .catch(() => toast.error("Unable to load your profile"))
      .finally(() => setLoading(false));
  }, [isLoading, user, router]);

  // Location handlers
  const selectLocation = (location: LocationSelection) => {
    setProfile((current) => ({
      ...current,
      address: location.address,
      city: location.city ?? current.city,
      state: location.state ?? current.state,
      pincode: location.pincode ?? current.pincode,
      latitude: location.latitude,
      longitude: location.longitude,
      location_source: location.location_source,
    }));
  };

  const useCurrentLocation = async () => {
    try {
      const coordinates = await getBrowserLocation();
      const response = await apiClient.get("/api/v1/locations/reverse", {
        params: { latitude: coordinates.latitude, longitude: coordinates.longitude },
      });
      const location = {
        ...response.data,
        accuracy_m: coordinates.accuracy,
        city: response.data.city || null,
        state: response.data.state || null,
        pincode: response.data.pincode || null,
        location_source: "GPS" as const,
      };
      setDetectedLocation(location);
      return location;
    } catch {
      toast.error("Unable to detect current location");
      return null;
    }
  };

  const confirmDetectedLocation = async () => {
    if (!detectedLocation) return;
    try {
      const response = await apiClient.put("/api/v1/workers/me/location", {
        latitude: detectedLocation.latitude,
        longitude: detectedLocation.longitude,
        accuracy_m: detectedLocation.accuracy_m,
      });
      const profileResponse = await apiClient.put("/api/v1/workers/me", {
        address: detectedLocation.address,
        latitude: detectedLocation.latitude,
        longitude: detectedLocation.longitude,
        location_source: "GPS",
      });
      setProfile((current) => ({ ...current, ...profileResponse.data, address: response.data.address || profileResponse.data.address }));
      setInitialProfile((current) => ({ ...current, ...profileResponse.data, address: response.data.address || profileResponse.data.address }));
      setDetectedLocation(null);
      toast.success("GPS Location updated");
    } catch {
      toast.error("Failed to update location");
    }
  };

  // Add skill tag handler
  const handleAddSkill = () => {
    if (!newSkillInput.trim()) return;
    const trimmed = newSkillInput.trim();
    if (!skills.includes(trimmed)) {
      setSkills((prev) => [...prev, trimmed]);
    }
    setNewSkillInput("");
    setShowSkillInput(false);
  };

  const handleRemoveSkill = (skillToRemove: string) => {
    setSkills((prev) => prev.filter((s) => s !== skillToRemove));
  };

  // Save profile handler
  const save = async (event?: FormEvent) => {
    if (event) event.preventDefault();
    setSaving(true);
    try {
      const response = await apiClient.put("/api/v1/workers/me", profile);
      setProfile(response.data);
      setInitialProfile(response.data);
      setIsEditingPersonal(false);
      setIsEditingAddress(false);
      setIsEditingProfessional(false);
      toast.success("Profile saved successfully");
      await refreshUser();
    } catch (error: any) {
      toast.error(error.response?.data?.detail || "Unable to save profile");
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      router.push("/");
      toast.success("Logged out successfully");
    } catch {
      toast.error("Logout failed");
    }
  };

  // Calculate Profile Strength percentage
  const calculateProfileStrength = () => {
    const checks = [
      Boolean(user?.name),
      Boolean(user?.mobile),
      Boolean(user?.email),
      Boolean(profile.trade_id),
      Boolean(profile.experience_years !== null && profile.experience_years !== undefined),
      Boolean(profile.expected_daily_wage !== null && profile.expected_daily_wage !== undefined),
      Boolean(profile.city || profile.address),
      Boolean(profile.availability_status && profile.availability_status !== "OFFLINE"),
    ];
    const filled = checks.filter(Boolean).length;
    return Math.round((filled / checks.length) * 100);
  };

  const profileStrength = calculateProfileStrength();

  if (isLoading || loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#eef1fb] dark:bg-slate-950">
        <div className="flex flex-col items-center gap-4">
          <Loader2 size={40} className="animate-spin text-blue-600" />
          <p className="text-slate-600 dark:text-slate-400">Loading worker profile...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-[#eef1fb] font-sans text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/* Desktop Left Sidebar */}
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
                  className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white transition cursor-pointer"
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
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white transition cursor-pointer"
              >
                <PanelLeft size={20} />
              </button>
            )}
          </div>

          {/* Sidebar Navigation Items */}
          <nav className="space-y-1.5 w-full">
            {/* Dashboard (Inactive) */}
            <Link
              href="/worker/dashboard"
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white transition ${
                isSidebarOpen ? "" : "justify-center"
              }`}
              title="Dashboard"
            >
              <LayoutDashboard size={20} className="shrink-0" />
              {isSidebarOpen && <span>Dashboard</span>}
            </Link>

            {/* Profile (Active) */}
            <Link
              href="/worker/profile"
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                isSidebarOpen ? "" : "justify-center"
              } bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400`}
              title="Profile"
            >
              <User size={20} className="shrink-0" />
              {isSidebarOpen && <span>Profile</span>}
            </Link>

            {/* Documents */}
            <div
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-400 opacity-60 dark:text-slate-500 cursor-not-allowed ${
                isSidebarOpen ? "" : "justify-center"
              }`}
              title="Documents"
            >
              <FileText size={20} className="shrink-0" />
              {isSidebarOpen && <span>Documents</span>}
            </div>

            {/* Security */}
            <div
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-400 opacity-60 dark:text-slate-500 cursor-not-allowed ${
                isSidebarOpen ? "" : "justify-center"
              }`}
              title="Security"
            >
              <ShieldCheck size={20} className="shrink-0" />
              {isSidebarOpen && <span>Security</span>}
            </div>

            {/* Companies Worked */}
            <div
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-400 opacity-60 dark:text-slate-500 cursor-not-allowed ${
                isSidebarOpen ? "" : "justify-center"
              }`}
              title="Companies Worked"
            >
              <Building2 size={20} className="shrink-0" />
              {isSidebarOpen && <span>Companies Worked</span>}
            </div>

            {/* Sidebar Recents Section */}
            <div className="pt-3 border-t border-slate-200/80 dark:border-slate-800/80 w-full">
              {isSidebarOpen ? (
                <div className="space-y-1">
                  <div className="flex items-center justify-between px-3 py-1 text-[11px] font-bold tracking-wider text-slate-400 dark:text-slate-500 uppercase">
                    <span>Recents</span>
                    <History size={14} className="text-slate-400 dark:text-slate-500" />
                  </div>
                  <p className="px-3 text-xs text-slate-400 dark:text-slate-500 italic">No recent items</p>
                </div>
              ) : (
                <div className="flex justify-center py-2" title="Recents">
                  <History size={20} className="text-slate-400 dark:text-slate-500" />
                </div>
              )}
            </div>
          </nav>
        </div>

        {/* Sidebar Bottom: Clickable Worker Profile & Popover Menu */}
        <div className="relative pt-4 border-t border-slate-200 dark:border-slate-800 w-full" ref={profileMenuRef}>
          {/* Profile Popover Menu */}
          {isProfileMenuOpen && (
            <div
              className={`absolute bottom-full mb-2 z-50 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl backdrop-blur dark:border-slate-800 dark:bg-slate-900 ${
                isSidebarOpen ? "left-0 right-0 w-full min-w-[220px]" : "left-0 w-64"
              }`}
            >
              <div className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-sm font-bold text-white shadow-xs">
                  {(user?.name || "W").charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-slate-900 dark:text-white">
                    {user?.name || "Worker"}
                  </p>
                  <p className="truncate text-xs text-slate-500 dark:text-slate-400 uppercase font-semibold">
                    INDIVIDUAL
                  </p>
                </div>
              </div>

              <div className="my-1.5 border-t border-slate-100 dark:border-slate-800" />

              <div className="space-y-0.5">
                <div className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-slate-400 dark:text-slate-500 cursor-not-allowed opacity-60">
                  <CreditCard size={17} className="shrink-0" />
                  <span>Subscription</span>
                </div>

                <Link
                  href="/worker/profile"
                  onClick={() => setIsProfileMenuOpen(false)}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-blue-600 bg-blue-50 dark:bg-blue-950/40 dark:text-blue-400 transition"
                >
                  <User size={17} className="shrink-0" />
                  <span>Profile</span>
                </Link>

                <div className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-slate-400 dark:text-slate-500 cursor-not-allowed opacity-60">
                  <Settings size={17} className="shrink-0" />
                  <span>Settings</span>
                </div>

                <div className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-slate-400 dark:text-slate-500 cursor-not-allowed opacity-60">
                  <HelpCircle size={17} className="shrink-0" />
                  <span>Help</span>
                </div>
              </div>

              <div className="my-1.5 border-t border-slate-100 dark:border-slate-800" />

              <button
                type="button"
                onClick={() => {
                  setIsProfileMenuOpen(false);
                  handleLogout();
                }}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40 transition cursor-pointer"
              >
                <LogOut size={17} className="text-red-600 dark:text-red-400 shrink-0" />
                <span>Log out</span>
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
            className={`flex items-center gap-3 w-full rounded-xl p-2 transition text-left hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer ${
              isSidebarOpen ? "" : "justify-center"
            }`}
            title={user?.name || "Worker"}
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-sm font-bold text-white shadow-xs">
              {(user?.name || "W").charAt(0).toUpperCase()}
            </div>
            {isSidebarOpen && (
              <>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900 dark:text-white leading-tight">
                    {user?.name || "Worker"}
                  </p>
                  <p className="truncate text-xs text-slate-500 dark:text-slate-400 uppercase font-medium">
                    INDIVIDUAL
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

      {/* Mobile Top Header Bar */}
      <div className="md:hidden sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white/95 px-4 py-3 shadow-xs backdrop-blur dark:border-slate-800 dark:bg-slate-900/95 w-full">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            title="Toggle sidebar menu"
            aria-label="Toggle sidebar menu"
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer"
          >
            {isMobileMenuOpen ? <X size={20} /> : <PanelLeft size={20} />}
          </button>
          <Link href="/" className="flex items-center">
            <span className="font-[var(--font-anton)] text-lg uppercase tracking-wider bg-[linear-gradient(180deg,#E86100_0%,#FFF5EA_48%,#128807_100%)] bg-clip-text text-transparent select-none">
              GO LESKA AI
            </span>
          </Link>
        </div>
        <Link
          href="/worker/profile"
          className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-600 text-xs font-bold text-white shadow-xs"
          title="View Profile"
        >
          {(user?.name || "W").charAt(0).toUpperCase()}
        </Link>
      </div>

      {/* Mobile Sidebar Overlay Drawer */}
      {isMobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs transition-opacity"
            onClick={() => setIsMobileMenuOpen(false)}
          />
          <div className="relative flex w-4/5 max-w-xs flex-1 flex-col bg-white p-4 shadow-2xl dark:bg-slate-900">
            <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
              <span className="font-[var(--font-anton)] text-xl uppercase tracking-wider bg-[linear-gradient(180deg,#E86100_0%,#FFF5EA_48%,#128807_100%)] bg-clip-text text-transparent">
                GO LESKA AI
              </span>
              <button
                type="button"
                onClick={() => setIsMobileMenuOpen(false)}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <X size={20} />
              </button>
            </div>

            <nav className="mt-4 space-y-1.5 flex-1">
              <Link
                href="/worker/dashboard"
                onClick={() => setIsMobileMenuOpen(false)}
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <LayoutDashboard size={20} />
                <span>Dashboard</span>
              </Link>
              <Link
                href="/worker/profile"
                onClick={() => setIsMobileMenuOpen(false)}
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400"
              >
                <User size={20} />
                <span>Profile</span>
              </Link>
              <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-400 opacity-60 cursor-not-allowed">
                <FileText size={20} />
                <span>Documents</span>
              </div>
              <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-400 opacity-60 cursor-not-allowed">
                <ShieldCheck size={20} />
                <span>Security</span>
              </div>
              <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-400 opacity-60 cursor-not-allowed">
                <Building2 size={20} />
                <span>Companies Worked</span>
              </div>
            </nav>

            <div className="pt-4 border-t border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 mb-2">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-sm font-bold text-white">
                  {(user?.name || "W").charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-slate-900 dark:text-white">
                    {user?.name || "Worker"}
                  </p>
                  <p className="truncate text-xs text-slate-500 uppercase font-semibold">
                    INDIVIDUAL
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  handleLogout();
                }}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 dark:text-red-400"
              >
                <LogOut size={20} />
                <span>Log out</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 min-h-screen overflow-y-auto">
        <main className="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 py-6 sm:py-8 space-y-6 pb-12">
          {/* Top Banner Card matching Figma */}
          <div className="relative overflow-hidden rounded-3xl bg-linear-to-r from-blue-600 via-indigo-600 to-purple-600 p-6 sm:p-8 text-white shadow-xl">
            {/* Ambient Background Accents */}
            <div className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-purple-400/20 blur-3xl" />

            <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
              {/* Left Side Header Text + Profile Strength */}
              <div className="space-y-4 max-w-lg">
                <div>
                  <h1 className="font-[var(--font-anton)] text-3xl sm:text-4xl uppercase tracking-wide">
                    Your Profile
                  </h1>
                  <p className="text-blue-100 text-sm sm:text-base mt-1">
                    Let others know who you are
                  </p>
                </div>

                {/* Profile Strength Box */}
                <div className="rounded-2xl bg-white/15 backdrop-blur-md p-4 border border-white/20 shadow-inner w-full max-w-sm">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-blue-100">
                      Profile Strength
                    </span>
                    <span className="text-sm font-extrabold text-white">{profileStrength}%</span>
                  </div>
                  <div className="h-2.5 w-full rounded-full bg-white/20 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-linear-to-r from-amber-400 to-yellow-300 transition-all duration-500"
                      style={{ width: `${profileStrength}%` }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-blue-100 font-medium">
                    {profileStrength >= 100 ? "Profile 100% Complete!" : "Almost there! Complete your details for better job matches."}
                  </p>
                </div>
              </div>

              {/* Right Side Avatar + Name + Badge */}
              <div className="flex items-center gap-4 sm:gap-6 self-start md:self-center">
                <div className="text-right hidden sm:block">
                  <div className="flex items-center justify-end gap-1.5">
                    <h2 className="text-2xl font-bold text-white">{user.name || "Worker"}</h2>
                    <CheckCircle2 size={20} className="text-blue-300 fill-blue-500 shrink-0" />
                  </div>
                  <div className="mt-1.5 flex justify-end">
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-400 px-3 py-1 text-xs font-extrabold text-slate-950 uppercase tracking-wide shadow-xs">
                      <Star size={12} className="fill-slate-950" /> Premium Member
                    </span>
                  </div>
                </div>

                <div className="relative">
                  <div className="flex h-20 w-20 sm:h-24 sm:w-24 items-center justify-center rounded-full border-4 border-white/30 bg-blue-500 text-3xl font-extrabold text-white shadow-xl backdrop-blur-md">
                    {(user.name || "W").charAt(0).toUpperCase()}
                  </div>
                  <button
                    type="button"
                    title="Change profile photo"
                    onClick={() => toast.info("Profile picture upload coming soon!")}
                    className="absolute bottom-0 right-0 flex h-8 w-8 items-center justify-center rounded-full bg-white text-blue-600 shadow-md hover:scale-110 transition cursor-pointer"
                  >
                    <Camera size={16} />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Two Column Section Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Column (Span 2): Personal, Addresses, Professional */}
            <div className="lg:col-span-2 space-y-6">
              {/* Personal Information Card */}
              <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-100 dark:border-slate-800">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400">
                      <User size={20} />
                    </div>
                    <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                      Personal Information
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsEditingPersonal(!isEditingPersonal)}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40 transition cursor-pointer"
                  >
                    <Edit3 size={14} />
                    {isEditingPersonal ? "Done" : "Edit"}
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* DISPLAY NAME */}
                  <div className="rounded-xl bg-slate-50 p-4 border border-slate-100 dark:bg-slate-800/50 dark:border-slate-800">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                      DISPLAY NAME
                    </p>
                    {isEditingPersonal ? (
                      <input
                        type="text"
                        value={displayNameInput}
                        onChange={(e) => setDisplayNameInput(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                    ) : (
                      <p className="mt-1 text-sm font-bold text-slate-800 dark:text-slate-100">
                        {user.name || "Not set"}
                      </p>
                    )}
                  </div>

                  {/* PHONE NUMBER */}
                  <div className="rounded-xl bg-slate-50 p-4 border border-slate-100 dark:bg-slate-800/50 dark:border-slate-800">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                      PHONE NUMBER
                    </p>
                    {isEditingPersonal ? (
                      <input
                        type="text"
                        value={phoneInput}
                        onChange={(e) => setPhoneInput(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                    ) : (
                      <p className="mt-1 text-sm font-bold text-slate-800 dark:text-slate-100">
                        {user.mobile ? `+91 ${user.mobile.slice(-10)}` : "Not set"}
                      </p>
                    )}
                  </div>

                  {/* EMAIL */}
                  <div className="sm:col-span-2 rounded-xl bg-slate-50 p-4 border border-slate-100 dark:bg-slate-800/50 dark:border-slate-800">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                      EMAIL
                    </p>
                    {isEditingPersonal ? (
                      <input
                        type="email"
                        value={emailInput}
                        onChange={(e) => setEmailInput(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                    ) : (
                      <p className="mt-1 text-sm font-bold text-slate-800 dark:text-slate-100">
                        {user.email || "Not set"}
                      </p>
                    )}
                  </div>

                  {/* MARITAL STATUS */}
                  <div className="rounded-xl bg-slate-50 p-4 border border-slate-100 dark:bg-slate-800/50 dark:border-slate-800">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                      MARITAL STATUS
                    </p>
                    {isEditingPersonal ? (
                      <select
                        value={maritalStatus}
                        onChange={(e) => setMaritalStatus(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      >
                        <option value="Unmarried">Unmarried</option>
                        <option value="Married">Married</option>
                        <option value="Single">Single</option>
                      </select>
                    ) : (
                      <p className="mt-1 text-sm font-bold text-slate-800 dark:text-slate-100">
                        {maritalStatus}
                      </p>
                    )}
                  </div>

                  {/* BLOOD GROUP */}
                  <div className="rounded-xl bg-slate-50 p-4 border border-slate-100 dark:bg-slate-800/50 dark:border-slate-800">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                      BLOOD GROUP
                    </p>
                    {isEditingPersonal ? (
                      <select
                        value={bloodGroup}
                        onChange={(e) => setBloodGroup(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      >
                        <option value="AB+">AB+</option>
                        <option value="A+">A+</option>
                        <option value="B+">B+</option>
                        <option value="O+">O+</option>
                        <option value="O-">O-</option>
                      </select>
                    ) : (
                      <p className="mt-1 text-sm font-bold text-slate-800 dark:text-slate-100">
                        {bloodGroup}
                      </p>
                    )}
                  </div>
                </div>
              </section>

              {/* Addresses Card */}
              <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-100 dark:border-slate-800">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400">
                      <MapPin size={20} />
                    </div>
                    <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                      Addresses
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsEditingAddress(!isEditingAddress)}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40 transition cursor-pointer"
                  >
                    <Plus size={14} />
                    {isEditingAddress ? "Done" : "Add / Edit"}
                  </button>
                </div>

                <div className="space-y-4">
                  {/* Permanent Address */}
                  <div className="rounded-xl bg-slate-50 p-4 border border-slate-100 dark:bg-slate-800/50 dark:border-slate-800">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-400 shrink-0">
                          <Home size={18} />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-slate-900 dark:text-white">
                            Permanent Address
                          </p>
                          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                            {profile.address || (profile.city ? `${profile.city}, ${profile.state || ""}` : "Not configured yet")}
                          </p>
                          {profile.pincode && (
                            <p className="text-xs text-slate-400 dark:text-slate-500 font-medium">
                              PIN: {profile.pincode}
                            </p>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setIsEditingAddress(true)}
                        className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline shrink-0"
                      >
                        Edit &gt;
                      </button>
                    </div>
                  </div>

                  {/* Temporary / Current GPS Address */}
                  <div className="rounded-xl bg-slate-50 p-4 border border-slate-100 dark:bg-slate-800/50 dark:border-slate-800">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600 dark:bg-indigo-900/50 dark:text-indigo-400 shrink-0">
                          <MapPin size={18} />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-slate-900 dark:text-white">
                            Current GPS Location
                          </p>
                          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                            {detectedLocation?.address || (profile.latitude && profile.longitude ? `Coordinates: ${profile.latitude.toFixed(4)}, ${profile.longitude.toFixed(4)}` : "Location not detected yet")}
                          </p>
                          {profile.location_source && (
                            <span className="inline-block mt-1 rounded-md bg-blue-100 px-2 py-0.5 text-[10px] font-bold uppercase text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                              Source: {profile.location_source}
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void useCurrentLocation()}
                        className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline shrink-0"
                      >
                        Detect GPS &gt;
                      </button>
                    </div>

                    {detectedLocation && (
                      <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs dark:border-blue-900 dark:bg-blue-950/40">
                        <p className="font-semibold text-blue-900 dark:text-blue-200">
                          Detected current location:
                        </p>
                        <p className="mt-1 text-slate-700 dark:text-slate-300">{detectedLocation.address}</p>
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            onClick={() => void confirmDetectedLocation()}
                            className="rounded-md bg-blue-600 px-2.5 py-1 font-bold text-white"
                          >
                            Confirm GPS Location
                          </button>
                          <button
                            type="button"
                            onClick={() => setDetectedLocation(null)}
                            className="rounded-md border border-slate-300 px-2.5 py-1 font-semibold dark:border-slate-700"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* LocationPicker Form when editing */}
                  {isEditingAddress && (
                    <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
                      <p className="text-xs font-bold uppercase text-slate-500">Search Address Location</p>
                      <LocationPicker
                        value={profile.address || ""}
                        onSelect={selectLocation}
                        onUseCurrentLocation={useCurrentLocation}
                      />
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs font-bold text-slate-600 dark:text-slate-400">City</label>
                          <input
                            type="text"
                            value={profile.city || ""}
                            onChange={(e) => setProfile({ ...profile, city: e.target.value })}
                            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold dark:border-slate-700 dark:bg-slate-800"
                          />
                        </div>
                        <div>
                          <label className="text-xs font-bold text-slate-600 dark:text-slate-400">State</label>
                          <input
                            type="text"
                            value={profile.state || ""}
                            onChange={(e) => setProfile({ ...profile, state: e.target.value })}
                            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold dark:border-slate-700 dark:bg-slate-800"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </section>

              {/* Professional Details Card */}
              <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-100 dark:border-slate-800">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400">
                      <Briefcase size={20} />
                    </div>
                    <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                      Professional Details
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsEditingProfessional(!isEditingProfessional)}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40 transition cursor-pointer"
                  >
                    <Edit3 size={14} />
                    {isEditingProfessional ? "Done" : "Edit"}
                  </button>
                </div>

                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* WORK EXPERIENCE */}
                    <div className="rounded-xl bg-slate-50 p-4 border border-slate-100 dark:bg-slate-800/50 dark:border-slate-800">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                        WORK EXPERIENCE
                      </p>
                      {isEditingProfessional ? (
                        <input
                          type="number"
                          min="0"
                          value={profile.experience_years ?? ""}
                          onChange={(e) =>
                            setProfile({
                              ...profile,
                              experience_years: e.target.value ? Number(e.target.value) : null,
                            })
                          }
                          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                          placeholder="e.g. 3"
                        />
                      ) : (
                        <p className="mt-1 text-sm font-bold text-slate-800 dark:text-slate-100">
                          {profile.experience_years != null ? `${profile.experience_years}+ Years` : "Not set"}
                        </p>
                      )}
                    </div>

                    {/* CURRENT PROFESSION */}
                    <div className="rounded-xl bg-slate-50 p-4 border border-slate-100 dark:bg-slate-800/50 dark:border-slate-800">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                        CURRENT PROFESSION / TRADE
                      </p>
                      {isEditingProfessional ? (
                        <input
                          type="text"
                          value={profile.trade_id || ""}
                          onChange={(e) => setProfile({ ...profile, trade_id: e.target.value })}
                          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                          placeholder="e.g. Electrician"
                        />
                      ) : (
                        <p className="mt-1 text-sm font-bold text-slate-800 dark:text-slate-100">
                          {profile.trade_id || "Not set"}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* SKILLS / EXPERTISE */}
                  <div className="rounded-xl bg-slate-50 p-4 border border-slate-100 dark:bg-slate-800/50 dark:border-slate-800 space-y-2">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                      SKILLS / EXPERTISE
                    </p>
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      {skills.map((skill, index) => (
                        <span
                          key={index}
                          className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-xs border border-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700"
                        >
                          {skill}
                          {isEditingProfessional && (
                            <button
                              type="button"
                              onClick={() => handleRemoveSkill(skill)}
                              className="text-slate-400 hover:text-red-500 cursor-pointer"
                            >
                              ×
                            </button>
                          )}
                        </span>
                      ))}

                      {showSkillInput ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            value={newSkillInput}
                            onChange={(e) => setNewSkillInput(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleAddSkill()}
                            placeholder="Add skill"
                            className="rounded-full border border-blue-300 bg-white px-3 py-0.5 text-xs font-medium dark:bg-slate-800"
                            autoFocus
                          />
                          <button
                            type="button"
                            onClick={handleAddSkill}
                            className="rounded-full bg-blue-600 px-2 py-0.5 text-xs font-bold text-white"
                          >
                            Add
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setShowSkillInput(true)}
                          className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-100 text-blue-600 hover:bg-blue-200 dark:bg-blue-950 dark:text-blue-400 transition cursor-pointer"
                          title="Add skill tag"
                        >
                          <Plus size={16} />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* EXPECTED WAGE */}
                    <div className="rounded-xl bg-slate-50 p-4 border border-slate-100 dark:bg-slate-800/50 dark:border-slate-800">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                        EXPECTED WAGE
                      </p>
                      {isEditingProfessional ? (
                        <input
                          type="number"
                          min="0"
                          value={profile.expected_daily_wage ?? ""}
                          onChange={(e) =>
                            setProfile({
                              ...profile,
                              expected_daily_wage: e.target.value ? Number(e.target.value) : null,
                            })
                          }
                          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                          placeholder="e.g. 800"
                        />
                      ) : (
                        <p className="mt-1 text-sm font-bold text-slate-800 dark:text-slate-100">
                          {profile.expected_daily_wage ? `₹${profile.expected_daily_wage}/day` : "Not set"}
                        </p>
                      )}
                    </div>

                    {/* AVAILABILITY */}
                    <div className="rounded-xl bg-slate-50 p-4 border border-slate-100 dark:bg-slate-800/50 dark:border-slate-800">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                        AVAILABILITY
                      </p>
                      <select
                        value={profile.availability_status}
                        onChange={(e) =>
                          setProfile({
                            ...profile,
                            availability_status: e.target.value as Profile["availability_status"],
                          })
                        }
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-bold text-emerald-600 dark:border-slate-700 dark:bg-slate-800 dark:text-emerald-400 cursor-pointer"
                      >
                        <option value="AVAILABLE">Available</option>
                        <option value="ON_JOB">On a job</option>
                        <option value="OFFLINE">Offline</option>
                      </select>
                    </div>
                  </div>
                </div>
              </section>
            </div>

            {/* Right Column (Span 1): Documents & Security Cards */}
            <div className="space-y-6">
              {/* Documents Card */}
              <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center gap-3 mb-2">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400">
                    <UploadCloud size={20} />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                      Documents
                    </h2>
                  </div>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-6">
                  Upload your documents for verification
                </p>

                <div className="space-y-3">
                  {/* Experience Certificate */}
                  <div className="flex items-center justify-between rounded-xl bg-slate-50 p-3.5 border border-slate-100 dark:bg-slate-800/50 dark:border-slate-800">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-400 shrink-0">
                        <ShieldCheck size={16} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">
                          Experience Certificate
                        </p>
                        <p className="text-[10px] text-slate-400 truncate">Upload PDF, JPG or PNG</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toast.info("Document upload feature coming soon")}
                      className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition shrink-0 cursor-pointer"
                      title="Upload Experience Certificate"
                    >
                      <UploadCloud size={16} />
                    </button>
                  </div>

                  {/* Police Verification */}
                  <div className="flex items-center justify-between rounded-xl bg-slate-50 p-3.5 border border-slate-100 dark:bg-slate-800/50 dark:border-slate-800">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-400 shrink-0">
                        <ShieldCheck size={16} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">
                          Police Verification
                        </p>
                        <p className="text-[10px] text-slate-400 truncate">Upload PDF, JPG or PNG</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toast.info("Document upload feature coming soon")}
                      className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition shrink-0 cursor-pointer"
                      title="Upload Police Verification"
                    >
                      <UploadCloud size={16} />
                    </button>
                  </div>
                </div>
              </section>

              {/* Security / Privacy Banner Card matching Figma */}
              <section className="relative overflow-hidden rounded-2xl bg-linear-to-br from-blue-600 to-indigo-700 p-6 text-white text-center shadow-lg">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-white/20 backdrop-blur-md">
                  <ShieldCheck size={32} className="text-white" />
                </div>
                <h3 className="text-lg font-bold text-white">
                  Your information is safe with us
                </h3>
                <p className="mt-2 text-xs text-blue-100 leading-relaxed max-w-xs mx-auto">
                  We use enterprise-grade encryption to protect your data and privacy at all times.
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

        {/* Fixed Floating Save Changes Button */}
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-2xl bg-blue-600 px-6 py-3 font-bold text-white shadow-2xl hover:bg-blue-500 active:scale-95 transition disabled:opacity-50 cursor-pointer"
        >
          {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
          <span>Save Changes</span>
        </button>
      </div>
    </div>
  );
}