import React from "react";
import ChatWorkspace from "@/components/agents/general-work/ChatWorkspace";

export default async function GeneralWorkConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  return <ChatWorkspace key={conversationId} conversationId={conversationId} />;
}
