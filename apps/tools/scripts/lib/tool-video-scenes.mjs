// HTML for the still parts of a Tool video (issue #366), each screenshotted by
// scripts/tool-video.mjs: the title and closing cards, the browser window the
// recording is framed in, the caption strips, the thumbnail, and the demo
// photos the videos convert. Everything is drawn here, so the videos use no
// one else's images.

export const FRAME = { width: 1920, height: 1080 };
// Where the recorded page sits inside the browser window frame.
export const WINDOW = { x: 80, y: 56, width: 1760, height: 968, bar: 72 };
export const CONTENT = { x: WINDOW.x, y: WINDOW.y + WINDOW.bar, width: WINDOW.width, height: WINDOW.height - WINDOW.bar };

const BRAND = "#e5484d";
const FONT = `-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", Arial, sans-serif`;

function escape(text) {
  return String(text).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
}

function page(width, height, body, style = "") {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; margin: 0; }
    html, body { width: ${width}px; height: ${height}px; overflow: hidden; font-family: ${FONT}; }
    .backdrop { position: absolute; inset: 0; background: radial-gradient(circle at 20% 15%, #fff1f0 0%, #ffe4e1 35%, #fbd0cc 100%); }
    .chip { display: inline-flex; align-items: center; justify-content: center; border-radius: 28px; font-weight: 800; letter-spacing: -0.02em; }
    ${style}
  </style></head><body>${body}</body></html>`;
}

function formatChips(fromName, toName, size) {
  const chip = (name, filled) =>
    `<span class="chip" style="height:${size * 1.6}px;padding:0 ${size * 0.55}px;font-size:${size}px;${
      filled ? `background:${BRAND};color:#fff` : `background:#fff;color:#1f1f1f;border:4px solid #1f1f1f1a`
    }">${escape(name)}</span>`;
  if (!toName) return chip(fromName, true);
  return `${chip(fromName, false)}<span style="font-size:${size}px;font-weight:800;color:${BRAND};margin:0 ${size * 0.4}px">→</span>${chip(toName, true)}`;
}

export function titleCard({ heading, fromName, toName, subline }) {
  return page(
    FRAME.width,
    FRAME.height,
    `<div class="backdrop"></div>
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:56px">
      <div style="display:flex;align-items:center">${formatChips(fromName, toName, 88)}</div>
      <h1 style="font-size:92px;font-weight:800;letter-spacing:-0.035em;color:#141414;text-align:center;max-width:1600px;line-height:1.05">${escape(heading)}</h1>
      <p style="font-size:40px;color:#4a4a4a;font-weight:500">${escape(subline)}</p>
    </div>
    <div style="position:absolute;left:0;right:0;top:64px;text-align:center;font-size:34px;font-weight:700;color:#141414">SERP <span style="color:${BRAND}">Tools</span></div>`,
  );
}

export function closingCard({ url, line }) {
  return page(
    FRAME.width,
    FRAME.height,
    `<div class="backdrop"></div>
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:48px">
      <p style="font-size:48px;color:#4a4a4a;font-weight:600">${escape(line)}</p>
      <div style="background:#fff;border-radius:999px;padding:36px 72px;box-shadow:0 30px 80px #e5484d33;font-size:76px;font-weight:800;letter-spacing:-0.03em;color:#141414">${escape(url)}</div>
      <p style="font-size:40px;color:#4a4a4a">Free · No upload · No sign-up</p>
    </div>`,
  );
}

// The backdrop and an empty browser window, drawn under the recording.
export function windowFrame({ url }) {
  const { x, y, width, height, bar } = WINDOW;
  const light = (color, left) =>
    `<span style="position:absolute;left:${left}px;top:${bar / 2 - 9}px;width:18px;height:18px;border-radius:50%;background:${color}"></span>`;
  return page(
    FRAME.width,
    FRAME.height,
    `<div class="backdrop"></div>
    <div style="position:absolute;left:${x}px;top:${y}px;width:${width}px;height:${height}px;border-radius:18px;background:#fff;box-shadow:0 40px 120px #00000026, 0 0 0 1px #00000014;overflow:hidden">
      <div style="position:absolute;left:0;top:0;right:0;height:${bar}px;background:#f3f3f4;border-bottom:1px solid #00000014">
        ${light("#ff5f57", 28)}${light("#febc2e", 58)}${light("#28c840", 88)}
        <div style="position:absolute;left:220px;right:220px;top:14px;height:${bar - 28}px;border-radius:999px;background:#fff;border:1px solid #0000001a;display:flex;align-items:center;justify-content:center;gap:12px;font-size:24px;color:#333">
          <svg width="18" height="22" viewBox="0 0 18 22"><rect x="2" y="9" width="14" height="12" rx="2" fill="#6b6b6b"/><path d="M5 9V6a4 4 0 0 1 8 0v3" stroke="#6b6b6b" stroke-width="2.4" fill="none"/></svg>
          ${escape(url)}
        </div>
      </div>
    </div>`,
  );
}

// One caption line on a transparent strip, overlaid near the bottom.
export const CAPTION = { width: 1920, height: 120, y: 950 };
export function captionStrip(text) {
  return page(
    CAPTION.width,
    CAPTION.height,
    `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center">
      <span style="background:#141414e6;color:#fff;font-size:40px;font-weight:600;padding:14px 30px;border-radius:14px;max-width:1700px;text-align:center;line-height:1.25">${escape(text)}</span>
    </div>`,
    "html, body { background: transparent; }",
  );
}

export function thumbnail({ fromName, toName, verb }) {
  return page(
    1280,
    720,
    `<div class="backdrop"></div>
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:40px">
      <div style="font-size:64px;font-weight:800;color:#141414;letter-spacing:-0.03em;text-transform:uppercase">${escape(verb)}</div>
      <div style="display:flex;align-items:center">${formatChips(fromName, toName, 120)}</div>
      <div style="font-size:44px;font-weight:700;color:#141414">Free · In your browser</div>
    </div>`,
  );
}

// A made-up landscape, drawn as a "photo" for the image Tools to convert.
export function demoPhoto({ width, height, hue = 18 }) {
  return page(
    width,
    height,
    `<svg width="${width}" height="${height}" viewBox="0 0 1600 1200" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="hsl(${hue + 200},70%,62%)"/><stop offset="0.6" stop-color="hsl(${hue + 10},90%,76%)"/><stop offset="1" stop-color="hsl(${hue},95%,70%)"/>
        </linearGradient>
        <radialGradient id="sun"><stop offset="0" stop-color="#fffbe6"/><stop offset="1" stop-color="#ffd27a" stop-opacity="0"/></radialGradient>
        <linearGradient id="lake" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue + 190},45%,45%)"/><stop offset="1" stop-color="hsl(${hue + 210},55%,22%)"/></linearGradient>
        <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4"/><feColorMatrix values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0.08 0"/></filter>
      </defs>
      <rect width="1600" height="1200" fill="url(#sky)"/>
      <circle cx="1110" cy="430" r="260" fill="url(#sun)"/><circle cx="1110" cy="430" r="78" fill="#fff6d8"/>
      <path d="M0 640 L220 430 L360 540 L560 300 L760 560 L900 470 L1100 640 Z" fill="hsl(${hue + 230},25%,38%)"/>
      <path d="M520 660 L760 400 L900 520 L1060 360 L1300 600 L1450 480 L1600 620 L1600 700 L520 700 Z" fill="hsl(${hue + 235},22%,30%)"/>
      <path d="M0 700 C 300 640, 600 720, 900 680 S 1400 660, 1600 700 L1600 1200 L0 1200 Z" fill="url(#lake)"/>
      <ellipse cx="1110" cy="760" rx="60" ry="200" fill="#fff6d8" opacity="0.25"/>
      <path d="M0 980 C 200 900, 420 960, 620 1000 S 1000 1080, 1600 960 L1600 1200 L0 1200 Z" fill="hsl(${hue + 120},30%,16%)"/>
      ${Array.from({ length: 14 }, (_, i) => {
        const tx = 40 + i * 118 + (i % 3) * 20;
        const th = 140 + ((i * 53) % 90);
        return `<path d="M${tx} ${1040 - th} L${tx - 34} ${1040} L${tx + 34} ${1040} Z" fill="hsl(${hue + 130},35%,12%)"/>`;
      }).join("")}
      <rect width="1600" height="1200" filter="url(#grain)"/>
    </svg>`,
  );
}
