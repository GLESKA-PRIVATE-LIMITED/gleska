"use client";

import React from "react";
import AgentLayout from "@/components/agent-dashboard/AgentLayout";
import { logisticsConfig } from "./logisticsConfig";

export default function LogisticsAgentPage() {
  return <AgentLayout config={logisticsConfig} />;
}
