"use client";

import { useRef, useState, useEffect } from "react";
import { Button } from "@serp-tools/ui/components/button";
import { ToolHeroLayout } from "@/components/ToolHeroLayout";
import { ToolResultMonetizationPanel } from "@/components/ToolResultMonetizationPanel";
import {
  getGenericAccept,
  getGenericToolContract,
} from "@/lib/generic-tool-workflow";
import { useGenericToolWorkflow } from "@/lib/useGenericToolWorkflow";
import type { OperationType } from "@/types";

type Props = {
  toolId?: string;
  title: string;              // e.g., "PDF to JPG"
  subtitle?: string;          // e.g., "Convert each PDF page into a JPG…"
  from: string;               // "pdf"
  to: string;                 // "jpg"
  accept?: string;            // optional override accept attr
  operation?: OperationType;
};

export default function HeroConverter({
  toolId,
  title,
  subtitle = "Fast, private, in-browser conversion.",
  from,
  to,
  accept,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dropRef = useRef<HTMLDivElement | null>(null);
  const [hint, setHint] = useState("or drop files here");
  const [dropEffect, setDropEffect] = useState<string>("");
  const { adsVisible, busy, currentFile, runFiles } = useGenericToolWorkflow({
    toolId: toolId ?? `${from}-to-${to}`,
  });
  // Generate stable color based on tool properties
  const colors = [
    "#ef4444", // red-500
    "#f59e0b", // amber-500  
    "#22c55e", // green-500
    "#3b82f6", // blue-500
    "#a855f7", // purple-500
    "#ec4899", // pink-500
    "#14b8a6", // teal-500
    "#f97316", // orange-500
    "#6366f1", // indigo-500
    "#f43f5e", // rose-500
    "#0ea5e9", // sky-500
    "#84cc16", // lime-500
  ];

  // Use a stable hash based on from/to combination
  const hashCode = (from + to).split('').reduce((hash, char) => {
    return char.charCodeAt(0) + ((hash << 5) - hash);
  }, 0);
  const randomColor = colors[Math.abs(hashCode) % colors.length];
  function onPick() {
    inputRef.current?.click();
  }

  // simple drag/drop
  function onDrag(e: React.DragEvent) {
    e.preventDefault();
    if (e.type === "dragenter" || e.type === "dragover") setHint("Drop to convert");
    if (e.type === "dragleave") setHint("or drop files here");
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();

    // Trigger fun effect - cycle through based on time
    const effects = [
      "splash",
      "bounce",
      "spin",
      "pulse",
      "shake",
      "flip",
      "zoom",
      "confetti",
      "rejected"
    ];
    // Use timestamp to cycle through effects deterministically
    const effectIndex = Math.floor(Date.now() / 1000) % effects.length;
    const effect = effects[effectIndex];
    if (effect) {
      setDropEffect(effect);
    }

    // Clear effect after animation
    setTimeout(() => setDropEffect(""), 1000);

    setHint("Converting…");
    runFiles(e.dataTransfer.files).finally(() => setHint("or drop files here"));
  }

  // Clear drop effect when component unmounts or effect changes
  useEffect(() => {
    if (dropEffect) {
      const timer = setTimeout(() => setDropEffect(""), 1000);
      return () => clearTimeout(timer);
    }
  }, [dropEffect]);

  const acceptAttr = accept ?? getGenericAccept(from);
  const contractState = getGenericToolContract(
    toolId ?? `${from}-to-${to}`,
  ).state;

  const adSlotPrefix = toolId ?? `${from}-to-${to}`;

  return (
    <ToolHeroLayout
      adsVisible={adsVisible}
      adSlotPrefix={adSlotPrefix}
      currentFile={currentFile}
      contentClassName="text-center"
      resultPanel={<ToolResultMonetizationPanel slotPrefix={adSlotPrefix} />}
      hero={
        <div
          ref={dropRef}
          onDragEnter={onDrag}
          onDragOver={onDrag}
          onDragLeave={onDrag}
          onDrop={onDrop}
          data-testid="tool-dropzone"
          data-generic-contract={contractState}
          className={`mt-8 mx-auto max-w-6xl border-2 border-dashed rounded-2xl p-12 hover:border-opacity-80 transition-colors cursor-pointer ${dropEffect ? `animate-${dropEffect}` : ""
            }`}
          style={{
            backgroundColor: randomColor + "15", // 15 is ~8% opacity
            borderColor: randomColor,
          }}
          onClick={onPick}
        >
          <div className="flex flex-col items-center space-y-6">
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">{title}</h1>
            <p className="text-sm text-muted-foreground">{subtitle}</p>

            <svg
              className="w-12 h-12"
              fill="none"
              stroke="currentColor"
              style={{ color: randomColor }}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>

            <Button
              size="lg"
              className="h-12 px-8 rounded-xl text-white shadow-lg"
              style={{
                backgroundColor: randomColor,
                borderColor: randomColor,
              }}
              onClick={(e) => {
                e.stopPropagation();
                onPick();
              }}
              disabled={busy}
            >
              {busy ? "Working…" : `CHOOSE FILES`}
            </Button>

            <div className="text-sm" style={{ color: randomColor }}>
              <p className="font-medium">{hint}</p>
            </div>
          </div>

          <input
            ref={inputRef}
            type="file"
            multiple
            accept={acceptAttr}
            className="hidden"
            data-testid="tool-file-input"
            onChange={(e) => runFiles(e.target.files)}
          />
        </div>
      }
    />
  );
}
