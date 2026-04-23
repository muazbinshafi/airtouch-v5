// PaintStore — reactive shared state for the MS Paint–style toolbox.
// BrowserCursor reads from this on every frame; the toolbar UI mutates it.

export type PenTool = "pen" | "marker" | "highlighter" | "eraser";
export type ShapeTool = "line" | "rect" | "ellipse" | "arrow";
export type Tool = PenTool | ShapeTool;

export interface Stroke {
  // Serialized stroke for undo/redo. We keep things simple: each stroke is a
  // list of points (for freehand) OR a 2-point shape descriptor.
  kind: "free" | ShapeTool;
  tool: PenTool;
  color: string;
  size: number;
  alpha: number;
  composite: GlobalCompositeOperation;
  points: { x: number; y: number }[]; // for "free" → all pts; shapes → [start, end]
}

export interface PaintSnapshot {
  tool: Tool;
  color: string;
  size: number;
  // Computed render hints (UI sets these via tool presets, but we expose
  // them so consumers can override per-stroke if they ever want to).
  alpha: number;
  composite: GlobalCompositeOperation;
}

const initial: PaintSnapshot = {
  tool: "pen",
  color: "#22d3a5",
  size: 4,
  alpha: 1,
  composite: "source-over",
};

let snapshot: PaintSnapshot = { ...initial };
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function deriveRenderHints(tool: Tool): { alpha: number; composite: GlobalCompositeOperation } {
  switch (tool) {
    case "highlighter":
      return { alpha: 0.28, composite: "source-over" };
    case "marker":
      return { alpha: 0.95, composite: "source-over" };
    case "eraser":
      return { alpha: 1, composite: "destination-out" };
    default:
      return { alpha: 1, composite: "source-over" };
  }
}

export const PaintStore = {
  subscribe(cb: () => void) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  get(): PaintSnapshot {
    return snapshot;
  },
  set(patch: Partial<PaintSnapshot>) {
    const next = { ...snapshot, ...patch };
    if (patch.tool && patch.alpha === undefined && patch.composite === undefined) {
      const hints = deriveRenderHints(patch.tool);
      next.alpha = hints.alpha;
      next.composite = hints.composite;
    }
    snapshot = next;
    emit();
  },
  isShape(tool: Tool = snapshot.tool): tool is ShapeTool {
    return tool === "line" || tool === "rect" || tool === "ellipse" || tool === "arrow";
  },
};

// Undo / redo stacks live here so the toolbar buttons and the cursor can
// share them. BrowserCursor pushes a snapshot before each new stroke.
const undoStack: ImageData[] = [];
const redoStack: ImageData[] = [];
const MAX_HISTORY = 30;

export const PaintHistory = {
  push(snap: ImageData) {
    undoStack.push(snap);
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack.length = 0;
    emitHistory();
  },
  undo(): ImageData | null {
    const top = undoStack.pop();
    if (!top) return null;
    redoStack.push(top);
    emitHistory();
    return undoStack[undoStack.length - 1] ?? null; // restore previous state
  },
  redo(): ImageData | null {
    const top = redoStack.pop();
    if (!top) return null;
    undoStack.push(top);
    emitHistory();
    return top;
  },
  clear() {
    undoStack.length = 0;
    redoStack.length = 0;
    emitHistory();
  },
  canUndo() {
    return undoStack.length > 0;
  },
  canRedo() {
    return redoStack.length > 0;
  },
};

const historyListeners = new Set<() => void>();
function emitHistory() {
  for (const l of historyListeners) l();
}
export function subscribeHistory(cb: () => void) {
  historyListeners.add(cb);
  return () => historyListeners.delete(cb);
}
