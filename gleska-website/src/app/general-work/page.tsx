import React from "react";
import NewChatPage from "@/components/agents/general-work/NewChatPage";

export default async function GeneralWorkPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string | string[] }>;
}) {
  const { project } = await searchParams;
  return <NewChatPage projectId={typeof project === "string" ? project : null} />;
}
