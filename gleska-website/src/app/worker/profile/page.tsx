"use client";

import React, { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  User,
  MapPin,
  Loader2,
  ShieldCheck,
  CheckCircle2,
  Edit3,
  Plus,
  Briefcase,
  Save,
  Camera,
  Home,
} from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import LocationPicker, { LocationSelection } from "@/components/LocationPicker";
import { getLocationErrorMessage, watchBrowserLocation } from "@/lib/location";
import { useWorkerProfilePhoto } from "@/lib/useWorkerProfilePhoto";
import AccountManagementShell from "@/components/AccountManagementShell";
import { WorkerErrorState, WorkerPageFrame, WorkerPageHeader } from "@/components/worker/WorkspaceUI";

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
  marital_status?: string | null;
  blood_group?: string | null;
  skills?: string[] | null;
  profile_completed?: boolean;
  trial_active?: boolean;
  subscription_active?: boolean;
  payment_required?: boolean;
};

export default function WorkerProfilePage() {
  const router = useRouter();
  const { user, isLoading, refreshUser, logout } = useAuth();

  // Profile data states
  const [profile, setProfile] = useState<Profile>({ availability_status: "OFFLINE" });
  const [loading, setLoading] = useState(true);
  const [profileLoadError, setProfileLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [isPopulatingPermanentAddress, setIsPopulatingPermanentAddress] = useState(false);
  const [permanentAddressLocationError, setPermanentAddressLocationError] = useState("");

  const [maritalStatus, setMaritalStatus] = useState("");
  const [bloodGroup, setBloodGroup] = useState("");
  const [skills, setSkills] = useState<string[]>([]);
  const [newSkillInput, setNewSkillInput] = useState("");
  const [showSkillInput, setShowSkillInput] = useState(false);

  // Editing UI states
  const profilePhotoInputRef = useRef<HTMLInputElement>(null);
  const { isUploading: isProfilePhotoUploading, uploadPhoto } = useWorkerProfilePhoto();

  const [isEditingPersonal, setIsEditingPersonal] = useState(false);
  const [isEditingAddress, setIsEditingAddress] = useState(false);
  const [isEditingProfessional, setIsEditingProfessional] = useState(false);

  // Form input local states for editable personal details
  const [displayNameInput, setDisplayNameInput] = useState("");
  const [phoneInput, setPhoneInput] = useState("");
  const [emailInput, setEmailInput] = useState("");

  const loadProfile = useCallback(async () => {
    if (!user || user.role !== "WORKER") return;
    setLoading(true);
    setProfileLoadError("");
    try {
      const response = await apiClient.get<Profile>("/api/v1/workers/me");
      setProfile(response.data);
      setDisplayNameInput(user.name || "");
      setPhoneInput(user.mobile || "");
      setEmailInput(user.email || "");
      setMaritalStatus(response.data.marital_status || "");
      setBloodGroup(response.data.blood_group || "");
      setSkills(Array.isArray(response.data.skills) ? response.data.skills : []);
    } catch (error: unknown) {
      const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      setProfileLoadError(typeof detail === "string" ? detail : "Unable to load your profile. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!isLoading && (!user || user.role !== "WORKER")) {
      router.replace("/worker/auth");
      return;
    }
    if (!isLoading && user?.role === "WORKER") void Promise.resolve().then(loadProfile);
  }, [isLoading, loadProfile, router, user]);

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

  const populatePermanentAddressFromCurrentLocation = async () => {
    setIsPopulatingPermanentAddress(true);
    setPermanentAddressLocationError("");
    try {
      const coordinates = await watchBrowserLocation({ policy: "ADDRESS" });
      setProfile((current) => ({
        ...current,
        address: "",
        city: "",
        state: "",
        pincode: "",
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        location_source: "GPS",
      }));
      try {
        const response = await apiClient.get<{
          address: string;
          city?: string | null;
          state?: string | null;
          pincode?: string | null;
        }>("/api/v1/locations/reverse", {
          params: { latitude: coordinates.latitude, longitude: coordinates.longitude },
        });
        if (!response.data.address?.trim()) throw new Error("Reverse geocoding returned no address.");
        setProfile((current) => ({
          ...current,
          address: response.data.address.trim(),
          city: response.data.city ?? "",
          state: response.data.state ?? "",
          pincode: response.data.pincode ?? "",
        }));
        toast.success("Address filled. Save Changes to update your permanent address.");
      } catch {
        setPermanentAddressLocationError(
          "Your coordinates were found, but the address could not be looked up. Enter or edit the address manually.",
        );
      }
    } catch (error) {
      setPermanentAddressLocationError(getLocationErrorMessage(error));
    } finally {
      setIsPopulatingPermanentAddress(false);
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
      const response = await apiClient.put("/api/v1/workers/me", {
        ...profile,
        name: displayNameInput.trim(),
        mobile: phoneInput.trim(),
        email: emailInput.trim() || null,
        marital_status: maritalStatus || null,
        blood_group: bloodGroup || null,
        skills,
      });
      setProfile(response.data);

      // Update marital/blood/skills from response
      setMaritalStatus(response.data.marital_status || "");
      setBloodGroup(response.data.blood_group || "");
      if (response.data.skills && Array.isArray(response.data.skills)) {
        setSkills(response.data.skills);
      }

      setIsEditingPersonal(false);
      setIsEditingAddress(false);
      setIsEditingProfessional(false);
      toast.success("Profile saved successfully");
      await refreshUser();
    } catch (error: unknown) {
      const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Unable to save profile");
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      toast.success("Logged out successfully");
    } catch {
      toast.error("Logout failed");
    }
  };

  const handleProfilePhotoChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      await uploadPhoto(file, refreshUser);
      toast.success("Profile photo updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to update profile photo");
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
  const membershipStatus = profile.trial_active
    ? "Free Trial"
    : profile.subscription_active
      ? "Active Subscription"
      : profile.payment_required
        ? "Payment Required"
        : null;
  const availabilityLabel = profile.availability_status === "AVAILABLE"
    ? "Available"
    : profile.availability_status === "ON_JOB"
      ? "On a job"
      : "Offline";

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

  if (profileLoadError) {
    return (
      <AccountManagementShell kind="worker" name={user.name || "Worker"} accountLabel="Worker" profileHref="/worker/profile" onLogout={() => void handleLogout()}>
        <WorkerPageFrame>
          <WorkerPageHeader title="Your Profile" description="View and update your personal and professional details." />
          <div className="mt-6">
            <WorkerErrorState message={profileLoadError} onRetry={() => void loadProfile()} />
          </div>
        </WorkerPageFrame>
      </AccountManagementShell>
    );
  }

  return (
    <AccountManagementShell kind="worker" name={user.name || "Worker"} accountLabel="Worker" profileHref="/worker/profile" onLogout={() => void handleLogout()}>
    <div className="flex flex-col md:flex-row min-h-screen bg-[#eef1fb] font-sans text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 min-h-screen overflow-y-auto">
        <main className="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 py-6 sm:py-8 space-y-6 pb-12">
          {/* Top Banner Card matching Figma */}
          <div className="relative overflow-hidden rounded-3xl bg-linear-to-r from-blue-600 via-indigo-600 to-purple-600 p-5 sm:p-6 text-white shadow-xl">
            {/* Ambient Background Accents */}
            <div className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-purple-400/20 blur-3xl" />

            <div className="relative z-10 grid min-w-0 gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
              <div className="min-w-0 max-w-lg">
                {/* Profile Strength Box */}
                <div className="w-full max-w-sm rounded-2xl border border-white/20 bg-white/15 p-3.5 shadow-inner backdrop-blur-md sm:p-4">
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

              <div className="flex min-w-0 items-center justify-between gap-3 md:justify-end md:gap-5">
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <h2 className="break-words text-xl font-bold text-white sm:text-2xl">{user.name || "Worker"}</h2>
                    {user.is_mobile_verified && <CheckCircle2 size={20} className="shrink-0 fill-blue-500 text-blue-300" />}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className="inline-flex max-w-full items-center rounded-full bg-white/15 px-3 py-1 text-xs font-bold uppercase tracking-wide text-white">{availabilityLabel}</span>
                    {membershipStatus && <span className="inline-flex max-w-full items-center rounded-full bg-slate-900/15 px-3 py-1 text-xs font-bold text-white">{membershipStatus}</span>}
                  </div>
                </div>

                <div className="relative shrink-0">
                  <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border-4 border-white/30 bg-blue-500 text-2xl font-extrabold text-white shadow-xl backdrop-blur-md sm:h-20 sm:w-20">
                    {user.profile_photo_url ? (
                      <img src={user.profile_photo_url} alt="Profile" className="h-full w-full object-cover" />
                    ) : (
                      (user.name || "W").charAt(0).toUpperCase()
                    )}
                  </div>
                  <input ref={profilePhotoInputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={handleProfilePhotoChange} className="hidden" />
                  <button
                    type="button"
                    title="Change profile photo"
                    onClick={() => profilePhotoInputRef.current?.click()}
                    disabled={isProfilePhotoUploading}
                    className="absolute bottom-0 right-0 flex h-8 w-8 items-center justify-center rounded-full bg-white text-blue-600 shadow-md transition hover:scale-110"
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
                        <option value="Divorced">Divorced</option>
                        <option value="Widowed">Widowed</option>
                        <option value="Separated">Separated</option>
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
                        <option value="A+">A+</option>
                        <option value="A-">A-</option>
                        <option value="B+">B+</option>
                        <option value="B-">B-</option>
                        <option value="AB+">AB+</option>
                        <option value="AB-">AB-</option>
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
                      Location
                    </h2>
                  </div>
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
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            Where you normally live
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
                        onClick={() => setIsEditingAddress((current) => !current)}
                        className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline shrink-0"
                      >
                        {isEditingAddress ? "Done" : "Edit address"}
                      </button>
                    </div>
                  </div>

                  {isEditingAddress && (
                    <div className="space-y-4 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                      <LocationPicker
                        key={profile.address || ""}
                        label="Search Address Location"
                        value={profile.address || ""}
                        onSelect={selectLocation}
                      />
                      <button
                        type="button"
                        onClick={() => void populatePermanentAddressFromCurrentLocation()}
                        disabled={isPopulatingPermanentAddress}
                        className="inline-flex items-center gap-2 text-sm font-semibold text-blue-700 disabled:cursor-wait disabled:opacity-60 dark:text-blue-300"
                      >
                        {isPopulatingPermanentAddress ? (
                          <Loader2 size={16} className="animate-spin" />
                        ) : (
                          <MapPin size={16} />
                        )}
                        {isPopulatingPermanentAddress ? "Getting location..." : "Use my current location"}
                      </button>
                      {permanentAddressLocationError && (
                        <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
                          {permanentAddressLocationError}
                        </p>
                      )}
                      <div>
                        <label htmlFor="worker-permanent-address" className="text-xs font-bold text-slate-600 dark:text-slate-400">Address</label>
                        <input
                          id="worker-permanent-address"
                          type="text"
                          value={profile.address || ""}
                          onChange={(event) => setProfile({ ...profile, address: event.target.value })}
                          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold dark:border-slate-700 dark:bg-slate-800"
                          placeholder="Enter your address"
                        />
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label className="text-xs font-bold text-slate-600 dark:text-slate-400">City</label>
                          <input
                            type="text"
                            value={profile.city || ""}
                            onChange={(e) => setProfile({ ...profile, city: e.target.value })}
                            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold dark:border-slate-700 dark:bg-slate-800"
                          />
                        </div>
                        <div>
                          <label className="text-xs font-bold text-slate-600 dark:text-slate-400">State</label>
                          <input
                            type="text"
                            value={profile.state || ""}
                            onChange={(e) => setProfile({ ...profile, state: e.target.value })}
                            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold dark:border-slate-700 dark:bg-slate-800"
                          />
                        </div>
                        <div>
                          <label className="text-xs font-bold text-slate-600 dark:text-slate-400">Pincode</label>
                          <input
                            type="text"
                            value={profile.pincode || ""}
                            onChange={(e) => setProfile({ ...profile, pincode: e.target.value })}
                            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold dark:border-slate-700 dark:bg-slate-800"
                            placeholder="6-digit postal code"
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
                      {skills.length === 0 && <p className="w-full text-sm text-slate-500 dark:text-slate-400">No skills added yet</p>}
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

        <div className="mx-auto flex w-full max-w-7xl justify-end px-4 pb-8 sm:px-6">
          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white shadow-md transition hover:bg-blue-500 active:scale-95 disabled:opacity-50"
          >
            {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
            <span>Save Changes</span>
          </button>
        </div>
      </div>
    </div>
    </AccountManagementShell>
  );
}