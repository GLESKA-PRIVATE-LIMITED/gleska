"use client";

import React from "react";
import AgentLayout from "@/components/agent-dashboard/AgentLayout";
import { procurementConfig } from "./procurementConfig";

export default function ProcurementAgentPage() {
  return <AgentLayout config={procurementConfig} />;
}
