"use client";

import { VideoProgress, type ProgressStatus } from "@/components/VideoProgress";

export type ToolProgressFile = {
  name: string;
  progress: number;
  status: ProgressStatus;
  message?: string;
  // What to know about the result, such as the rows a table image leaves out.
  notice?: string;
};

type ToolProgressIndicatorProps = {
  currentFile: ToolProgressFile | null;
  className?: string;
  completedLabel?: string;
};

export function ToolProgressIndicator({
  currentFile,
  className,
  completedLabel,
}: ToolProgressIndicatorProps) {
  if (!currentFile) return null;

  return (
    <div className={className ?? "max-w-2xl mx-auto"}>
      <VideoProgress
        fileName={currentFile.name}
        progress={currentFile.progress}
        status={currentFile.status}
        message={currentFile.message}
        notice={currentFile.notice}
        completedLabel={completedLabel}
      />
    </div>
  );
}
