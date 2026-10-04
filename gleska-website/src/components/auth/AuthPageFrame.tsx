import type { ReactNode } from "react";
import Navbar from "@/components/landing/Navbar";

export default function AuthPageFrame({
  children,
  contentClassName = "",
  rightAction,
}: {
  children: ReactNode;
  contentClassName?: string;
  rightAction?: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50 font-sans text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <Navbar rightAction={rightAction} />
      <main className={`mx-auto flex w-full max-w-7xl flex-1 items-center justify-center px-4 py-8 sm:px-6 sm:py-10 lg:px-8 ${contentClassName}`}>
        {children}
      </main>
    </div>
  );
}