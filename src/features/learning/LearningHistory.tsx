import { useEffect, useState } from "react";

import { LEARNING_CHANGED_EVENT, listLearningEvents, type LearningEvent } from "./learningStore";

function eventLabel(type: LearningEvent["type"]) {
  return type === "lookup" ? "查词" : type === "reading" ? "阅读" : "复习";
}

export function LearningHistory() {
  const [events, setEvents] = useState<LearningEvent[]>(() => listLearningEvents().slice(0, 5));

  useEffect(() => {
    const refresh = () => setEvents(listLearningEvents().slice(0, 5));
    window.addEventListener(LEARNING_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(LEARNING_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  return (
    <section className="learning-history" data-testid="learning-history">
      <div className="section-heading"><h2>最近学习</h2></div>
      {events.length > 0 ? <ul>{events.map((event) => <li key={event.id}><span>{eventLabel(event.type)}</span><strong>{event.label}</strong></li>)}</ul> : <p>还没有学习记录，先查一个单词吧。</p>}
    </section>
  );
}
