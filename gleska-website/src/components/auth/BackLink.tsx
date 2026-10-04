"use client";

import React from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

interface BackLinkProps {
  href: string;
  label?: string;
  className?: string;
}

export default function BackLink({
  href,
  label = "Back",
  className = "",
}: BackLinkProps) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-2 text-sm font-semibold text-slate-500 transition hover:text-indigo-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:text-slate-400 dark:hover:text-indigo-300 ${className}`}
    >
      <ArrowLeft size={16} />
      <span>{label}</span>
    </Link>
  );
}
