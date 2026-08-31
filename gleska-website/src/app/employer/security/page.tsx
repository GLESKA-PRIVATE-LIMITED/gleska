"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import {
  ShieldCheck,
  Shield,
  Lock,
  Key,
  CheckCircle2,
  Check,
  Laptop,
  Smartphone,
  Monitor,
  Lightbulb,
  ChevronRight,
  User,
  Building2,
  Users,
  FileText,
  LogOut,
  PanelLeft,
  X,
  LayoutDashboard,
  Loader2,
  Info,
  Clock,
  MapPin,
} from "lucide-react";
import { toast } from "sonner";

export default function EmployerSecurityPage() {
  const router = useRouter();
  const { user, isLoading, logout } = useAuth();
  const [isSidebarOpen, setIsSidebarOpen] = React.useState(true);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);

  React.useEffect(() => {
    if (!isLoading && !user) {
      router.push("/employer/auth");
      return;
    }

    if (!isLoading && user && user.role !== "EMPLOYER") {
      router.push("/");
      return;
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

  const handleChangePassword = () => {
    router.push("/auth/forgot-password");
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f4f6fc] dark:bg-slate-950">
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={36} className="animate-spin text-blue-600" />
          <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">
            Loading Security Settings...
          </p>
        </div>
      </div>
    );
  }

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
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300 transition cursor-pointer"
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

            <Link
              href="/employer/company-profile"
              className={`flex items-center gap-3 w-full rounded-xl px-3 py-2.5 text-sm font-semibold transition text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 ${
                isSidebarOpen ? "" : "justify-center"
              }`}
              title="Company profile"
            >
              <Building2 size={19} className="shrink-0" />
              {isSidebarOpen && <span>Company profile</span>}
            </Link>

            <button
              type="button"
              onClick={() => toast.info("Employee profile view")}
              className={`flex items-center gap-3 w-full rounded-xl px-3 py-2.5 text-sm font-semibold transition text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 ${
                isSidebarOpen ? "text-left" : "justify-center"
              }`}
              title="Employee profile"
            >
              <Users size={19} className="shrink-0" />
              {isSidebarOpen && <span>Employee profile</span>}
            </button>

            <button
              type="button"
              onClick={() => toast.info("Documents view")}
              className={`flex items-center gap-3 w-full rounded-xl px-3 py-2.5 text-sm font-semibold transition text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 ${
                isSidebarOpen ? "text-left" : "justify-center"
              }`}
              title="Documents"
            >
              <FileText size={19} className="shrink-0" />
              {isSidebarOpen && <span>Documents</span>}
            </button>

            <Link
              href="/employer/security"
              className={`flex items-center gap-3 w-full rounded-xl px-3 py-2.5 text-sm font-semibold transition bg-blue-600 text-white shadow-xs ${
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
            className={`flex items-center gap-3 w-full rounded-xl px-3 py-2.5 text-sm font-semibold text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40 transition cursor-pointer ${
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
                <Link
                  href="/employer/director-profile"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100"
                >
                  <User size={20} />
                  <span>Director profile</span>
                </Link>
                <Link
                  href="/employer/company-profile"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100"
                >
                  <Building2 size={20} />
                  <span>Company profile</span>
                </Link>
                <Link
                  href="/employer/security"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="flex items-center gap-3 rounded-xl bg-blue-600 px-3 py-2.5 text-sm font-semibold text-white"
                >
                  <ShieldCheck size={20} />
                  <span>Security</span>
                </Link>
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
            <h1 className="font-bold text-3xl text-slate-900 dark:text-white">Security</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Manage your account security and keep your information safe.
            </p>
          </div>

          <div className="space-y-8">
            {/* 1. Security Overview Banner Card */}
            <div className="rounded-3xl border border-blue-200/80 bg-gradient-to-br from-blue-50/80 via-indigo-50/40 to-blue-100/50 p-6 sm:p-8 dark:border-slate-800 dark:from-slate-900 dark:via-blue-950/20 dark:to-slate-900 shadow-md">
              <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
                  {/* Security Shield Graphic */}
                  <div className="relative flex h-28 w-28 shrink-0 items-center justify-center rounded-3xl bg-blue-600/10 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400 border border-blue-200/60 dark:border-blue-800">
                    <ShieldCheck size={56} className="text-blue-600 dark:text-blue-400" />
                    <div className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500 text-white shadow-md">
                      <Check size={18} className="stroke-[3]" />
                    </div>
                  </div>

                  <div>
                    <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
                      Your account is secure
                    </h2>
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 max-w-lg leading-relaxed">
                      We&apos;re constantly monitoring your account for suspicious activity. Your data is protected by industry-leading encryption.
                    </p>
                  </div>
                </div>

                {/* Security Status Box */}
                <div className="w-full lg:w-auto shrink-0 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900 min-w-[280px]">
                  <div className="flex items-center justify-between gap-4 pb-3 border-b border-slate-100 dark:border-slate-800">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Security Status
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-0.5 text-xs font-bold text-emerald-700 border border-emerald-200 dark:bg-emerald-950/60 dark:border-emerald-800 dark:text-emerald-300">
                      <CheckCircle2 size={13} />
                      Strong
                    </span>
                  </div>

                  <ul className="mt-3 space-y-2 text-xs font-medium text-slate-600 dark:text-slate-300">
                    <li className="flex items-center gap-2">
                      <Check size={14} className="text-emerald-500 shrink-0" />
                      <span>No security issues found</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <Check size={14} className="text-emerald-500 shrink-0" />
                      <span>Your account is up to date</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <Check size={14} className="text-emerald-500 shrink-0" />
                      <span>All protections are enabled</span>
                    </li>
                  </ul>

                  <button
                    type="button"
                    onClick={() => toast.info("All security protections are currently active.")}
                    className="mt-4 text-xs font-bold text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 transition cursor-pointer"
                  >
                    View security recommendations →
                  </button>
                </div>
              </div>
            </div>

            {/* 2 & 3. Account Protection & Security Activity Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              {/* Left Column: Account Protection */}
              <div className="lg:col-span-7 rounded-3xl border border-slate-200/90 bg-white p-6 sm:p-8 shadow-xl dark:border-slate-800 dark:bg-slate-900 flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-3 mb-6">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400">
                      <Lock size={20} />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                        Account Protection
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Manage your account access and credentials
                      </p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {/* Password Row */}
                    <div className="rounded-2xl border border-slate-200/80 bg-slate-50/50 p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-800/40">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-slate-900 dark:text-white">
                              Password
                            </span>
                            <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200 dark:bg-emerald-950/60 dark:border-emerald-800 dark:text-emerald-300 uppercase">
                              Strong
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            Last updated 25 Apr 2026
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={handleChangePassword}
                          className="inline-flex items-center justify-center gap-2 rounded-xl border border-blue-600 px-4 py-2 text-xs font-bold text-blue-600 hover:bg-blue-50 dark:border-blue-500 dark:text-blue-400 dark:hover:bg-blue-950/50 transition cursor-pointer shrink-0"
                        >
                          <Key size={14} />
                          <span>Change Password</span>
                        </button>
                      </div>
                    </div>

                    {/* Two-Factor Authentication Row */}
                    <div className="rounded-2xl border border-slate-200/80 bg-slate-50/50 p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-800/40">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-slate-900 dark:text-white">
                              Two-Factor Authentication
                            </span>
                            <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-[10px] font-bold text-blue-700 border border-blue-200 dark:bg-blue-950/60 dark:border-blue-800 dark:text-blue-300 uppercase">
                              Enabled
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            Adds an extra layer of security to your login process.
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() => toast.info("Two-factor authentication management is enabled.")}
                          className="inline-flex items-center justify-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-700 dark:text-blue-400 cursor-pointer shrink-0"
                        >
                          <span>Manage</span>
                        </button>
                      </div>
                    </div>

                    {/* Active Sessions Row */}
                    <div className="rounded-2xl border border-slate-200/80 bg-slate-50/50 p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-800/40">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div>
                          <span className="text-sm font-bold text-slate-900 dark:text-white">
                            Active Sessions
                          </span>
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            You&apos;re currently signed in on 3 different devices.
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() => toast.info("Viewing active sessions")}
                          className="inline-flex items-center justify-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-700 dark:text-blue-400 cursor-pointer shrink-0"
                        >
                          <span>View Sessions</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column: Security Activity */}
              <div className="lg:col-span-5 rounded-3xl border border-slate-200/90 bg-white p-6 sm:p-8 shadow-xl dark:border-slate-800 dark:bg-slate-900 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-6 pb-2 border-b border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-2">
                      <Shield size={18} className="text-blue-600 dark:text-blue-400" />
                      <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                        Security Activity
                      </h3>
                    </div>

                    <button
                      type="button"
                      onClick={() => toast.info("Displaying recent security log")}
                      className="text-xs font-bold text-blue-600 hover:text-blue-700 dark:text-blue-400 cursor-pointer"
                    >
                      View All
                    </button>
                  </div>

                  {/* Activity Timeline List */}
                  <div className="relative pl-6 space-y-6 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200 dark:before:bg-slate-800">
                    {/* Item 1 */}
                    <div className="relative">
                      <div className="absolute -left-6 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-white ring-4 ring-white dark:ring-slate-900">
                        <Check size={10} className="stroke-[3]" />
                      </div>
                      <p className="text-xs font-bold text-slate-900 dark:text-white">
                        Password changed successfully
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        25 Apr 2025, 10:45 AM
                      </p>
                    </div>

                    {/* Item 2 */}
                    <div className="relative">
                      <div className="absolute -left-6 top-1 h-3 w-3 rounded-full bg-blue-600 ring-4 ring-white dark:ring-slate-900" />
                      <p className="text-xs font-bold text-slate-900 dark:text-white">
                        New login on Chrome (Windows)
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        24 Apr 2025, 08:20 PM • New Delhi, IN
                      </p>
                    </div>

                    {/* Item 3 */}
                    <div className="relative">
                      <div className="absolute -left-6 top-1 h-3 w-3 rounded-full bg-blue-600 ring-4 ring-white dark:ring-slate-900" />
                      <p className="text-xs font-bold text-slate-900 dark:text-white">
                        New login on iPhone 14
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        22 Apr 2025, 02:15 PM • Mumbai, IN
                      </p>
                    </div>

                    {/* Item 4 */}
                    <div className="relative">
                      <div className="absolute -left-6 top-1 h-3 w-3 rounded-full bg-blue-600 ring-4 ring-white dark:ring-slate-900" />
                      <p className="text-xs font-bold text-slate-900 dark:text-white">
                        2FA successfully enabled
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        20 Apr 2025, 11:00 AM
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 4 & 5. Trusted Devices & Security Tips Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              {/* Left Column: Trusted Devices */}
              <div className="lg:col-span-7 rounded-3xl border border-slate-200/90 bg-white p-6 sm:p-8 shadow-xl dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center justify-between mb-6 pb-2 border-b border-slate-100 dark:border-slate-800">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400">
                      <Monitor size={20} />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                        Trusted Devices
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Devices that have access to your account
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => toast.info("Managing trusted devices")}
                    className="text-xs font-bold text-blue-600 hover:text-blue-700 dark:text-blue-400 cursor-pointer"
                  >
                    Manage All Devices
                  </button>
                </div>

                {/* Devices List */}
                <div className="space-y-3">
                  {/* Device 1 - Current Windows Chrome */}
                  <div className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200/80 bg-slate-50/50 p-4 dark:border-slate-800 dark:bg-slate-800/40">
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-100/60 text-blue-600 dark:bg-blue-950 dark:text-blue-400">
                        <Laptop size={20} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                            Windows Chrome
                          </p>
                          <span className="rounded-md bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                            This device
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                          New Delhi, India • <span className="text-blue-600 dark:text-blue-400 font-semibold">Current Session</span>
                        </p>
                      </div>
                    </div>

                    <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200 dark:bg-emerald-950/60 dark:border-emerald-800 dark:text-emerald-300 uppercase shrink-0">
                      CURRENT
                    </span>
                  </div>

                  {/* Device 2 - iPhone 14 */}
                  <div className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200/80 bg-slate-50/50 p-4 dark:border-slate-800 dark:bg-slate-800/40">
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-100/60 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400">
                        <Smartphone size={20} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                          iPhone 14
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                          Mumbai, India • Active 2 hours ago
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => toast.success("Device access removed")}
                      className="rounded-xl border border-rose-200 px-3.5 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-50 dark:border-rose-900/60 dark:text-rose-400 dark:hover:bg-rose-950/40 transition cursor-pointer shrink-0"
                    >
                      Remove
                    </button>
                  </div>

                  {/* Device 3 - MacBook Air */}
                  <div className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200/80 bg-slate-50/50 p-4 dark:border-slate-800 dark:bg-slate-800/40">
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-200/60 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        <Laptop size={20} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                          MacBook Air
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                          Bengaluru, India • Active 1 day ago
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => toast.success("Device access removed")}
                      className="rounded-xl border border-rose-200 px-3.5 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-50 dark:border-rose-900/60 dark:text-rose-400 dark:hover:bg-rose-950/40 transition cursor-pointer shrink-0"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>

              {/* Right Column: Security Tips */}
              <div className="lg:col-span-5 rounded-3xl border border-slate-200/90 bg-white p-6 sm:p-8 shadow-xl dark:border-slate-800 dark:bg-slate-900 flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-6 pb-2 border-b border-slate-100 dark:border-slate-800">
                    <Lightbulb size={20} className="text-amber-500" />
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                      Security Tips
                    </h3>
                  </div>

                  <div className="space-y-3">
                    <button
                      type="button"
                      onClick={() => toast.info("Password tip: Use at least 12 characters including symbols.")}
                      className="group flex w-full items-center justify-between rounded-2xl bg-blue-50/60 p-4 text-left border border-blue-100/60 hover:bg-blue-100/60 dark:bg-slate-800/60 dark:border-slate-800 dark:hover:bg-slate-800 transition cursor-pointer"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-600/10 text-blue-600 dark:bg-blue-950 dark:text-blue-400">
                          <Key size={16} />
                        </div>
                        <span className="text-xs font-bold text-slate-900 dark:text-white">
                          How to create a strong password
                        </span>
                      </div>
                      <ChevronRight size={16} className="text-slate-400 group-hover:translate-x-0.5 transition-transform" />
                    </button>

                    <button
                      type="button"
                      onClick={() => toast.info("2FA tip: Keep your backup codes stored securely.")}
                      className="group flex w-full items-center justify-between rounded-2xl bg-blue-50/60 p-4 text-left border border-blue-100/60 hover:bg-blue-100/60 dark:bg-slate-800/60 dark:border-slate-800 dark:hover:bg-slate-800 transition cursor-pointer"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-600/10 text-blue-600 dark:bg-blue-950 dark:text-blue-400">
                          <ShieldCheck size={16} />
                        </div>
                        <span className="text-xs font-bold text-slate-900 dark:text-white">
                          Importance of enabling 2FA
                        </span>
                      </div>
                      <ChevronRight size={16} className="text-slate-400 group-hover:translate-x-0.5 transition-transform" />
                    </button>

                    <button
                      type="button"
                      onClick={() => toast.info("Device tip: Sign out of public computers after use.")}
                      className="group flex w-full items-center justify-between rounded-2xl bg-blue-50/60 p-4 text-left border border-blue-100/60 hover:bg-blue-100/60 dark:bg-slate-800/60 dark:border-slate-800 dark:hover:bg-slate-800 transition cursor-pointer"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-600/10 text-blue-600 dark:bg-blue-950 dark:text-blue-400">
                          <Monitor size={16} />
                        </div>
                        <span className="text-xs font-bold text-slate-900 dark:text-white">
                          Keeping your devices secure
                        </span>
                      </div>
                      <ChevronRight size={16} className="text-slate-400 group-hover:translate-x-0.5 transition-transform" />
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => toast.info("Security recommendations documentation")}
                    className="mt-6 w-full text-center text-xs font-bold text-blue-600 hover:text-blue-700 dark:text-blue-400 transition cursor-pointer"
                  >
                    Learn more about account security
                  </button>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
