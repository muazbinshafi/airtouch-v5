// GestureSettingsPanel — slide-over sheet that lets users remap gesture
// bindings, tune accuracy, and choose where the open-palm shortcut applies.

import { useState } from "react";
import { Settings2, RotateCcw } from "lucide-react";
import { useGestureSettings } from "@/hooks/useGestureSettings";
import {
  GestureSettingsStore,
  ACTION_LABELS,
  GESTURE_LABELS,
  type ConfigurableGesture,
  type GestureAction,
  type PalmScope,
} from "@/lib/omnipoint/GestureSettings";

const ACTIONS: GestureAction[] = [
  "none",
  "back",
  "forward",
  "undo",
  "redo",
  "zoom_in",
  "zoom_out",
  "next",
  "prev",
  "save",
  "clear",
  "escape",
  "enter",
  "space",
  "emergency_stop",
];

const GESTURES: ConfigurableGesture[] = [
  "open_palm",
  "thumbs_up",
  "pinky_only",
  "four_fingers",
  "fist",
];

export function GestureSettingsPanel() {
  const [open, setOpen] = useState(false);
  const settings = useGestureSettings();

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Customize gestures"
        className="font-mono text-[10px] tracking-[0.3em] px-3 h-8 inline-flex items-center gap-1.5 border hairline text-muted-foreground hover:text-foreground bg-card/60 backdrop-blur"
      >
        <Settings2 className="w-3.5 h-3.5" />
        GESTURES
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[2147483647] bg-background/70 backdrop-blur-sm flex justify-end"
          onClick={() => setOpen(false)}
        >
          <aside
            onClick={(e) => e.stopPropagation()}
            className="w-[440px] max-w-full h-full bg-card border-l border-border overflow-y-auto"
          >
            <header className="sticky top-0 z-10 bg-card border-b hairline px-4 h-12 flex items-center justify-between">
              <div className="font-mono text-[11px] tracking-[0.3em] text-emerald-glow">
                ▣ GESTURE CUSTOMIZATION
              </div>
              <button
                onClick={() => setOpen(false)}
                className="font-mono text-[11px] text-muted-foreground hover:text-foreground"
              >
                ✕
              </button>
            </header>

            <section className="p-4 border-b hairline">
              <SectionTitle>OPEN PALM SCOPE</SectionTitle>
              <p className="font-mono text-[10px] text-muted-foreground mb-3 leading-relaxed">
                Choose where the open palm gesture is active. In draw mode it
                triggers UNDO; in pointer mode it triggers BROWSER BACK.
              </p>
              <div className="grid grid-cols-3 gap-1">
                {(["draw_only", "pointer_only", "both"] as PalmScope[]).map((scope) => {
                  const active = settings.palmScope === scope;
                  return (
                    <button
                      key={scope}
                      onClick={() => GestureSettingsStore.patch({ palmScope: scope })}
                      className={`font-mono text-[10px] tracking-[0.2em] h-8 border ${
                        active
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-border text-muted-foreground hover:text-foreground hover:border-primary/40"
                      }`}
                    >
                      {scope === "draw_only" ? "DRAW ONLY" : scope === "pointer_only" ? "POINTER ONLY" : "BOTH"}
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="p-4 border-b hairline">
              <SectionTitle>ACCURACY TUNING</SectionTitle>
              <Slider
                label="MIN CONFIDENCE"
                hint="Higher = stricter. Reject gestures below this score."
                min={0.3} max={0.95} step={0.05}
                value={settings.minConfidence}
                onChange={(v) => GestureSettingsStore.patch({ minConfidence: v })}
              />
              <Slider
                label="ACCURACY BIAS"
                hint="Multiplier on hold-time. ↑ = stricter / fewer false fires. ↓ = snappier."
                min={0.5} max={2} step={0.05}
                value={settings.accuracyBias}
                onChange={(v) => GestureSettingsStore.patch({ accuracyBias: v })}
              />
            </section>

            <section className="p-4 border-b hairline">
              <SectionTitle>BINDINGS</SectionTitle>
              <p className="font-mono text-[10px] text-muted-foreground mb-3 leading-relaxed">
                Remap each pose. Hold-time prevents accidental fires.
              </p>
              {GESTURES.map((g) => {
                const b = settings.bindings[g];
                return (
                  <div
                    key={g}
                    className="border hairline p-3 mb-2 bg-background/40"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-mono text-[11px] tracking-[0.2em] text-foreground">
                        {GESTURE_LABELS[g]}
                      </div>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={b.enabled}
                          onChange={(e) =>
                            GestureSettingsStore.patchBinding(g, { enabled: e.target.checked })
                          }
                          className="accent-primary"
                        />
                        <span className="font-mono text-[9px] tracking-[0.2em] text-muted-foreground">
                          {b.enabled ? "ON" : "OFF"}
                        </span>
                      </label>
                    </div>

                    <div className="grid grid-cols-2 gap-2 mb-2">
                      <ActionPicker
                        label="POINTER MODE"
                        value={b.pointerAction}
                        onChange={(v) =>
                          GestureSettingsStore.patchBinding(g, { pointerAction: v })
                        }
                      />
                      <ActionPicker
                        label="DRAW MODE"
                        value={b.drawAction}
                        onChange={(v) =>
                          GestureSettingsStore.patchBinding(g, { drawAction: v })
                        }
                      />
                    </div>

                    <Slider
                      label="HOLD (ms)"
                      min={50} max={800} step={10}
                      value={b.holdMs}
                      onChange={(v) => GestureSettingsStore.patchBinding(g, { holdMs: v })}
                      compact
                    />
                    <Slider
                      label="COOLDOWN (ms)"
                      min={100} max={1500} step={20}
                      value={b.cooldownMs}
                      onChange={(v) => GestureSettingsStore.patchBinding(g, { cooldownMs: v })}
                      compact
                    />
                  </div>
                );
              })}
            </section>

            <section className="p-4">
              <button
                onClick={() => GestureSettingsStore.reset()}
                className="w-full h-9 font-mono text-[10px] tracking-[0.3em] border border-destructive/50 text-destructive hover:bg-destructive/10 inline-flex items-center justify-center gap-2"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                RESET TO DEFAULTS
              </button>
            </section>
          </aside>
        </div>
      )}
    </>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-[10px] tracking-[0.3em] text-emerald-glow mb-2">
      ▸ {children}
    </div>
  );
}

function ActionPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: GestureAction;
  onChange: (v: GestureAction) => void;
}) {
  return (
    <div>
      <div className="font-mono text-[9px] tracking-[0.2em] text-muted-foreground mb-1">
        {label}
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as GestureAction)}
        className="w-full h-8 px-2 bg-input border border-border font-mono text-[11px] text-foreground focus:outline-none focus:border-primary"
      >
        {ACTIONS.map((a) => (
          <option key={a} value={a}>
            {ACTION_LABELS[a]}
          </option>
        ))}
      </select>
    </div>
  );
}

function Slider({
  label,
  hint,
  min,
  max,
  step,
  value,
  onChange,
  compact,
}: {
  label: string;
  hint?: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "mb-1.5" : "mb-3"}>
      <div className="flex justify-between font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
        <span>{label}</span>
        <span className="text-foreground tabular-nums">
          {step < 1 ? value.toFixed(2) : Math.round(value)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1 mt-1 appearance-none bg-secondary accent-primary cursor-pointer"
      />
      {hint && !compact && (
        <p className="font-mono text-[9px] text-muted-foreground/80 mt-1 leading-relaxed">
          {hint}
        </p>
      )}
    </div>
  );
}
