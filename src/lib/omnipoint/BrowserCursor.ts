// BrowserCursor - drives a floating in-page cursor + dispatches real DOM
// pointer events from gesture telemetry. This is what makes the website-only
// demo "fully functional" without any local bridge.
//
// We deliberately bypass React for the per-frame render: a single overlay
// element is mutated in place inside an rAF loop.

import { TelemetryStore, type GestureKind } from "./TelemetryStore";
import { PaintStore, PaintHistory } from "./PaintStore";
import {
  GestureSettingsStore,
  isConfigurable,
  type GestureAction,
  type ConfigurableGesture,
} from "./GestureSettings";

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
  private lastBackAt = 0;
  private lastZoomAt = 0;
  private lastNextAt = 0;
  private lastDrawPt: DrawSegment | null = null;
  // Shape preview state — when drawing a shape we hold the start anchor
  // and a snapshot of the canvas to redraw the rubber-band on each frame.
  private shapeStart: DrawSegment | null = null;
  private shapeBase: ImageData | null = null;
  private accentColor = "var(--primary)";

  // Pose-hold buffer for higher accuracy on static gestures. Tracks the
  // currently-held configurable gesture, when it started, and when it last
  // fired (per gesture). A pose must be sustained for `holdMs` and clear
  // `cooldownMs` between fires.
  private poseHeld: ConfigurableGesture | null = null;
  private poseHeldSince = 0;
  private poseFiredAt: Partial<Record<ConfigurableGesture, number>> = {};

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

  private applyPenStyle() {
    if (!this.drawCtx) return;
    const { color, size, alpha, composite, tool } = PaintStore.get();
    const ctx = this.drawCtx;
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = composite;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = tool === "highlighter" ? Math.max(size, 14) : size;
  }

  private resetCtx() {
    if (!this.drawCtx) return;
    this.drawCtx.globalAlpha = 1;
    this.drawCtx.globalCompositeOperation = "source-over";
  }

  private snapshotCanvas(): ImageData | null {
    if (!this.drawCtx) return null;
    return this.drawCtx.getImageData(0, 0, this.drawCanvas.width, this.drawCanvas.height);
  }

  private restoreCanvas(img: ImageData | null) {
    if (!this.drawCtx || !img) return;
    this.drawCtx.putImageData(img, 0, 0);
  }

  private drawFreehand(x: number, y: number) {
    if (!this.drawCtx) return;
    const ctx = this.drawCtx;
    this.applyPenStyle();
    if (this.lastDrawPt) {
      ctx.beginPath();
      ctx.moveTo(this.lastDrawPt.x, this.lastDrawPt.y);
      ctx.lineTo(x, y);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(x, y, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    this.lastDrawPt = { x, y };
    this.resetCtx();
    void this.accentColor;
  }

  private drawShapePreview(x: number, y: number) {
    if (!this.drawCtx || !this.shapeStart) return;
    this.restoreCanvas(this.shapeBase);
    this.applyPenStyle();
    const ctx = this.drawCtx;
    const { tool } = PaintStore.get();
    const sx = this.shapeStart.x;
    const sy = this.shapeStart.y;
    ctx.beginPath();
    if (tool === "rect") {
      ctx.strokeRect(sx, sy, x - sx, y - sy);
    } else if (tool === "ellipse") {
      const cx = (sx + x) / 2;
      const cy = (sy + y) / 2;
      const rx = Math.abs(x - sx) / 2;
      const ry = Math.abs(y - sy) / 2;
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (tool === "line") {
      ctx.moveTo(sx, sy);
      ctx.lineTo(x, y);
      ctx.stroke();
    } else if (tool === "arrow") {
      ctx.moveTo(sx, sy);
      ctx.lineTo(x, y);
      ctx.stroke();
      const head = Math.max(10, ctx.lineWidth * 3);
      const ang = Math.atan2(y - sy, x - sx);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - head * Math.cos(ang - Math.PI / 7), y - head * Math.sin(ang - Math.PI / 7));
      ctx.lineTo(x - head * Math.cos(ang + Math.PI / 7), y - head * Math.sin(ang + Math.PI / 7));
      ctx.closePath();
      ctx.fill();
    }
    this.resetCtx();
  }

  undo() {
    if (!this.drawCtx) return;
    const prev = PaintHistory.undo();
    if (prev) {
      this.restoreCanvas(prev);
    } else {
      this.drawCtx.clearRect(0, 0, this.drawCanvas.width, this.drawCanvas.height);
    }
  }

  redo() {
    const next = PaintHistory.redo();
    if (next) this.restoreCanvas(next);
  }

  saveAsPng() {
    const url = this.drawCanvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `omnipoint-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
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
      const isDrawing = g === "click" || g === "drag" || snap.pinchDistance < 0.05;
      const tool = PaintStore.get().tool;
      const isShape = PaintStore.isShape(tool);

      if (isShape) {
        if (isDrawing) {
          if (!this.shapeStart) {
            const snapImg = this.snapshotCanvas();
            if (snapImg) PaintHistory.push(snapImg);
            this.shapeBase = snapImg;
            this.shapeStart = { x, y };
          }
          this.drawShapePreview(x, y);
        } else if (this.shapeStart) {
          this.shapeStart = null;
          this.shapeBase = null;
        }
        this.setLabel(isDrawing ? tool.toUpperCase() : `SHAPE · ${tool.toUpperCase()}`);
      } else {
        if (isDrawing) {
          if (!this.lastDrawPt) {
            const snapImg = this.snapshotCanvas();
            if (snapImg) PaintHistory.push(snapImg);
          }
          this.drawFreehand(x, y);
        } else {
          this.lastDrawPt = null;
        }
        this.setLabel(isDrawing ? tool.toUpperCase() : `DRAW · ${tool.toUpperCase()}`);
      }

      // Static-pose actions in DRAW mode (undo/redo/clear/save/etc) come
      // from the user's gesture bindings, gated by hold-time + cooldown.
      this.tryFireStaticGesture(g, snap.confidence, "draw");
      this.lastGesture = g;
      return;
    }

    // Pointer mode — drive real DOM events
    const target = this.hitTest(x, y);
    this.dispatchMove(target, x, y);

    const now = performance.now();
    const transitionedTo = (k: GestureKind) => g === k && this.lastGesture !== k;

    if (g === "drag" && !this.isDown) {
      this.dispatchDown(target, x, y);
      this.isDown = true;
      this.setLabel("DRAG");
    } else if (this.isDown && g !== "drag") {
      this.dispatchUp(target);
      this.dispatchClick(target, x, y);
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
    } else if (g === "fist") {
      this.setLabel("HOLD");
    } else if (g === "point") {
      this.setLabel("");
    } else if (g === "none") {
      this.setLabel("");
    }

    // Configurable static-pose gestures (open_palm / thumbs_up / pinky_only
    // / four_fingers / fist) — gated by hold-time + cooldown for accuracy
    // and routed through the user's gesture bindings.
    this.tryFireStaticGesture(g, snap.confidence, "pointer");

    this.lastGesture = g;
  };

  /**
   * Buffer-then-fire dispatcher for static poses. Requires the same pose
   * to be sustained for `holdMs * accuracyBias` AND respects a per-pose
   * cooldown window. Returns true if an action fired this frame.
   */
  private tryFireStaticGesture(
    g: GestureKind,
    confidence: number,
    surface: "pointer" | "draw",
  ): boolean {
    const now = performance.now();
    const settings = GestureSettingsStore.get();

    if (!isConfigurable(g)) {
      this.poseHeld = null;
      this.poseHeldSince = 0;
      return false;
    }
    const binding = settings.bindings[g];
    if (!binding.enabled) return false;
    if (confidence < settings.minConfidence) return false;

    // Track sustained pose
    if (this.poseHeld !== g) {
      this.poseHeld = g;
      this.poseHeldSince = now;
      return false;
    }

    const requiredHold = binding.holdMs * settings.accuracyBias;
    if (now - this.poseHeldSince < requiredHold) return false;

    const lastFired = this.poseFiredAt[g] ?? 0;
    if (now - lastFired < binding.cooldownMs) return false;

    const action = surface === "pointer" ? binding.pointerAction : binding.drawAction;

    // Honor palm-scope: open_palm should only fire in the configured surface.
    if (g === "open_palm") {
      const scope = settings.palmScope;
      if (scope === "pointer_only" && surface !== "pointer") return false;
      if (scope === "draw_only" && surface !== "draw") return false;
    }

    if (action === "none") return false;

    this.executeAction(action);
    this.poseFiredAt[g] = now;
    return true;
  }

  private executeAction(action: GestureAction) {
    switch (action) {
      case "back":
        window.history.back();
        this.setLabel("← BACK");
        break;
      case "forward":
        window.history.forward();
        this.setLabel("FORWARD →");
        break;
      case "undo":
        if (this.mode === "draw") this.undo();
        else this.dispatchKey("z", 90, { ctrl: true });
        this.setLabel("UNDO");
        break;
      case "redo":
        if (this.mode === "draw") this.redo();
        else this.dispatchKey("y", 89, { ctrl: true });
        this.setLabel("REDO");
        break;
      case "zoom_in":
        this.adjustZoom(0.1);
        this.setLabel("ZOOM +");
        break;
      case "zoom_out":
        this.adjustZoom(-0.1);
        this.setLabel("ZOOM −");
        break;
      case "next":
        this.dispatchKey("ArrowRight", 39);
        this.setLabel("NEXT →");
        break;
      case "prev":
        this.dispatchKey("ArrowLeft", 37);
        this.setLabel("← PREV");
        break;
      case "save":
        if (this.mode === "draw") this.saveAsPng();
        else this.dispatchKey("s", 83, { ctrl: true });
        this.setLabel("SAVE");
        break;
      case "clear":
        if (this.mode === "draw") this.clearDrawing();
        this.setLabel("CLEAR");
        break;
      case "escape":
        this.dispatchKey("Escape", 27);
        this.setLabel("ESC");
        break;
      case "enter":
        this.dispatchKey("Enter", 13);
        this.setLabel("ENTER");
        break;
      case "space":
        this.dispatchKey(" ", 32);
        this.setLabel("SPACE");
        break;
      case "emergency_stop":
        TelemetryStore.set({ emergencyStop: true });
        this.setLabel("⛔ STOP");
        break;
      default:
        break;
    }
  }

  private adjustZoom(delta: number) {
    const cur = parseFloat((document.body.style as CSSStyleDeclaration & { zoom?: string }).zoom || "1") || 1;
    const next = Math.min(2, Math.max(0.5, cur + delta));
    (document.body.style as CSSStyleDeclaration & { zoom?: string }).zoom = String(next);
  }

  private dispatchKey(
    key: string,
    keyCode: number,
    mods: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean } = {},
  ) {
    const target = document.activeElement ?? document.body;
    const init = {
      bubbles: true, cancelable: true, composed: true,
      key, code: key, keyCode, which: keyCode,
      ctrlKey: !!mods.ctrl,
      shiftKey: !!mods.shift,
      altKey: !!mods.alt,
      metaKey: !!mods.meta,
    } as KeyboardEventInit;
    target.dispatchEvent(new KeyboardEvent("keydown", init));
    target.dispatchEvent(new KeyboardEvent("keyup", init));
  }
}
