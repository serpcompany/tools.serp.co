export const TOOL_OPERATION_TAXONOMY = Object.freeze({
  convert: Object.freeze({
    name: 'Convert',
    title: 'Convert Tools',
    description:
      'Convert image, audio, video, document, and data files directly in your browser.',
  }),
  download: Object.freeze({
    name: 'Downloaders',
    title: 'Downloaders',
    description:
      'Download supported public videos and media links straight to your device.',
  }),
  compress: Object.freeze({
    name: 'Compress',
    title: 'Compress Tools',
    description:
      'Reduce file size online while keeping the output usable and shareable.',
  }),
  combine: Object.freeze({
    name: 'Combine',
    title: 'Combine Tools',
    description:
      'Merge multiple files into one output without installing extra software.',
  }),
  bulk: Object.freeze({
    name: 'Bulk Operations',
    title: 'Bulk Operations',
    description:
      'Run batch file workflows and multi-file operations in a single pass.',
  }),
  edit: Object.freeze({
    name: 'Edit',
    title: 'Edit Tools',
    description:
      'Open and edit supported files online without installing desktop software.',
  }),
  'video-editor': Object.freeze({
    name: 'Video Editor',
    title: 'Video Editor Tools',
    description:
      'Trim, crop, and enhance videos online without installing desktop software.',
  }),
  'image-editor': Object.freeze({
    name: 'Image Editor',
    title: 'Image Editor Tools',
    description:
      'Edit and enhance images online with quick adjustments and exports.',
  }),
  'audio-editor': Object.freeze({
    name: 'Audio Editor',
    title: 'Audio Editor Tools',
    description:
      'Trim, merge, and refine audio tracks online with fast exports.',
  }),
  view: Object.freeze({
    name: 'PDF',
    title: 'PDF',
    description: 'Open, read, and edit PDF files instantly in your browser.',
  }),
});

export const TOOL_OPERATION_ORDER = Object.freeze(
  Object.keys(TOOL_OPERATION_TAXONOMY),
);
