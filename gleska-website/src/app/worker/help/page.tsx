"use client";

import Link from "next/link";
import { CircleHelp, FileText, MapPin, ShieldCheck, WalletCards } from "lucide-react";
import AccountManagementShell from "@/components/AccountManagementShell";
import { useAuth } from "@/context/AuthContext";
import { WorkerPageFrame, WorkerPageHeader, WorkspaceCard } from "@/components/worker/WorkspaceUI";

const topics = [
  { title: "Jobs", text: "Keep your profile, trade, availability, and location current so matching can find suitable work.", icon: FileText },
  { title: "Attendance", text: "Check in and out from the accepted work site. GPS freshness, accuracy, and the site geofence are verified by the server.", icon: ShieldCheck },
  { title: "Location", text: "Allow browser location access and use a device with a clear GPS signal when attendance requires a fresh position.", icon: MapPin },
  { title: "Subscription", text: "Review your current worker plan and payment status in Subscription.", icon: WalletCards },
];

export default function WorkerHelpPage() {
  const { user, logout } = useAuth();
  return <AccountManagementShell kind="worker" name={user?.name || "Worker"} accountLabel="Worker" profileHref="/worker/profile" onLogout={() => void logout()}><WorkerPageFrame><WorkerPageHeader eyebrow="Support" title="Help" description="Quick answers for common Worker tasks." /><div className="mt-8 grid gap-4 sm:grid-cols-2">{topics.map(({ title, text, icon: Icon }) => <WorkspaceCard key={title}><Icon size={22} className="text-blue-700" /><h2 className="mt-4 font-bold text-slate-900 dark:text-white">{title}</h2><p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{text}</p></WorkspaceCard>)}</div><WorkspaceCard className="mt-8 border-blue-100 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/20"><div className="flex items-start gap-3"><CircleHelp size={22} className="mt-0.5 text-blue-700" /><div><h2 className="font-bold text-blue-950 dark:text-blue-100">Need more help?</h2><p className="mt-1 text-sm text-blue-900 dark:text-blue-200">Contact support through the existing support form.</p><Link href="/contact" className="mt-4 inline-block rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-800">Contact support</Link></div></div></WorkspaceCard></WorkerPageFrame></AccountManagementShell>;
}
