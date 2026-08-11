export function readTranscriptionTerminalState() {
  const transcript = document.querySelector("textarea")?.value?.trim() ?? "";
  if (transcript) return { status: "succeeded", transcript };

  const progress = document.querySelector('[data-testid="video-progress"]');
  if (progress?.getAttribute("data-status") === "error") {
    return {
      status: "failed",
      message: progress.textContent?.trim() || "Transcription failed",
    };
  }
  return null;
}
