import { useEffect, useRef, useState, type ReactNode } from "react";

type Props = {
  text: string;
  children: ReactNode;
  /** Where to anchor the bubble relative to the trigger. */
  placement?: "top" | "bottom";
};

const SHOW_DELAY_MS = 350;

/** Lightweight hover tooltip. Wraps any inline-block trigger and shows a
 * styled bubble after a short delay. Single-text content; multi-line wraps
 * inside a fixed-width bubble. Pointer-events disabled on the bubble so it
 * doesn't intercept hover-out from the trigger. */
export function Tooltip({ text, children, placement = "bottom" }: Props) {
  const [show, setShow] = useState(false);
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
  };

  return (
    <span
      style={{ position: "relative", display: "inline-flex", alignItems: "center" }}
      onPointerEnter={handleEnter}
      onPointerLeave={handleLeave}
      onFocusCapture={handleEnter}
      onBlurCapture={handleLeave}
    >
      {children}
      {show && (
        <span
          role="tooltip"
          style={{
            position: "absolute",
            left: 0,
            ...(placement === "bottom"
              ? { top: "100%", marginTop: 6 }
              : { bottom: "100%", marginBottom: 6 }),
            padding: "6px 8px",
            background: "var(--text)",
            color: "#fff",
            fontSize: 11,
            lineHeight: 1.4,
            borderRadius: 4,
            whiteSpace: "normal",
            width: 220,
            zIndex: 100,
            pointerEvents: "none",
            boxShadow: "0 2px 8px rgba(0, 0, 0, 0.18)",
            textTransform: "none",
            letterSpacing: "normal",
            fontWeight: "normal",
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
}

/** Small "?" badge with a tooltip — used to annotate field labels. */
export function InfoIcon({ text }: { text: string }) {
  return (
    <Tooltip text={text}>
      <span
        aria-label={text}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 12,
          height: 12,
          borderRadius: "50%",
          border: "1px solid currentColor",
          fontSize: 9,
          fontWeight: 700,
          cursor: "help",
          opacity: 0.55,
        }}
      >
        ?
      </span>
    </Tooltip>
  );
}
