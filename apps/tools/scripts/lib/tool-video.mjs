// Tool videos (issue #366): the pure parts of scripts/tool-video.mjs. A video
// is a list of beats, each one narrated line with the on-screen action it
// covers. The first and last beats are cards; the rest are recorded on the
// Tool's page. Narration is written twice: `say` for the voice (spelled the way
// it should be spoken) and `caption` for the screen.

export const SITE = "tools.serp.co";
export const CHAPTER_MIN_SECONDS = 10;

const NOUNS = { image: "image", video: "video", audio: "audio file", document: "document" };

function list(items, conjunction = "or") {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${conjunction} ${items.at(-1)}`;
}

// "Any web browser" reads as "any web browser" mid-sentence.
function lower(text) {
  return /^Any\b/.test(text) ? text[0].toLowerCase() + text.slice(1) : text;
}

// "jpg-to-png" → "JPG to PNG": slugs are read out by their format names.
export function spokenRoute(route, formats = {}) {
  return route
    .replace(/^\/|\/$/g, "")
    .split("-")
    .map((word) => formats[word]?.name ?? word)
    .join(" ");
}

export function pageUrl(tool) {
  return `https://${SITE}${tool.route.replace(/\/?$/, "/")}`;
}

// A byte count as said aloud and as shown: 4.2 MB, "4.2 megabytes".
export function formatBytes(bytes) {
  if (bytes >= 1_000_000) {
    const value = (bytes / 1_000_000).toFixed(1);
    return { caption: `${value} MB`, say: `${value} megabytes` };
  }
  const value = Math.max(1, Math.round(bytes / 1000));
  return { caption: `${value} KB`, say: `${value} kilobytes` };
}

// The beats of one Tool's video. `result` is what the recorded run produced
// ({ inputBytes, outputBytes, outputName }); beats that need it are functions
// of it, filled in once the run finishes (see resolveBeat).
export function buildScript(tool, formats) {
  const from = formats[tool.from];
  const to = formats[tool.to];
  if (!from || !to) throw new Error(`${tool.id}: no shared description for ${tool.from} or ${tool.to}`);
  const compress = tool.operation === "compress";
  const noun = NOUNS[from.kind] ?? "file";
  const routeSay = `tools dot serp dot co slash ${spokenRoute(tool.route, formats)}`;
  const routeCaption = `${SITE}${tool.route.replace(/\/$/, "")}`;
  const verb = compress ? "compress" : "convert";
  const task = compress ? `compress ${article(from.name)} ${from.name}` : `convert ${from.name} to ${to.name}`;

  return [
    {
      id: "intro",
      kind: "card",
      chapter: "Intro",
      say: `Here's how to ${task}, for free, right in your browser.`,
    },
    {
      id: "open",
      kind: "page",
      chapter: "Open the tool",
      say: `First, open ${routeSay}.`,
      caption: `First, open ${routeCaption}.`,
    },
    {
      id: "upload",
      kind: "page",
      chapter: "Add your file",
      say: `Drag your ${from.name} ${noun} onto the page, or click Choose Files.`,
    },
    {
      id: "convert",
      kind: "page",
      chapter: compress ? "Compress" : "Convert",
      say: `It starts to ${verb} right away, and it all happens in your browser, so your ${noun} is never uploaded.`,
    },
    {
      id: "download",
      kind: "page",
      chapter: "Download",
      say: compress
        ? (result) => {
            const before = formatBytes(result.inputBytes);
            const after = formatBytes(result.outputBytes);
            return {
              say: `When it's done, the smaller file downloads automatically. This one went from ${before.say} to ${after.say}.`,
              caption: `When it's done, the smaller file downloads automatically. This one went from ${before.caption} to ${after.caption}.`,
            };
          }
        : `When it's done, your ${to.name} downloads automatically.`,
    },
    {
      id: "result",
      kind: "page",
      chapter: "The result",
      say: `Open it, and there's your ${to.name}, with ${list(to.properties.slice(0, 2), "and")}. It opens in ${list(to.openWith.slice(0, 3).map(lower))}.`,
    },
    {
      id: "more",
      kind: "page",
      chapter: "Learn more",
      say: `Scroll down to compare formats and read answers to common questions.`,
    },
    {
      id: "outro",
      kind: "card",
      chapter: "Outro",
      say: `That's it. ${capitalize(task)} free at ${routeSay}. Thanks for watching!`,
      caption: `That's it. ${capitalize(task)} free at ${routeCaption}. Thanks for watching!`,
    },
  ];
}

function article(word) {
  return /^[AEFHILMNORSX]/.test(word) ? "an" : "a";
}

function capitalize(text) {
  return text[0].toUpperCase() + text.slice(1);
}

// A beat's spoken and shown lines, once any run result it needs is known.
export function resolveBeat(beat, result) {
  const line = typeof beat.say === "function" ? beat.say(result) : { say: beat.say, caption: beat.caption };
  return { ...beat, say: line.say, caption: line.caption ?? line.say };
}

// Splits a caption into chunks of at most `maxWords` words, breaking after
// punctuation where it can, and times them over [start, end] by word count.
export function captionChunks(text, start, end, maxWords = 8) {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks = [];
  let current = [];
  for (const word of words) {
    current.push(word);
    const breakHere = current.length >= maxWords || (current.length >= 4 && /[.,!?]$/.test(word));
    if (breakHere) {
      chunks.push(current);
      current = [];
    }
  }
  if (current.length) chunks.push(current);
  const perWord = (end - start) / words.length;
  let at = start;
  return chunks.map((chunk) => {
    const chunkStart = at;
    at += chunk.length * perWord;
    return { start: chunkStart, end: at, text: chunk.join(" ") };
  });
}

function srtTime(seconds) {
  const ms = Math.round(seconds * 1000);
  const pad = (value, size = 2) => String(value).padStart(size, "0");
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
}

export function toSrt(chunks) {
  return chunks.map((chunk, index) => `${index + 1}\n${srtTime(chunk.start)} --> ${srtTime(chunk.end)}\n${chunk.text}\n`).join("\n");
}

// YouTube chapters: the first at 0:00, each at least 10 s, so short beats
// merge into the chapter before them. Returns [] when fewer than three fit.
export function chapters(timeline, duration) {
  const merged = [];
  for (const beat of timeline) {
    const last = merged.at(-1);
    if (last && beat.start - last.start < CHAPTER_MIN_SECONDS) continue;
    merged.push({ start: merged.length ? beat.start : 0, title: beat.chapter });
  }
  while (merged.length > 1 && duration - merged.at(-1).start < CHAPTER_MIN_SECONDS) merged.pop();
  return merged.length >= 3 ? merged : [];
}

function clock(seconds) {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export function youtubeMetadata(tool, formats, { timeline, duration }) {
  const from = formats[tool.from];
  const to = formats[tool.to];
  const compress = tool.operation === "compress";
  const title = compress
    ? `How to Compress ${article(from.name)} ${from.name} (Free, No Upload)`
    : `How to Convert ${from.name} to ${to.name} (Free, No Upload)`;
  const marks = chapters(timeline, duration);
  const description = [
    compress
      ? `Compress ${from.name} files for free, right in your browser: ${pageUrl(tool)}`
      : `Convert ${from.name} to ${to.name} for free, right in your browser: ${pageUrl(tool)}`,
    "",
    "Your files never leave your device: there's no upload, no sign-up and no watermark.",
    "",
    ...(marks.length ? ["Chapters", ...marks.map((mark) => `${clock(mark.start)} ${mark.title}`), ""] : []),
    `More free tools: https://${SITE}/`,
  ].join("\n");
  const tags = compress
    ? [`compress ${from.name}`, `${from.name} compressor`, `reduce ${from.name} size`, "free online tool"]
    : [`${from.name} to ${to.name}`, `convert ${from.name} to ${to.name}`, `${from.name} to ${to.name} converter`, "free online converter"];
  return { title, description, tags: tags.map((tag) => tag.toLowerCase()), chapters: marks, url: pageUrl(tool) };
}
