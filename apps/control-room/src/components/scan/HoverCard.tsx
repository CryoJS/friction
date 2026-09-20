/**
 * A tooltip that follows the cursor, portaled to <body> so it escapes the
 * scan canvas's overflow-hidden frame (and survives panning/zooming, which a
 * position anchored to the node would not).
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface Props {
  content: React.ReactNode;
  children: React.ReactNode;
}

const OFFSET = 18;
const SHOW_DELAY = 200;
const WIDTH = 288;
const EST_HEIGHT = 260;

export function HoverCard({ content, children }: Props) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const show = (event: React.MouseEvent) => {
    const { clientX, clientY } = event;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setPos({ x: clientX, y: clientY }), SHOW_DELAY);
  };
  const move = (event: React.MouseEvent) => {
    setPos((current) => (current ? { x: event.clientX, y: event.clientY } : current));
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    setPos(null);
  };

  return (
    <div onMouseEnter={show} onMouseMove={move} onMouseLeave={hide}>
      {children}
      {pos &&
        createPortal(
          <div
            role="tooltip"
            style={{
              left: Math.min(pos.x + OFFSET, window.innerWidth - WIDTH - 8),
              top: Math.min(pos.y + OFFSET, window.innerHeight - EST_HEIGHT - 8),
            }}
            className="pointer-events-none fixed z-50 w-72 rounded-card border border-hairline/15 bg-graphite/95 p-3.5 shadow-lg backdrop-blur-xs"
          >
            {content}
          </div>,
          document.body,
        )}
    </div>
  );
}
