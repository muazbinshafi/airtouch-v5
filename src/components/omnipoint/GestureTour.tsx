// GestureTour — a friendly, step-by-step pop-up tour that teaches new users
// which hand gesture does what. Shown automatically the first time the
// sensor comes online; users can skip or replay it. Persisted in
// localStorage so it doesn't nag returning users.
//
// Visual: a centered card with a large gesture illustration (emoji + label),
// a progress dots row, and prev/next/skip controls. A subtle backdrop
// dimmer focuses attention without blocking the live sensor underneath
// (pointer-events stay on the dialog only).

import { useEffect, useState } from "react";
import {
  ChevronLeft, ChevronRight, X, Hand, MousePointer2,
  Pointer, Grab, Move, Sparkles, CheckCircle2,
} from "lucide-react";

const STORAGE_KEY = "omnipoint:gesture-tour-seen-v1";

interface Step {
  emoji: string;
  title: string;
  description: string;
  hint: string;
  Icon: typeof Hand;
}

const STEPS: Step[] = [
  {
    emoji: "👆",
    title: "Point to move",
    description:
      "Hold up your index finger. Your fingertip becomes the cursor — move it around to navigate.",
    hint: "Try drawing a slow circle in the air.",
    Icon: MousePointer2,
  },
  {
    emoji: "🤏",
    title: "Pinch to click",
    description:
      "Bring your thumb and index finger together briefly to perform a click. Pinch twice for a double-click.",
    hint: "Quick, deliberate pinches work best.",
    Icon: Pointer,
  },
  {
    emoji: "✊",
    title: "Fist to drag",
    description:
      "Make a closed fist to grab. Move your hand while still in a fist to drag — open your hand to drop.",
    hint: "Great for selecting text or moving windows.",
    Icon: Grab,
  },
  {
    emoji: "✋",
    title: "Open palm to scroll",
    description:
      "Show your open palm and move it up or down to scroll the page. Tilt left/right for horizontal scroll.",
    hint: "Slow movements scroll smoothly; fast ones jump.",
    Icon: Move,
  },
  {
    emoji: "🤙",
    title: "Three fingers for shortcuts",
    description:
      "Lift three fingers together to trigger custom gesture shortcuts you can configure in Settings.",
    hint: "Map your favorite hotkeys for instant access.",
    Icon: Sparkles,
  },
  {
    emoji: "🎉",
    title: "You're ready!",
    description:
      "Open Settings any time to tune sensitivity and remap gestures. Press the help icon to replay this tour.",
    hint: "Have fun exploring — calibrate from the top bar if needed.",
    Icon: CheckCircle2,
  },
];

interface GestureTourProps {
  /** When true, force the tour open regardless of localStorage state. */
  forceOpen?: boolean;
  /** Called when the tour is closed (skip or finish). */
  onClose?: () => void;
  /** When true, show on mount only if user hasn't seen it before. */
  autoShow?: boolean;
}

export function GestureTour({ forceOpen, onClose, autoShow = true }: GestureTourProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  // Decide whether to auto-open based on storage flag.
  useEffect(() => {
    if (forceOpen) {
      setOpen(true);
      setStep(0);
      return;
    }
    if (!autoShow) return;
    try {
      const seen = localStorage.getItem(STORAGE_KEY);
      if (!seen) {
        // Small delay so it doesn't pop the moment the camera lights up.
        const t = setTimeout(() => setOpen(true), 600);
        return () => clearTimeout(t);
      }
    } catch {
      /* storage unavailable — show anyway */
      setOpen(true);
    }
  }, [forceOpen, autoShow]);

  // Sync open state with forceOpen toggling.
  useEffect(() => {
    if (forceOpen) {
      setOpen(true);
      setStep(0);
    }
  }, [forceOpen]);

  // Keyboard navigation: ←/→ to move, Esc to skip.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose(true);
      else if (e.key === "ArrowRight") handleNext();
      else if (e.key === "ArrowLeft") handlePrev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step]);

  const handleClose = (markSeen: boolean) => {
    if (markSeen) {
      try { localStorage.setItem(STORAGE_KEY, "1"); } catch { /* ignore */ }
    }
    setOpen(false);
    onClose?.();
  };

  const handleNext = () => {
    if (step >= STEPS.length - 1) {
      handleClose(true);
    } else {
      setStep((s) => s + 1);
    }
  };

  const handlePrev = () => setStep((s) => Math.max(0, s - 1));

  if (!open) return null;

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const Icon = current.Icon;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-3 sm:p-6 bg-background/40 backdrop-blur-sm animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-title"
    >
      <div className="relative w-full max-w-md border border-border bg-card shadow-2xl animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-300">
        {/* Skip button — always visible top-right */}
        <button
          onClick={() => handleClose(true)}
          className="absolute top-2.5 right-2.5 z-10 inline-flex items-center gap-1.5 px-2.5 h-8 font-mono text-[10px] tracking-[0.25em] text-muted-foreground hover:text-foreground border hairline bg-background/60 backdrop-blur transition-colors"
          aria-label="Skip tour"
        >
          SKIP
          <X className="w-3 h-3" />
        </button>

        {/* Header label */}
        <div className="px-5 pt-5 pb-1 flex items-center gap-2">
          <Hand className="w-3.5 h-3.5 text-primary" />
          <span className="font-mono text-[10px] tracking-[0.3em] text-emerald-glow">
            GESTURE GUIDE · {String(step + 1).padStart(2, "0")}/{String(STEPS.length).padStart(2, "0")}
          </span>
        </div>

        {/* Body */}
        <div className="px-5 pt-3 pb-5">
          <div className="flex items-start gap-4">
            <div className="shrink-0 w-20 h-20 rounded-xl bg-gradient-primary/10 border border-primary/20 grid place-items-center text-5xl select-none">
              <span aria-hidden="true">{current.emoji}</span>
            </div>
            <div className="flex-1 min-w-0">
              <h2
                id="tour-title"
                className="text-lg sm:text-xl font-semibold tracking-tight text-foreground flex items-center gap-2"
              >
                <Icon className="w-4 h-4 text-primary shrink-0" />
                {current.title}
              </h2>
              <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
                {current.description}
              </p>
            </div>
          </div>

          <div className="mt-4 px-3 py-2 border-l-2 border-primary/40 bg-primary/5">
            <p className="text-xs text-foreground/80">
              <span className="font-mono text-[10px] tracking-[0.25em] text-primary mr-2">TIP</span>
              {current.hint}
            </p>
          </div>

          {/* Progress dots */}
          <div className="mt-5 flex items-center justify-center gap-1.5">
            {STEPS.map((_, i) => (
              <button
                key={i}
                onClick={() => setStep(i)}
                aria-label={`Go to step ${i + 1}`}
                className={`h-1.5 rounded-full transition-all ${
                  i === step
                    ? "w-6 bg-primary"
                    : i < step
                      ? "w-1.5 bg-primary/60"
                      : "w-1.5 bg-border hover:bg-muted-foreground/40"
                }`}
              />
            ))}
          </div>

          {/* Controls */}
          <div className="mt-5 flex items-center gap-2">
            <button
              onClick={handlePrev}
              disabled={step === 0}
              className="h-10 px-3 inline-flex items-center gap-1.5 border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-30 disabled:pointer-events-none transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              Back
            </button>
            <button
              onClick={() => handleClose(true)}
              className="h-10 px-3 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Skip guide
            </button>
            <div className="flex-1" />
            <button
              onClick={handleNext}
              className="h-10 px-4 inline-flex items-center gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 text-sm font-medium transition-colors"
            >
              {isLast ? "Got it" : "Next"}
              {!isLast && <ChevronRight className="w-4 h-4" />}
              {isLast && <CheckCircle2 className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Reset helper so a "Replay tour" button can re-trigger autoShow. */
export function resetGestureTour() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}
