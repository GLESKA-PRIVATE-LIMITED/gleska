"use client";

import React, { useMemo } from "react";
import { usePathname } from "next/navigation";
import AgentLayout from "@/components/agent-dashboard/AgentLayout";
import { useAuth } from "@/context/AuthContext";
import { GeneralWorkProvider, useGeneralWork } from "./GeneralWorkContext";
import RecentChats from "./RecentChats";
import { activeTabForPath, buildGeneralWorkConfig, generalWorkRoutes } from "./generalWorkConfig";

function ShellLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || generalWorkRoutes.newChat;
  const { activeConversationId, startNewChat } = useGeneralWork();

  const config = useMemo(
    () =>
      buildGeneralWorkConfig({
        // Dashboard returns to the conversation in progress, or the workspace home.
        dashboardHref: activeConversationId
          ? generalWorkRoutes.conversation(activeConversationId)
          : generalWorkRoutes.newChat,
        onNewChat: () => startNewChat(),
      }),
    [activeConversationId, startNewChat],
  );

  return (
    <AgentLayout
      config={config}
      activeTab={activeTabForPath(pathname)}
      setActiveTab={() => undefined}
      workspace
      sidebarContent={({ closeMobileSidebar }) => <RecentChats onNavigate={closeMobileSidebar} />}
    >
      {children}
    </AgentLayout>
  );
}

export default function GeneralWorkShell({ children }: { children: React.ReactNode }) {
  const { user, isLoading, nextStep } = useAuth();
  // Mirrors AgentLayout's access rule so no API call is made before it redirects.
  const enabled = !isLoading && user?.role === "EMPLOYER" && nextStep === "DASHBOARD";

  return (
    <GeneralWorkProvider enabled={enabled}>
      <ShellLayout>{children}</ShellLayout>
    </GeneralWorkProvider>
  );
}
