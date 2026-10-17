// The share images (og:image and twitter:image) pages send, one per page
// family. Each is a static 1200x630 PNG under public/og/, drawn from this list
// by `node scripts/share-images.mjs`; lib/metadata.ts picks a page's image and
// share-images.test.mjs checks every file is there at this size. Change a
// title or subtitle here, then rerun the script and commit the PNGs.

export const SHARE_IMAGE_WIDTH = 1200;
export const SHARE_IMAGE_HEIGHT = 630;

export type ShareImageDesign = {
  // Served from public/, so the path is the URL path.
  path: string;
  title: string;
  subtitle: string;
  chips: readonly string[];
  accent: string;
};

export const SHARE_IMAGES = {
  // The homepage, /categories/, /brands/ and pages without a family of their own.
  default: {
    path: "/og/default.png",
    title: "Free online file tools",
    subtitle: "Convert, compress and download images, audio, video, documents and data.",
    chips: ["Convert", "Compress", "Download"],
    accent: "#1d4ed8",
  },
  // Converter Tools, table converters and the Convert category.
  convert: {
    path: "/og/convert.png",
    title: "File converters",
    subtitle: "Change images, audio, video, documents and data into the format you need.",
    chips: ["PNG → JPG", "MP4 → MP3", "HEIC → JPG", "PDF → PNG"],
    accent: "#2563eb",
  },
  // Compressor Tools, the Batch PNG Compressor, and the Compress and Bulk
  // categories.
  compress: {
    path: "/og/compress.png",
    title: "File compressors",
    subtitle: "Make image, audio and video files smaller.",
    chips: ["MP4", "MOV", "JPG", "PNG", "MP3"],
    accent: "#15803d",
  },
  // Downloader Landers and the Downloaders category.
  download: {
    path: "/og/download.png",
    title: "Video downloaders",
    subtitle: "Paste a public video link and save the video to your device.",
    chips: [],
    accent: "#7c3aed",
  },
  // The PDF readers and editors, and their categories.
  pdf: {
    path: "/og/pdf.png",
    title: "PDF reader and editor",
    subtitle: "Open, read and annotate PDF files, then download a copy.",
    chips: ["Read", "Annotate", "Download"],
    accent: "#b91c1c",
  },
} as const satisfies Record<string, ShareImageDesign>;

export type ShareImageName = keyof typeof SHARE_IMAGES;
