// The props a Tool video draws over the real page (issue #366): a cursor, the
// file dragged in from the desktop, the browser's download bubble and the
// window the result opens in. installStage() runs in the page; it must not use
// anything from this module's scope.

export function installStage() {
  const doc = globalThis.document;
  if (doc.getElementById("__stage")) return;
  const root = doc.createElement("div");
  root.id = "__stage";
  root.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif";
  root.innerHTML = `
    <style>
      #__stage .ease { transition-property: transform, opacity; transition-timing-function: cubic-bezier(.45,.05,.25,1); }
      #__stage .ripple { position:absolute; width:44px; height:44px; margin:-22px 0 0 -22px; border-radius:50%; background:#e5484d55; animation: __ripple .5s ease-out forwards; }
      @keyframes __ripple { from { transform: scale(.3); opacity: 1 } to { transform: scale(1.6); opacity: 0 } }
      @keyframes __bars { 0%,100% { transform: scaleY(.35) } 50% { transform: scaleY(1) } }
      @keyframes __pop { from { transform: translateY(-10px) scale(.96); opacity: 0 } to { transform: none; opacity: 1 } }
    </style>
    <div id="__file" class="ease" style="position:absolute;left:0;top:0;opacity:0;display:flex;flex-direction:column;align-items:center;gap:6px;width:120px"></div>
    <svg id="__cursor" class="ease" width="26" height="34" viewBox="0 0 26 34" style="position:absolute;left:0;top:0;opacity:0;filter:drop-shadow(0 2px 3px #0005)">
      <path d="M2 2 L2 27 L8.5 21 L13 31.5 L17.5 29.5 L13 19.5 L22 19.5 Z" fill="#111" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>
    </svg>`;
  doc.documentElement.appendChild(root);
  const cursor = root.querySelector("#__cursor");
  const file = root.querySelector("#__file");
  const at = { x: 640, y: 420 };

  function place(element, x, y, ms) {
    element.style.transitionDuration = `${ms}ms`;
    element.style.transform = `translate(${x}px, ${y}px)`;
  }

  globalThis.__stage = {
    show(x, y) {
      at.x = x;
      at.y = y;
      place(cursor, x, y, 0);
      cursor.style.opacity = "1";
    },
    move(x, y, ms) {
      at.x = x;
      at.y = y;
      place(cursor, x, y, ms);
      place(file, x - 30, y + 18, ms);
    },
    click() {
      const ripple = doc.createElement("div");
      ripple.className = "ripple";
      ripple.style.left = `${at.x + 3}px`;
      ripple.style.top = `${at.y + 3}px`;
      root.appendChild(ripple);
      setTimeout(() => ripple.remove(), 600);
    },
    // A file icon carried under the cursor: its thumbnail, or a badge with
    // its extension.
    pickUp({ name, extension, thumbnail }) {
      const art = thumbnail
        ? `<img src="${thumbnail}" style="width:96px;height:72px;object-fit:cover;border-radius:6px;border:3px solid #fff;box-shadow:0 6px 18px #0004">`
        : `<div style="width:72px;height:90px;border-radius:8px;background:#fff;box-shadow:0 6px 18px #0004;display:flex;align-items:flex-end;justify-content:center;padding-bottom:10px"><span style="background:#e5484d;color:#fff;font-weight:700;font-size:13px;padding:2px 6px;border-radius:4px">${extension}</span></div>`;
      file.innerHTML = `${art}<span style="background:#2563eb;color:#fff;font-size:12px;font-weight:600;padding:2px 8px;border-radius:5px;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${name}</span>`;
      place(file, at.x - 30, at.y + 18, 0);
      file.style.opacity = "0.95";
    },
    drop() {
      file.style.transitionDuration = "250ms";
      file.style.opacity = "0";
    },
    highlight(selector, on) {
      const target = doc.querySelector(selector);
      if (!target) return;
      target.style.transition = "transform .25s, box-shadow .25s";
      target.style.transform = on ? "scale(1.01)" : "";
      target.style.boxShadow = on ? "0 0 0 6px #e5484d33" : "";
    },
    // The browser's download bubble, top right, as Chrome shows it.
    downloaded({ name, size }) {
      const bubble = doc.createElement("div");
      bubble.id = "__bubble";
      bubble.style.cssText = "position:absolute;right:16px;top:12px;width:340px;background:#fff;border-radius:14px;box-shadow:0 12px 40px #0003,0 0 0 1px #0000000f;padding:14px 16px;animation:__pop .3s ease-out";
      bubble.innerHTML = `
        <div style="font-size:13px;font-weight:600;color:#444;margin-bottom:10px">Recent download history</div>
        <div id="__bubble-row" style="display:flex;align-items:center;gap:12px;padding:8px;border-radius:10px">
          <div style="width:36px;height:36px;border-radius:8px;background:#e5484d1a;display:flex;align-items:center;justify-content:center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#e5484d" stroke-width="2.4" stroke-linecap="round"><path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 19h14"/></svg>
          </div>
          <div style="min-width:0"><div style="font-size:14px;font-weight:600;color:#111;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${name}</div>
          <div style="font-size:12.5px;color:#666">${size} • Done</div></div>
        </div>`;
      root.appendChild(bubble);
      const row = bubble.querySelector("#__bubble-row").getBoundingClientRect();
      return { x: row.left + row.width / 2, y: row.top + row.height / 2 };
    },
    hoverBubble(on) {
      const row = doc.getElementById("__bubble-row");
      if (row) row.style.background = on ? "#f1f1f3" : "";
    },
    closeBubble() {
      doc.getElementById("__bubble")?.remove();
    },
    // The window the result opens in: the image itself, or a player for audio.
    open({ name, kind, size }) {
      // The page revokes its own URL once the file is saved.
      const url = URL.createObjectURL(globalThis.__video.outputs[0].blob);
      const win = doc.createElement("div");
      win.id = "__viewer";
      win.style.cssText = "position:absolute;left:50%;top:50%;width:860px;height:560px;margin:-280px 0 0 -430px;background:#fff;border-radius:14px;box-shadow:0 30px 90px #0005,0 0 0 1px #0000001a;overflow:hidden;animation:__pop .35s ease-out";
      const lights = ["#ff5f57", "#febc2e", "#28c840"].map((color) => `<span style="width:13px;height:13px;border-radius:50%;background:${color};display:inline-block"></span>`).join("");
      const body =
        kind === "audio"
          ? `<div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:26px;background:linear-gradient(160deg,#fff1f0,#ffe0dc)">
              <div style="width:120px;height:120px;border-radius:24px;background:#e5484d;display:flex;align-items:center;justify-content:center;box-shadow:0 14px 40px #e5484d55">
                <svg width="60" height="60" viewBox="0 0 24 24" fill="#fff"><path d="M9 18V5l12-2v13" stroke="#fff" stroke-width="2" fill="none"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
              </div>
              <div style="font-size:22px;font-weight:700;color:#111">${name}</div>
              <div style="display:flex;gap:5px;align-items:center;height:60px">${Array.from({ length: 36 }, (_, i) => `<span style="width:6px;height:${20 + ((i * 37) % 40)}px;background:#e5484d;border-radius:3px;animation:__bars ${0.8 + (i % 5) * 0.15}s ease-in-out ${(i % 7) * 0.08}s infinite"></span>`).join("")}</div>
              <div style="font-size:14px;color:#666">${size}</div>
            </div>`
          : `<div style="height:100%;display:flex;align-items:center;justify-content:center;background:repeating-conic-gradient(#f2f2f2 0% 25%, #fff 0% 50%) 50% / 24px 24px">
              <img src="${url}" style="max-width:100%;max-height:100%;object-fit:contain">
            </div>`;
      win.innerHTML = `
        <div style="height:44px;background:#f3f3f4;border-bottom:1px solid #00000014;display:flex;align-items:center;padding:0 14px;gap:8px">
          ${lights}<span style="flex:1;text-align:center;font-size:14px;font-weight:600;color:#333;margin-right:56px">${name}</span>
        </div>
        <div style="height:calc(100% - 44px)">${body}</div>`;
      root.appendChild(win);
    },
    close() {
      doc.getElementById("__viewer")?.remove();
    },
  };
}
