'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert, AlertDescription } from '@serp-tools/ui/components/alert';
import { Button } from '@serp-tools/ui/components/button';
import { AlertTriangle, Download, FileImage, Loader2, X } from 'lucide-react';

import { ToolHeroLayout } from '@/components/ToolHeroLayout';
import { ToolVideoPanel } from '@/components/ToolVideoPanel';
import {
  createBatchRunController,
  createBrowserBatchWorkflow,
} from '@/lib/batch-browser-workflow';
import type { WorkflowDelivery, WorkflowSnapshot } from '@/lib/tool-workflow';

type Props = {
  toolId?: string;
  title: string;
  subtitle?: string;
  from: string;
  to: string;
  accept?: string;
  videoEmbedId?: string;
};

type CompressionLevel = 'low' | 'medium' | 'high' | 'extreme';

export default function BatchHeroConverter({
  toolId,
  title,
  subtitle = 'Fast, private, in-browser batch compression.',
  from,
  to,
  accept,
  videoEmbedId,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [snapshot, setSnapshot] = useState<WorkflowSnapshot>();
  const [delivery, setDelivery] = useState<WorkflowDelivery>();
  const [error, setError] = useState<string>();
  const [compressionLevel, setCompressionLevel] =
    useState<CompressionLevel>('high');
  const [adsVisible, setAdsVisible] = useState(false);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [{ workflow, deliveries }] = useState(createBrowserBatchWorkflow);
  const [controller] = useState(() =>
    createBatchRunController(workflow, {
      observe: setSnapshot,
      onOutcome(outcome) {
        setBusy(false);
        if (outcome.status === 'succeeded') {
          setDelivery(outcome.results[0]);
          setError(undefined);
        } else if (outcome.status === 'failed') {
          setDelivery(undefined);
          setError(outcome.error.message);
        }
      },
    }),
  );

  useEffect(
    () => () => {
      controller.dispose();
      deliveries.clear();
    },
    [controller, deliveries],
  );

  async function handleFiles(fileList: FileList | null) {
    if (!fileList?.length) return;
    const selected = Array.from(fileList);
    setFiles(selected);
    setDelivery(undefined);
    setError(undefined);
    setSnapshot(undefined);
    setBusy(true);
    setAdsVisible(true);
    setVideoPlaying(true);
    const outcome = await controller.runFiles(selected, compressionLevel);
    if (!outcome) setBusy(false);
  }

  function cancel() {
    controller.cancel();
    setBusy(false);
    setSnapshot(undefined);
  }

  function download() {
    if (delivery) deliveries.download(delivery);
  }

  const current = snapshot?.item;
  const aggregatePercent = Math.round((snapshot?.progress ?? 0) * 100);
  const totalInputBytes = files.reduce((total, file) => total + file.size, 0);
  const colors = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7'];
  const color =
    colors[
      Math.abs(
        (from + to)
          .split('')
          .reduce(
            (hash, character) => character.charCodeAt(0) + ((hash << 5) - hash),
            0,
          ),
      ) % colors.length
    ];

  return (
    <ToolHeroLayout
      adsVisible={adsVisible}
      adSlotPrefix={toolId ?? `${from}-to-${to}`}
      sectionClassName="relative flex items-center justify-center min-h-[60vh] overflow-hidden"
      containerClassName="relative w-full max-w-7xl mx-auto py-16"
      inlineAdClassName="mt-8"
      background={
        <div
          className="absolute inset-0 -z-10 bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800"
          aria-hidden
        />
      }
      hero={
        <div>
          <div className="text-center mb-12">
            <h1 className="text-4xl md:text-6xl font-bold mb-4">{title}</h1>
            <p className="text-lg md:text-xl text-gray-600 dark:text-gray-300">
              {subtitle}
            </p>
          </div>
          <div
            className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-12"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              void handleFiles(event.dataTransfer.files);
            }}
            data-testid="batch-compress-dropzone"
            style={{ border: `3px solid ${color}` }}
          >
            <input
              ref={inputRef}
              type="file"
              accept={accept || '.png,image/png'}
              multiple
              className="hidden"
              onChange={(event) => void handleFiles(event.target.files)}
              data-testid="batch-compress-input"
            />
            <div className="text-center">
              <FileImage className="w-16 h-16 mx-auto mb-6 text-gray-400" />
              {!busy && !delivery && (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-6">
                    {(['low', 'medium', 'high', 'extreme'] as const).map(
                      (level) => (
                        <button
                          key={level}
                          onClick={() => setCompressionLevel(level)}
                          className={`px-3 py-2 rounded-lg capitalize ${compressionLevel === level ? 'bg-blue-500 text-white' : 'bg-gray-200 dark:bg-gray-700'}`}
                        >
                          {level}
                        </button>
                      ),
                    )}
                  </div>
                  <Button
                    onClick={() => inputRef.current?.click()}
                    size="lg"
                    style={{ backgroundColor: color }}
                  >
                    Select PNG Files
                  </Button>
                  <p className="mt-4 text-gray-500">
                    or drop multiple files here
                  </p>
                </>
              )}
              {busy && (
                <div className="space-y-4">
                  <Loader2 className="w-8 h-8 mx-auto animate-spin text-blue-500" />
                  <p>
                    {current
                      ? `Compressing file ${current.index + 1} of ${current.total}: ${current.name}`
                      : `Preparing ${files.length} files…`}
                  </p>
                  <p className="text-sm text-gray-500">
                    {current?.progress === undefined
                      ? 'Current item progress is indeterminate'
                      : `Current item ${Math.round(current.progress * 100)}%`}
                  </p>
                  <div
                    className="w-full bg-gray-200 rounded-full h-2.5"
                    data-testid="batch-progress"
                  >
                    <div
                      className="bg-blue-600 h-2.5 rounded-full"
                      style={{ width: `${aggregatePercent}%` }}
                    />
                  </div>
                  <Button onClick={cancel} variant="outline">
                    <X className="w-4 h-4" /> Cancel
                  </Button>
                </div>
              )}
              {!busy && delivery && (
                <div className="space-y-4">
                  <div className="text-green-600">
                    ✓ Compressed {files.length} files successfully!
                  </div>
                  <p className="text-sm text-gray-600">
                    Original size:{' '}
                    {(totalInputBytes / 1_024 / 1_024).toFixed(2)} MB
                  </p>
                  <Button
                    onClick={download}
                    size="lg"
                    data-testid="batch-compress-download"
                    style={{ backgroundColor: color }}
                  >
                    <Download className="w-4 h-4" /> Download ZIP (
                    {(delivery.size / 1_024 / 1_024).toFixed(2)} MB)
                  </Button>
                  <Button
                    onClick={() => inputRef.current?.click()}
                    variant="outline"
                  >
                    Compress More Files
                  </Button>
                </div>
              )}
              {error && (
                <Alert className="mt-4" variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </div>
          </div>
          <div className="mt-8 text-center text-sm text-gray-500">
            <p>✓ All processing happens in your browser</p>
            <p>✓ One validated ZIP preserves input order</p>
          </div>
          {videoEmbedId && (
            <div className="mt-10">
              <ToolVideoPanel embedId={videoEmbedId} autoplay={videoPlaying} />
            </div>
          )}
        </div>
      }
    />
  );
}
