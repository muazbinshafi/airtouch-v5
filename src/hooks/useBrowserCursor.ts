// useBrowserCursor — owns a single BrowserCursor instance with mode control.
// The cursor overlay is mounted in document.body once; this hook just
// coordinates lifecycle + exposes setMode/clearDrawing to the UI.

import { useEffect, useRef, useState, useCallback } from "react";
import { BrowserCursor, type CursorMode } from "@/lib/omnipoint/BrowserCursor";

export function useBrowserCursor(active: boolean, initialMode: CursorMode = "pointer") {
  const ref = useRef<BrowserCursor | null>(null);
  const [mode, setModeState] = useState<CursorMode>(initialMode);

  useEffect(() => {
    if (!active) return;
    const cursor = new BrowserCursor();
    cursor.attach();
    cursor.setMode(mode);
    ref.current = cursor;
    return () => {
      cursor.detach();
      ref.current = null;
    };
    // We deliberately only re-mount when `active` toggles; mode changes are
    // pushed into the existing instance via the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    ref.current?.setMode(mode);
  }, [mode]);

  const setMode = useCallback((m: CursorMode) => setModeState(m), []);
  const clearDrawing = useCallback(() => ref.current?.clearDrawing(), []);

  return { mode, setMode, clearDrawing };
}
