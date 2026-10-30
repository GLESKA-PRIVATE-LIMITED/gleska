"use client";

import ChatWorkspace from "./ChatWorkspace";
import { useGeneralWork } from "./GeneralWorkContext";

/** Keyed by the New Chat counter so every New Chat starts from a clean view. */
export default function NewChatPage({ projectId }: { projectId?: string | null }) {
  const { newChatKey } = useGeneralWork();
  return <ChatWorkspace key={`new-${newChatKey}-${projectId ?? ""}`} projectId={projectId} />;
}
