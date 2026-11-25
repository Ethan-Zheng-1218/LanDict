import { Button } from "@/components/ui/button";
import { ArrowLeft, ChevronRight, Trash2 } from "@/components/ui/icon";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { clearHistory, HISTORY_CHANGED_EVENT, listHistory, type HistoryEntry } from "./historyStore";

type HistoryGroup = { label: "今天" | "昨天" | "之前"; entries: HistoryEntry[] };

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}

function groupHistory(entries: HistoryEntry[], now = new Date()): HistoryGroup[] {
  const today = startOfDay(now);
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
  const groups: HistoryGroup[] = [
    { label: "今天", entries: [] },
    { label: "昨天", entries: [] },
    { label: "之前", entries: [] },
  ];

  entries.forEach((entry) => {
    const date = new Date(entry.createdAt);
    const day = Number.isNaN(date.getTime()) ? 0 : startOfDay(date);
    (day >= today ? groups[0] : day >= yesterday ? groups[1] : groups[2]).entries.push(entry);
  });

  return groups.filter((group) => group.entries.length > 0);
}

export function QueryHistoryPage() {
  const navigate = useNavigate();
  const [history, setHistory] = useState<HistoryEntry[]>(() => listHistory());
  const groups = useMemo(() => groupHistory(history), [history]);

  useEffect(() => {
    const refresh = () => setHistory(listHistory());
    window.addEventListener(HISTORY_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(HISTORY_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  return (
    <section className="records-page">
      <header className="records-page-header">
        <div>
          <Link className="records-back" to="/"><ArrowLeft aria-hidden="true" size={16} />返回首页</Link>
          <h1>查询历史</h1>
          <p>共 {history.length} 条记录</p>
        </div>
        <Button size="preserve" variant="destructive" className="records-clear" disabled={history.length === 0} onClick={clearHistory} type="button">
          <Trash2 aria-hidden="true" size={16} />清除记录
        </Button>
      </header>

      {groups.length > 0 ? (
        <div className="records-list">
          {groups.map((group) => (
            <section className="records-group" key={group.label} aria-label={group.label}>
              <h2>{group.label}</h2>
              <ul>
                {group.entries.map((entry) => (
                  <li key={entry.id}>
                    <button onClick={() => navigate(`/query?q=${encodeURIComponent(entry.query)}`)} type="button">
                      <span className="records-history-copy">
                        <span className="records-history-query" title={entry.query}>{entry.query}</span>
                        <span className="records-history-preview" title={entry.preview ?? "暂无摘要"}>{entry.preview ?? "暂无摘要"}</span>
                      </span>
                      <ChevronRight aria-hidden="true" size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <div className="records-empty">
          <h2>还没有查询记录</h2>
          <p>在首页或翻译页开始第一次查询吧。</p>
          <Link to="/">返回首页</Link>
        </div>
      )}
    </section>
  );
}
