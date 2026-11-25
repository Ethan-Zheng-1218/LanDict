import { useEffect, useState } from "react";

import { HISTORY_CHANGED_EVENT, listHistory, type HistoryEntry } from "../history/historyStore";

type QueryHistoryProps = { onSelect: (query: string) => void; limit?: number; title?: string };

function formatHistoryDate(timestamp: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(Date.parse(timestamp));
}

export function QueryHistory({ onSelect, limit = 5, title = "最近查询" }: QueryHistoryProps) {
  const readHistory = () => listHistory().slice(0, limit);
  const [history, setHistory] = useState<HistoryEntry[]>(readHistory);

  useEffect(() => {
    const refresh = () => setHistory(readHistory());
    window.addEventListener(HISTORY_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(HISTORY_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [limit]);

  return (
    <aside className="query-history" data-testid="query-history">
      <div className="query-history-header">
        <h2>{title}</h2>
        <span>{history.length} 条</span>
      </div>
      {history.length > 0 ? (
        <ul className="query-history-list">
          {history.map((entry) => (
            <li key={entry.id}>
              <button aria-label={`重新查询：${entry.query}`} onClick={() => onSelect(entry.query)} type="button">
                <span className="query-history-query">{entry.query}</span>
                <span className="query-history-meta">{entry.kind === "word" ? "单词" : entry.kind === "phrase" ? "短语" : "文本"} · {formatHistoryDate(entry.createdAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="query-history-empty">暂无查询历史</p>}
    </aside>
  );
}
