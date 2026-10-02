"use client";

import React from "react";
import AgentLayout from "@/components/agent-dashboard/AgentLayout";
import { financialConfig } from "./financialConfig";

export default function FinancialAgentPage() {
  return <AgentLayout config={financialConfig} />;
}
