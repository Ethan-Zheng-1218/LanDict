import { Popover } from "@base-ui/react/popover";
import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { SearchBox } from "@/components/ui/search-box";
import { listHistory, type HistoryEntry } from "../history/historyStore";
import { AssistedWordInput } from "./AssistedWordInput";

type Props = { value: string; activeQuery: string; onChange: (value: string) => void; onSearch: (value: string) => void };

export function QuerySearchBox({ value, activeQuery, onChange, onSearch }: Props) {
  const anchor = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const [recent, setRecent] = useState<HistoryEntry[]>([]);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const multiline = value.includes("\n") || value.length > 120;

  function showHistory() {
    if (composing.current || (value.trim() && value.trim() !== activeQuery)) return;
    const entries = listHistory().slice(0, 5);
    setRecent(entries);
    setIsHistoryOpen(entries.length > 0);
  }

  function search(next: string) {
    setIsHistoryOpen(false);
    if (!composing.current && next.trim()) onSearch(next);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    search(value);
  }

  return <Popover.Root open={isHistoryOpen} onOpenChange={setIsHistoryOpen}>
    <div ref={anchor} className="query-search-anchor">
      <SearchBox aria-label="翻译查询" className="query-input-form" multiline={multiline} onSubmit={submit}>
          <AssistedWordInput
            label="重新查询"
            expanded={isHistoryOpen}
            multiline={multiline}
            value={value}
            placeholder="输入单词、短语或句子"
            onFocus={showHistory}
            onClick={showHistory}
            onChange={next => { setIsHistoryOpen(false); onChange(next); }}
            onCompositionStart={() => { composing.current = true; setIsHistoryOpen(false); }}
            onCompositionEnd={() => { composing.current = false; }}
            onKeyDown={event => {
              if (event.key === "Escape") { setIsHistoryOpen(false); return; }
              if (event.key === "Enter" && !composing.current && !event.nativeEvent.isComposing && event.keyCode !== 229 && !event.shiftKey && (!multiline || event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
        <Button type="submit">查询</Button>
      </SearchBox>
    </div>
    <Popover.Portal container={anchor}>
      <Popover.Positioner anchor={anchor} positionMethod="fixed" side="bottom" align="start" sideOffset={6} className="query-history-positioner">
        <Popover.Popup aria-label="最近查询" className="query-recent-popover" initialFocus={false} finalFocus={false}>
          {recent.map(entry => <button key={entry.id} type="button" onClick={() => search(entry.query)}>{entry.query}</button>)}
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Portal>
  </Popover.Root>;
}
