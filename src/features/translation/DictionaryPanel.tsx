import type { DictionaryEntry } from "./translationService";
import { dedupeMeaningText } from "../../lib/meaningText";
import { LookupText } from "./LookupText";

type DictionaryPanelProps = { entry: DictionaryEntry; compact?: boolean; onLookup?: (word: string) => void };

function DictionaryExampleLine({ text, translation, onLookup }: { text: string; translation?: string; onLookup?: (word: string) => void }) {
  return (
    <p className="dictionary-example-line always-stacked">
      <span><LookupText text={text} onLookup={onLookup} /></span>
      {translation && <span className="dictionary-example-translation"><LookupText text={translation} onLookup={onLookup} /></span>}
    </p>
  );
}

export function DictionaryPanel({ entry, compact = false, onLookup }: DictionaryPanelProps) {
  return (
    <div className={compact ? "dictionary-entry dictionary-entry-compact" : "dictionary-entry"} data-testid="dictionary-entry">
      {compact && <h3 className="dictionary-entry-word"><LookupText text={entry.word} onLookup={onLookup} /></h3>}
      <div className="dictionary-entry-summary">
        <div className="dictionary-meanings">
          {entry.meanings.length ? entry.meanings.map((meaning) => (
            <div className="dictionary-meaning-group" key={meaning.partOfSpeech || "meaning"}>
              {meaning.partOfSpeech && <span>{meaning.partOfSpeech}</span>}
              <strong><LookupText text={dedupeMeaningText(meaning.translations.join("；"))} onLookup={onLookup} /></strong>
            </div>
          )) : <strong>暂无中文释义</strong>}
        </div>
      </div>
      {!compact && <section className="dictionary-usage">
        <div>
          <h3>常见例句</h3>
          {entry.examples.length ? <div className="dictionary-examples">{entry.examples.map((item) => <div key={`${item.partOfSpeech}-${item.text}`}><strong>{item.partOfSpeech}</strong><DictionaryExampleLine text={item.text} translation={item.translation} onLookup={onLookup} /></div>)}</div> : <p>暂无常见例句</p>}
        </div>
        <div>
          <h3>常见搭配</h3>
          {entry.collocations.length ? <div className="dictionary-collocations">{entry.collocations.map((item) => <span key={item}><LookupText text={item} onLookup={onLookup} />{entry.collocationTranslations?.[item] && <small className="dictionary-inline-translation">（<LookupText text={entry.collocationTranslations[item]} onLookup={onLookup} />）</small>}</span>)}</div> : <p>暂无常见搭配</p>}
        </div>
      </section>}
      {!compact && entry.wordForms.length > 0 && <section>
        <h3>词形变化</h3>
        <div className="dictionary-collocations">
          {entry.wordForms.map((form) => <span key={`${form.label}-${form.value}`}>{form.label} <LookupText text={form.value} onLookup={onLookup} />{form.relatedWord && <>（原词 <LookupText text={form.relatedWord} onLookup={onLookup} />）</>}</span>)}
        </div>
      </section>}
    </div>
  );
}
