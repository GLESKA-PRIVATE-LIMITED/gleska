import React from "react";
import GeneralWorkShell from "@/components/agents/general-work/GeneralWorkShell";

export const metadata = {
  title: "General Work | GLESKA AI",
  description: "A conversational AI workspace for research, writing, analysis and everyday work.",
};

export default function GeneralWorkLayout({ children }: { children: React.ReactNode }) {
  return <GeneralWorkShell>{children}</GeneralWorkShell>;
}
