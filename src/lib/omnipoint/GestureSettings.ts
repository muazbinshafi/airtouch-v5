// GestureSettings - user-customizable gesture → action bindings, persisted
// in localStorage. Backed by a tiny reactive store so any UI/cursor layer
// can subscribe via useSyncExternalStore.
//
// We separate "static" gestures (held poses like open_palm, thumbs_up,
// pinky_only, four_fingers, fist) from "dynamic" gestures (point/click/
// right_click/drag/scroll) because static poses benefit from a confirmation
// hold-time to suppress false positives (= higher accuracy).

import type { GestureKind } from "./TelemetryStore";

export type GestureAction =
  | "none"
  | "back"
  | "forward"
  | "undo"
  | "redo"
  | "zoom_in"
  | "zoom_out"
  | "next"
  | "prev"
  | "save"
  | "clear"
  | "escape"
  | "enter"
  | "space"
  | "emergency_stop";

export type PalmScope = "draw_only" | "pointer_only" | "both";

// Only "configurable" gestures appear in the binding table. Click/drag/
// scroll/point are core pointer behaviors and not remappable.
export type ConfigurableGesture =
  | "open_palm"
  | "thumbs_up"
  | "pinky_only"
  | "four_fingers"
  | "fist";

export interface GestureBinding {
  /** What this gesture does in pointer mode */
  pointerAction: GestureAction;
  /** What this gesture does in draw mode */
  drawAction: GestureAction;
  /** Ms the pose must be held before firing (accuracy tuning) */
  holdMs: number;
  /** Ms minimum gap between two firings */
  cooldownMs: number;
  /** Whether this gesture is enabled at all */
  enabled: boolean;
}

export interface GestureSettings {
  /** Per-gesture bindings */
  bindings: Record<ConfigurableGesture, GestureBinding>;
  /** Where open palm "back/undo" should be active */
  palmScope: PalmScope;
  /** Min confidence (0..1) to accept any gesture firing */
  minConfidence: number;
  /** Global multiplier on holdMs — pull down for snappier, up for stricter */
  accuracyBias: number;
}

export const ACTION_LABELS: Record<GestureAction, string> = {
  none: "Do nothing",
  back: "Browser back",
  forward: "Browser forward",
  undo: "Undo (Ctrl+Z)",
  redo: "Redo (Ctrl+Y)",
  zoom_in: "Zoom in",
  zoom_out: "Zoom out",
  next: "Next (→)",
  prev: "Previous (←)",
  save: "Save / download",
  clear: "Clear canvas",
  escape: "Escape",
  enter: "Enter",
  space: "Space",
  emergency_stop: "Emergency stop",
};

export const GESTURE_LABELS: Record<ConfigurableGesture, string> = {
  open_palm: "Open palm (5 fingers)",
  thumbs_up: "Thumbs up",
  pinky_only: "Pinky only",
  four_fingers: "Four fingers (no thumb)",
  fist: "Fist",
};

export const defaultSettings: GestureSettings = {
  bindings: {
    open_palm: {
      pointerAction: "back",
      drawAction: "undo",
      holdMs: 180,
      cooldownMs: 600,
      enabled: true,
    },
    thumbs_up: {
      pointerAction: "zoom_in",
      drawAction: "redo",
      holdMs: 200,
      cooldownMs: 350,
      enabled: true,
    },
    pinky_only: {
      pointerAction: "zoom_out",
      drawAction: "clear",
      holdMs: 220,
      cooldownMs: 350,
      enabled: true,
    },
    four_fingers: {
      pointerAction: "next",
      drawAction: "save",
      holdMs: 200,
      cooldownMs: 380,
      enabled: true,
    },
    fist: {
      pointerAction: "emergency_stop",
      drawAction: "emergency_stop",
      holdMs: 350,
      cooldownMs: 800,
      enabled: false,
    },
  },
  palmScope: "both",
  minConfidence: 0.55,
  accuracyBias: 1.0,
};

const STORAGE_KEY = "omnipoint.gestureSettings.v1";

function load(): GestureSettings {
  if (typeof localStorage === "undefined") return { ...defaultSettings };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...defaultSettings };
    const parsed = JSON.parse(raw) as Partial<GestureSettings>;
    return {
      ...defaultSettings,
      ...parsed,
      bindings: {
        ...defaultSettings.bindings,
        ...(parsed.bindings ?? {}),
      },
    };
  } catch {
    return { ...defaultSettings };
  }
}

function save(s: GestureSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* quota exceeded — ignore */
  }
}

let snapshot: GestureSettings = load();
const listeners = new Set<() => void>();

export const GestureSettingsStore = {
  subscribe(cb: () => void) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  get(): GestureSettings {
    return snapshot;
  },
  patch(p: Partial<GestureSettings>) {
    snapshot = { ...snapshot, ...p };
    save(snapshot);
    for (const l of listeners) l();
  },
  patchBinding(g: ConfigurableGesture, p: Partial<GestureBinding>) {
    snapshot = {
      ...snapshot,
      bindings: {
        ...snapshot.bindings,
        [g]: { ...snapshot.bindings[g], ...p },
      },
    };
    save(snapshot);
    for (const l of listeners) l();
  },
  reset() {
    snapshot = { ...defaultSettings };
    save(snapshot);
    for (const l of listeners) l();
  },
};

/** Helper used inside BrowserCursor — null if gesture isn't configurable. */
export function isConfigurable(g: GestureKind): g is ConfigurableGesture {
  return (
    g === "open_palm" ||
    g === "thumbs_up" ||
    g === "pinky_only" ||
    g === "four_fingers" ||
    g === "fist"
  );
}
