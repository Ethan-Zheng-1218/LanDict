import { useRef, type MouseEvent } from "react";

/** Inline words retain surrounding typography and remain selectable as normal text. */
export function LookupText({ text, onLookup }: { text: string; onLookup?: (word: string) => void }) {
  const gesture = useRef({ x: 0, y: 0, dragged: false });
  if (!onLookup) return <>{text}</>;
  const parts = text.split(/([a-z]+(?:['’-][a-z]+)*)/gi);
  const recordMovement = (event: MouseEvent) => {
    if (Math.hypot(event.clientX - gesture.current.x, event.clientY - gesture.current.y) > 4) gesture.current.dragged = true;
  };
  return <>{parts.map((part, index) => /^[a-z]/i.test(part) ? <span
    key={index}
    className="dictionary-lookup-word"
    role="button"
    tabIndex={0}
    aria-label={`查词 ${part}`}
    onMouseDown={event => { gesture.current = { x: event.clientX, y: event.clientY, dragged: false }; }}
    onMouseMove={event => { if (event.buttons === 1) recordMovement(event); }}
    onMouseUp={recordMovement}
    onClick={event => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || gesture.current.dragged || window.getSelection()?.isCollapsed === false) return;
      onLookup(part);
    }}
    onKeyDown={event => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onLookup(part); }
    }}
  >{part}</span> : part)}</>;
}
