"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, BriefcaseBusiness, CheckCircle2, CircleHelp, CreditCard, FileCheck2, MessageCircle } from "lucide-react";
import AccountManagementShell, { formatEmployerType } from "@/components/AccountManagementShell";
import { useAuth } from "@/context/AuthContext";

type HelpSection = {
  title: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  items: string[];
};

const sections: HelpSection[] = [
  {
    title: "Getting Started",
    icon: CircleHelp,
    items: [
      "How do I post a job?",
      "How do I add a work site?",
      "How do I find workers?",
      "How does worker matching work?",
      "How do I hire a worker?",
    ],
  },
  {
    title: "Jobs & Workers",
    icon: BriefcaseBusiness,
    items: [
      "Post and manage jobs from the dashboard.",
      "View workers matched to an open job.",
      "Select a matched worker when a job is open for hiring.",
      "Review the current status of each job.",
      "Use worker availability and profile details when choosing a worker.",
    ],
  },
  {
    title: "Attendance",
    icon: CheckCircle2,
    items: [
      "Review attendance records for workers hired through GO LESKA.",
      "Use the attendance workflow for check-in and check-out records.",
      "Filter attendance history by date, worker, job, site, or status.",
      "Correct an attendance record with a reason when the workflow allows it.",
    ],
  },
  {
    title: "Profile & Verification",
    icon: FileCheck2,
    items: [
      "Open Profile from the account menu to review your employer information.",
      "Registered employers can review company and director information where applicable.",
      "Unregistered businesses can review business and proprietor information where applicable.",
      "Individuals can review their Individual Profile.",
      "Keep persisted profile information current when updates are supported.",
    ],
  },
  {
    title: "Subscription & Payments",
    icon: CreditCard,
    items: [
      "Open Subscription to review the current subscription state.",
      "Use the existing payment flow when a subscription is needed or renewed.",
      "Review the payment result after returning from checkout.",
      "Contact support if a payment or subscription state needs attention.",
    ],
  },
];

export default function EmployerHelpPage() {
  const router = useRouter();
  const { user, isLoading, nextStep, logout } = useAuth();

  React.useEffect(() => {
    if (isLoading) return;
    if (!user) {
      router.push("/employer/auth");
      return;
    }
    if (user.role !== "EMPLOYER") {
      router.push("/");
      return;
    }
    if (nextStep !== "DASHBOARD") {
      router.push("/employer/onboarding");
    }
  }, [isLoading, nextStep, router, user]);

  if (isLoading || !user || user.role !== "EMPLOYER" || nextStep !== "DASHBOARD") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#eef1fb] dark:bg-slate-950">
        <div className="h-9 w-9 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600" aria-label="Loading help" />
      </div>
    );
  }

  return (
    <AccountManagementShell
      kind="employer"
      name={user.name}
      accountLabel={formatEmployerType(user.employer_type)}
      employerType={user.employer_type}
      onLogout={() => void logout()}
    >
      <main className="min-h-screen px-4 py-8 text-slate-900 dark:text-slate-100 sm:px-6 sm:py-12">
        <div className="mx-auto max-w-7xl">
          <header className="mb-8 border-b border-slate-200 pb-6 dark:border-slate-800">
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">Employer workspace</p>
            <h1 className="mt-2 text-3xl font-bold text-slate-900 dark:text-white sm:text-4xl">Help &amp; Support</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-slate-400">Find answers and get help with your employer account.</p>
          </header>

          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {sections.map(({ title, icon: Icon, items }) => (
              <section key={title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900 sm:p-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">
                    <Icon size={21} />
                  </div>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white">{title}</h2>
                </div>
                <ul className="mt-5 space-y-3">
                  {items.map((item) => (
                    <li key={item} className="flex gap-2.5 text-sm leading-6 text-slate-600 dark:text-slate-300">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-600" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          <section className="mt-5 rounded-2xl border border-blue-200 bg-blue-50 p-6 dark:border-blue-900/70 dark:bg-blue-950/30 sm:p-7">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <MessageCircle size={23} className="mt-0.5 shrink-0 text-blue-700 dark:text-blue-300" />
                <div>
                  <h2 className="font-bold text-blue-950 dark:text-blue-100">Contact Support</h2>
                  <p className="mt-1 text-sm leading-6 text-blue-900/80 dark:text-blue-200/80">Need more help? Send a message through the existing support form.</p>
                </div>
              </div>
              <Link href="/contact" className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-blue-800">
                Contact support
                <ArrowRight size={16} />
              </Link>
            </div>
          </section>
        </div>
      </main>
    </AccountManagementShell>
  );
}
