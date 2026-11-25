import { useEffect, useRef, useState, type CompositionEventHandler, type FocusEventHandler, type KeyboardEventHandler, type MouseEventHandler } from "react";
import { Input } from "@/components/ui/input";
import { getDefinitionPreview } from "./definitionPreview";
import { getInputCompletion } from "./inputCompletion";

type Field = HTMLInputElement | HTMLTextAreaElement;
type Props = {
  value: string; onChange: (value: string) => void; label: string; placeholder: string;
  as?: "input" | "textarea"; multiline?: boolean; expanded?: boolean;
  onFocus?: FocusEventHandler<Field>; onClick?: MouseEventHandler<Field>; onKeyDown?: KeyboardEventHandler<Field>;
  onCompositionStart?: CompositionEventHandler<Field>; onCompositionEnd?: CompositionEventHandler<Field>;
};

/** Both search pages share exact previews and optional local prefix completion. */
export function AssistedWordInput({ value, onChange, label, placeholder, as = "textarea", multiline = false, expanded, ...events }: Props) {
  const field = useRef<Field | null>(null);
  const composing = useRef(false);
  const [isComposing, setIsComposing] = useState(false);
  const [focused, setFocused] = useState(false);
  const [atEnd, setAtEnd] = useState(true);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [assistance, setAssistance] = useState({ value: "", preview: "", completion: "" });

  useEffect(() => {
    if (isComposing || !/^[a-z]+(?:[-'][a-z]+)*$/i.test(value.trim())) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void Promise.all([
        getDefinitionPreview(value.trim(), undefined, controller.signal).catch(() => ""),
        getInputCompletion(value, controller.signal).catch(() => ""),
      ]).then(([preview, completion]) => {
        if (!controller.signal.aborted) setAssistance({ value, preview, completion });
      });
    }, 160);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [value, isComposing]);

  const current = assistance.value === value && !isComposing && !multiline;
  const preview = current ? assistance.preview : "";
  const suffix = current && focused && atEnd && dismissed !== value ? assistance.completion.slice(value.length) : "";
  function updateCaret(target: Field) {
    setAtEnd(target.selectionStart === target.value.length && target.selectionEnd === target.value.length && target.scrollLeft === 0);
  }
  const props = {
    ref: (element: Field | null) => { field.current = element; },
    "aria-label": label, "aria-haspopup": expanded === undefined ? undefined : "dialog" as const,
    "aria-expanded": expanded, autoComplete: "off", value, placeholder,
    onChange: (event: React.ChangeEvent<Field>) => {
      setAssistance({ value: "", preview: "", completion: "" }); setDismissed(null); updateCaret(event.currentTarget); onChange(event.currentTarget.value);
    },
    onFocus: (event: React.FocusEvent<Field>) => { setFocused(true); updateCaret(event.currentTarget); events.onFocus?.(event); },
    onBlur: () => setFocused(false),
    onSelect: (event: React.SyntheticEvent<Field>) => updateCaret(event.currentTarget),
    onScroll: (event: React.UIEvent<Field>) => updateCaret(event.currentTarget),
    onClick: (event: React.MouseEvent<Field>) => { updateCaret(event.currentTarget); events.onClick?.(event); },
    onCompositionStart: (event: React.CompositionEvent<Field>) => { composing.current = true; setIsComposing(true); events.onCompositionStart?.(event); },
    onCompositionEnd: (event: React.CompositionEvent<Field>) => { composing.current = false; setIsComposing(false); events.onCompositionEnd?.(event); },
    onKeyDown: (event: React.KeyboardEvent<Field>) => {
      if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) {
        if (event.key === "Enter") event.preventDefault();
        return;
      }
      if (event.key === "Escape") setDismissed(value);
      if (event.key === "Tab" && suffix && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        const completed = value + suffix;
        setAssistance({ value: "", preview: "", completion: "" }); onChange(completed);
        requestAnimationFrame(() => { if (field.current?.value === completed) field.current.setSelectionRange(completed.length, completed.length); });
        return;
      }
      events.onKeyDown?.(event);
    },
  };
  return <div className="query-input-area">
    <div className="assisted-word-field">
      {as === "input" ? <Input {...props} /> : <textarea {...props} rows={1} />}
      {suffix && <span aria-hidden="true" data-testid="word-completion" className="query-word-completion"><span className="query-completion-prefix">{value}</span>{suffix}</span>}
    </div>
    {preview && <span aria-hidden="true" className="query-definition-preview" data-testid="definition-preview">{preview}</span>}
  </div>;
}
