import { optimize } from 'svgo/browser';

const decoder = new TextDecoder('utf-8', { fatal: true });
const encoder = new TextEncoder();

self.onmessage = (event) => {
  try {
    const job = event.data;
    if (job?.op !== 'compress-svg' || !(job.buf instanceof ArrayBuffer)) {
      throw new Error('Invalid SVG compression job');
    }
    const original = new Uint8Array(job.buf);
    const result = optimize(decoder.decode(original), {
      multipass: false,
      plugins: [
        {
          name: 'preset-default',
          params: { overrides: { cleanupIds: false } },
        },
        'removeScripts',
      ],
    });
    const optimized = encoder.encode(result.data);
    const output =
      optimized.byteLength < original.byteLength ? optimized : original;
    const buffer = output.buffer.slice(
      output.byteOffset,
      output.byteOffset + output.byteLength,
    );
    self.postMessage({ ok: true, blob: buffer }, [buffer]);
  } catch (error) {
    self.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : 'SVG compression failed',
    });
  }
};
