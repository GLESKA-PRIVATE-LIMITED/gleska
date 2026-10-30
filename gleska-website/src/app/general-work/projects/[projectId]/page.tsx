import React from "react";
import ProjectDetailView from "@/components/agents/general-work/ProjectDetailView";

export default async function GeneralWorkProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <ProjectDetailView key={projectId} projectId={projectId} />;
}
