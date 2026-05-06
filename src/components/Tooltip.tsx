import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

type Props = {
  text: string;
  children: ReactNode;
};

const SHOW_DELAY_MS = 350;
const VIEWPORT_PAD = 8;
const GAP = 6;
const BUBBLE_WIDTH = 220;

/** Hover tooltip rendered in a body-level portal so it can never be clipped
 * by the panel's `overflow: hidden`. Position is measured against the
 * trigger's `getBoundingClientRect` and clamped to the viewport: it falls
 * below the trigger by default, flips above if it would overflow the
 * bottom edge, and is shifted horizontally to fit. */
export function Tooltip({ text, children }: Props) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  const handleEnter = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setShow(true), SHOW_DELAY_MS);
  };
  const handleLeave = () => {
    if (timer.current) window.clearTimeout(timer.current);
    setShow(false);
    setPos(null);
  };

  useLayoutEffect(() => {
    if (!show) return;
    const trigger = wrapRef.current;
    const bubble = bubbleRef.current;
    if (!trigger || !bubble) return;
    const tr = trigger.getBoundingClientRect();
    const br = bubble.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Default: directly below the trigger, left-aligned.
    let top = tr.bottom + GAP;
    let left = tr.left;

    // Clamp horizontally: prefer to keep the bubble inside [PAD, vw-PAD].
    const maxLeft = vw - br.width - VIEWPORT_PAD;
    if (left > maxLeft) left = maxLeft;
    if (left < VIEWPORT_PAD) left = VIEWPORT_PAD;

    // Flip above if we'd overflow the bottom edge.
    if (top + br.height > vh - VIEWPORT_PAD) {
      const above = tr.top - br.height - GAP;
      if (above >= VIEWPORT_PAD) top = above;
    }

    setPos({ top, left });
  }, [show]);

  return (
    <span
      ref={wrapRef}
      style={{ position: "relative", display: "inline-flex", alignItems: "center" }}
      onPointerEnter={handleEnter}
      onPointerLeave={handleLeave}
      onFocusCapture={handleEnter}
      onBlurCapture={handleLeave}
    >
      {children}
      {show &&
        createPortal(
          <div
            ref={bubbleRef}
            role="tooltip"
            style={{
              position: "fixed",
              top: pos?.top ?? -9999,
              left: pos?.left ?? -9999,
              // Hide on the first measurement pass so it doesn't flash at
              // the default (top-left) before useLayoutEffect repositions.
              visibility: pos ? "visible" : "hidden",
              width: BUBBLE_WIDTH,
              padding: "6px 8px",
              background: "var(--text)",
              color: "#fff",
              fontSize: 11,
              lineHeight: 1.4,
              borderRadius: 4,
              whiteSpace: "normal",
              zIndex: 1000,
              pointerEvents: "none",
              boxShadow: "0 2px 8px rgba(0, 0, 0, 0.18)",
              textTransform: "none",
              letterSpacing: "normal",
              fontWeight: "normal",
              fontFamily: "var(--font-sans)",
            }}
          >
            {text}
          </div>,
          document.body,
        )}
    </span>
  );
}

/** Small "?" badge with a tooltip — used to annotate field labels.
 *
 * Drawn as SVG so the glyph centers reliably regardless of font metrics.
 * Flex-centering a "?" character in a span leaves it visually offset
 * because IBM Plex Sans (and most fonts) place the character above the
 * em-box midline. */
export function InfoIcon({ text }: { text: string }) {
  return (
    <Tooltip text={text}>
      <svg
        role="img"
        aria-label={text}
        width="12"
        height="12"
        viewBox="0 0 12 12"
        style={{
          flex: "0 0 auto",
          cursor: "help",
          opacity: 0.55,
          color: "currentColor",
        }}
      >
        <circle
          cx="6"
          cy="6"
          r="5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
        />
        <text
          x="6"
          y="6"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="8"
          fontWeight="700"
          fontFamily="var(--font-sans)"
          fill="currentColor"
        >
          ?
        </text>
      </svg>
    </Tooltip>
  );
}
