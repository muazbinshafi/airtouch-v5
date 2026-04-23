// BrowserCursor - drives a floating in-page cursor + dispatches real DOM
// pointer events from gesture telemetry. This is what makes the website-only
// demo "fully functional" without any local bridge.
//
// We deliberately bypass React for the per-frame render: a single overlay
// element is mutated in place inside an rAF loop.

import { TelemetryStore, type GestureKind } from "./TelemetryStore";

export type CursorMode = "off" | "pointer" | "draw";

interface DrawSegment {
  x: number;
  y: number;
}

export class BrowserCursor {
  private root: HTMLDivElement;
  private dot: HTMLDivElement;
  private ring: HTMLDivElement;
  private label: HTMLDivElement;
  private drawCanvas: HTMLCanvasElement;
  private drawCtx: CanvasRenderingContext2D | null;

  private mode: CursorMode = "pointer";
  private lastGesture: GestureKind = "none";
  private lastTarget: Element | null = null;
  private isDown = false;
  private rafId = 0;
  private unsub: (() => void) | null = null;
  private lastClickAt = 0;
  private lastRightClickAt = 0;
  private lastScrollAt = 0;
  private lastDrawPt: DrawSegment | null = null;
  private accentColor = "var(--primary)";

  // Pull cursor from the active SensorPanel video rect so XY maps to the
  // visible camera frame the user sees. Falls back to viewport.
  private targetSelector = "#omnipoint-video";

  constructor() {
    this.root = document.createElement("div");
    this.root.className = "op-browser-cursor-root";
    this.root.setAttribute("aria-hidden", "true");
    Object.assign(this.root.style, {
      position: "fixed",
      inset: "0",
      pointerEvents: "none",
      zIndex: "2147483646",
    } as CSSStyleDeclaration);

    this.drawCanvas = document.createElement("canvas");
    Object.assign(this.drawCanvas.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      pointerEvents: "none",
      opacity: "0.85",
    } as CSSStyleDeclaration);
    this.drawCtx = this.drawCanvas.getContext("2d");

    this.ring = document.createElement("div");
    Object.assign(this.ring.style, {
      position: "absolute",
      width: "44px",
      height: "44px",
      marginLeft: "-22px",
      marginTop: "-22px",
      borderRadius: "9999px",
      border: "2px solid hsl(var(--primary))",
      boxShadow:
        "0 0 0 2px hsl(var(--background) / 0.6), 0 0 18px hsl(var(--primary) / 0.55)",
      transition: "transform 90ms ease-out, background-color 120ms ease-out, opacity 120ms ease-out",
      transform: "translate3d(0,0,0) scale(1)",
      backgroundColor: "hsl(var(--primary) / 0.10)",
      willChange: "transform, background-color",
    } as CSSStyleDeclaration);

    this.dot = document.createElement("div");
    Object.assign(this.dot.style, {
      position: "absolute",
      width: "8px",
      height: "8px",
      marginLeft: "-4px",
      marginTop: "-4px",
      borderRadius: "9999px",
      backgroundColor: "hsl(var(--primary))",
      boxShadow: "0 0 10px hsl(var(--primary) / 0.85)",
      transform: "translate3d(0,0,0)",
      willChange: "transform",
    } as CSSStyleDeclaration);

    this.label = document.createElement("div");
    Object.assign(this.label.style, {
      position: "absolute",
      transform: "translate3d(0,0,0)",
      marginLeft: "28px",
      marginTop: "-10px",
      fontFamily: "ui-monospace, 'JetBrains Mono', monospace",
      fontSize: "10px",
      letterSpacing: "0.18em",
      padding: "2px 6px",
      borderRadius: "4px",
      color: "hsl(var(--primary-foreground))",
      backgroundColor: "hsl(var(--primary) / 0.92)",
      boxShadow: "0 4px 14px hsl(var(--primary) / 0.35)",
      whiteSpace: "nowrap",
      textTransform: "uppercase",
      opacity: "0",
      transition: "opacity 120ms ease-out",
      willChange: "transform, opacity",
    } as CSSStyleDeclaration);

    this.root.appendChild(this.drawCanvas);
    this.root.appendChild(this.ring);
    this.root.appendChild(this.dot);
    this.root.appendChild(this.label);
  }

  attach() {
    if (!this.root.isConnected) document.body.appendChild(this.root);
    this.resizeCanvas();
    window.addEventListener("resize", this.resizeCanvas);
    this.unsub = TelemetryStore.subscribe(() => {/* no-op, polled in raf */});
    this.loop();
  }

  detach() {
    cancelAnimationFrame(this.rafId);
    window.removeEventListener("resize", this.resizeCanvas);
    this.unsub?.();
    this.unsub = null;
    if (this.isDown) {
      this.dispatchUp(this.lastTarget);
      this.isDown = false;
    }
    this.lastTarget = null;
    if (this.root.isConnected) this.root.remove();
  }

  setMode(mode: CursorMode) {
    this.mode = mode;
    this.root.style.display = mode === "off" ? "none" : "block";
    if (mode !== "draw") this.lastDrawPt = null;
    if (mode === "off" && this.isDown) {
      this.dispatchUp(this.lastTarget);
      this.isDown = false;
    }
  }

  clearDrawing() {
    if (!this.drawCtx) return;
    this.drawCtx.clearRect(0, 0, this.drawCanvas.width, this.drawCanvas.height);
    this.lastDrawPt = null;
  }

  private resizeCanvas = () => {
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    this.drawCanvas.width = Math.floor(window.innerWidth * dpr);
    this.drawCanvas.height = Math.floor(window.innerHeight * dpr);
    if (this.drawCtx) {
      this.drawCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.drawCtx.lineCap = "round";
      this.drawCtx.lineJoin = "round";
    }
  };

  private resolveScreenXY(nx: number, ny: number): { x: number; y: number } {
    // The gesture engine yields normalized [0..1] coordinates inside the
    // active zone of the camera frame. Map into the on-screen video rect so
    // the cursor visually tracks the user's hand. If no video element is
    // visible (e.g. user scrolled away), fall back to the full viewport.
    const target = document.querySelector(this.targetSelector) as HTMLElement | null;
    const rect = target?.getBoundingClientRect();
    if (rect && rect.width > 4 && rect.height > 4 && rect.bottom > 0 && rect.right > 0) {
      // Expand mapping to the full viewport so the cursor can reach UI
      // outside the camera tile, while still being centred on the camera
      // origin. We blend: 60% camera-rect mapping, 40% full-viewport.
      const camX = rect.left + nx * rect.width;
      const camY = rect.top + ny * rect.height;
      const vpX = nx * window.innerWidth;
      const vpY = ny * window.innerHeight;
      return { x: camX * 0.55 + vpX * 0.45, y: camY * 0.55 + vpY * 0.45 };
    }
    return { x: nx * window.innerWidth, y: ny * window.innerHeight };
  }

  private hitTest(x: number, y: number): Element | null {
    // Temporarily hide the overlay so elementFromPoint sees what's underneath.
    const prev = this.root.style.display;
    this.root.style.display = "none";
    const el = document.elementFromPoint(x, y);
    this.root.style.display = prev;
    return el;
  }

  private dispatchMove(target: Element | null, x: number, y: number) {
    if (!target) return;
    const init: PointerEventInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: x,
      clientY: y,
      pointerType: "mouse",
      pointerId: 1,
      isPrimary: true,
      button: -1,
      buttons: this.isDown ? 1 : 0,
    };
    if (target !== this.lastTarget) {
      if (this.lastTarget) {
        this.lastTarget.dispatchEvent(new PointerEvent("pointerout", init));
        this.lastTarget.dispatchEvent(new MouseEvent("mouseout", init));
        this.lastTarget.dispatchEvent(new PointerEvent("pointerleave", init));
        this.lastTarget.dispatchEvent(new MouseEvent("mouseleave", init));
      }
      target.dispatchEvent(new PointerEvent("pointerover", init));
      target.dispatchEvent(new MouseEvent("mouseover", init));
      target.dispatchEvent(new PointerEvent("pointerenter", init));
      target.dispatchEvent(new MouseEvent("mouseenter", init));
      this.lastTarget = target;
    }
    target.dispatchEvent(new PointerEvent("pointermove", init));
    target.dispatchEvent(new MouseEvent("mousemove", init));
  }

  private dispatchDown(target: Element | null, x: number, y: number) {
    if (!target) return;
    const init: PointerEventInit = {
      bubbles: true, cancelable: true, composed: true,
      clientX: x, clientY: y, pointerType: "mouse",
      pointerId: 1, isPrimary: true, button: 0, buttons: 1,
    };
    target.dispatchEvent(new PointerEvent("pointerdown", init));
    target.dispatchEvent(new MouseEvent("mousedown", init));
    if (target instanceof HTMLElement) target.focus({ preventScroll: true });
  }

  private dispatchUp(target: Element | null) {
    if (!target) return;
    const init: PointerEventInit = {
      bubbles: true, cancelable: true, composed: true,
      pointerType: "mouse", pointerId: 1, isPrimary: true,
      button: 0, buttons: 0,
    };
    target.dispatchEvent(new PointerEvent("pointerup", init));
    target.dispatchEvent(new MouseEvent("mouseup", init));
  }

  private dispatchClick(target: Element | null, x: number, y: number) {
    if (!target) return;
    const init: MouseEventInit = {
      bubbles: true, cancelable: true, composed: true,
      clientX: x, clientY: y, button: 0, buttons: 0,
      view: window,
    };
    target.dispatchEvent(new MouseEvent("click", init));
    // If the target is actually a label/button-ish that needs a real .click()
    // (e.g. <a> navigation), also call the native helper.
    if (target instanceof HTMLElement) {
      try { target.click(); } catch { /* noop */ }
    }
  }

  private dispatchContextMenu(target: Element | null, x: number, y: number) {
    if (!target) return;
    target.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true, cancelable: true, composed: true,
        clientX: x, clientY: y, button: 2, buttons: 0, view: window,
      }),
    );
  }

  private dispatchWheel(target: Element | null, x: number, y: number, deltaY: number) {
    const node = target ?? document.elementFromPoint(x, y);
    if (!node) return;
    // Bubble a wheel event for any custom scrollers (carousels etc).
    node.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true, cancelable: true, composed: true,
        clientX: x, clientY: y, deltaX: 0, deltaY, deltaMode: 0,
      }),
    );
    // Native scroll: walk up to find a scrollable ancestor and scroll it.
    let el: Element | null = node;
    while (el && el !== document.body) {
      if (el instanceof HTMLElement) {
        const style = getComputedStyle(el);
        const oy = style.overflowY;
        if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight) {
          el.scrollTop += deltaY;
          return;
        }
      }
      el = el.parentElement;
    }
    window.scrollBy({ top: deltaY, behavior: "auto" });
  }

  private drawTo(x: number, y: number) {
    if (!this.drawCtx) return;
    const ctx = this.drawCtx;
    ctx.strokeStyle = `hsl(var(--primary))`;
    ctx.lineWidth = 3;
    if (this.lastDrawPt) {
      ctx.beginPath();
      ctx.moveTo(this.lastDrawPt.x, this.lastDrawPt.y);
      ctx.lineTo(x, y);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(x, y, 1.5, 0, Math.PI * 2);
      ctx.fillStyle = `hsl(var(--primary))`;
      ctx.fill();
    }
    this.lastDrawPt = { x, y };
    void this.accentColor;
  }

  private setLabel(text: string) {
    if (this.label.textContent !== text) this.label.textContent = text;
    this.label.style.opacity = text ? "1" : "0";
  }

  private setRingState(gesture: GestureKind) {
    let bg = "hsl(var(--primary) / 0.10)";
    let scale = 1;
    if (this.isDown) { bg = "hsl(var(--primary) / 0.45)"; scale = 0.85; }
    else if (gesture === "click") { bg = "hsl(var(--primary) / 0.55)"; scale = 0.7; }
    else if (gesture === "right_click") { bg = "hsl(var(--destructive) / 0.45)"; scale = 0.85; }
    else if (gesture === "drag") { bg = "hsl(var(--primary) / 0.5)"; scale = 0.85; }
    else if (gesture === "fist") { bg = "hsl(var(--muted) / 0.4)"; scale = 1.1; }
    else if (gesture === "open_palm") { bg = "hsl(var(--accent) / 0.30)"; scale = 1.25; }
    this.ring.style.backgroundColor = bg;
    this.ring.style.transform = `translate3d(0,0,0) scale(${scale})`;
  }

  private loop = () => {
    this.rafId = requestAnimationFrame(this.loop);
    if (this.mode === "off") return;
    const snap = TelemetryStore.get();
    if (!snap.initialized) {
      this.setLabel("");
      return;
    }
    const { x, y } = this.resolveScreenXY(snap.cursorX, snap.cursorY);
    this.ring.style.left = `${x}px`;
    this.ring.style.top = `${y}px`;
    this.dot.style.left = `${x}px`;
    this.dot.style.top = `${y}px`;
    this.label.style.left = `${x}px`;
    this.label.style.top = `${y}px`;

    const g = snap.gesture;
    this.setRingState(g);

    if (this.mode === "draw") {
      // In draw mode any pinch / drag paints, open palm clears.
      if (g === "click" || g === "drag" || snap.pinchDistance < 0.05) {
        this.drawTo(x, y);
      } else if (g === "open_palm") {
        this.clearDrawing();
      } else {
        this.lastDrawPt = null;
      }
      this.setLabel(g === "open_palm" ? "CLEAR" : g === "drag" || g === "click" ? "DRAW" : "DRAW MODE");
      this.lastGesture = g;
      return;
    }

    // Pointer mode — drive real DOM events
    const target = this.hitTest(x, y);
    this.dispatchMove(target, x, y);

    const now = performance.now();
    const transitionedTo = (k: GestureKind) => g === k && this.lastGesture !== k;

    // Drag — press on enter, release on leave
    if (g === "drag" && !this.isDown) {
      this.dispatchDown(target, x, y);
      this.isDown = true;
      this.setLabel("DRAG");
    } else if (this.isDown && g !== "drag") {
      this.dispatchUp(target);
      this.dispatchClick(target, x, y); // treat drag-release as a click on the drop target
      this.isDown = false;
    }

    if (transitionedTo("click") && now - this.lastClickAt > 220 && !this.isDown) {
      this.dispatchDown(target, x, y);
      this.dispatchUp(target);
      this.dispatchClick(target, x, y);
      this.lastClickAt = now;
      this.setLabel("CLICK");
    } else if (transitionedTo("right_click") && now - this.lastRightClickAt > 320) {
      this.dispatchContextMenu(target, x, y);
      this.lastRightClickAt = now;
      this.setLabel("RIGHT");
    } else if ((g === "scroll_up" || g === "scroll_down") && now - this.lastScrollAt > 16) {
      const delta = g === "scroll_up" ? -60 : 60;
      this.dispatchWheel(target, x, y, delta);
      this.lastScrollAt = now;
      this.setLabel(g === "scroll_up" ? "SCROLL ↑" : "SCROLL ↓");
    } else if (g === "open_palm") {
      this.setLabel("HOVER");
    } else if (g === "fist") {
      this.setLabel("HOLD");
    } else if (g === "point") {
      this.setLabel("");
    } else if (g === "thumbs_up") {
      this.setLabel("OK");
    } else if (g === "none") {
      this.setLabel("");
    }

    this.lastGesture = g;
  };
}
