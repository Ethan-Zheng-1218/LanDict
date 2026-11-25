import type { ArticleSource } from "./articleDocument";

/** Source names shown in reading kickers. */
export const BBC_SOURCE_NAME = "BBC News";
export const CGTN_SOURCE_NAME = "CGTN";
export const VOA_SOURCE_NAME = "VOA";
export const UN_NEWS_SOURCE_NAME = "UN News";
export const REST_OF_WORLD_SOURCE_NAME = "Rest of World";
export const AEON_SOURCE_NAME = "Aeon";
export const QUANTA_SOURCE_NAME = "Quanta Magazine";
export const WORKS_IN_PROGRESS_SOURCE_NAME = "Works in Progress";
export const BUNDLED_SOURCE_NAME = "Daily English";

/**
 * Section labels that only repeat the source name or carry no navigational value.
 * The BBC top-news RSS has no `<category>` element, so the feed parser falls back to
 * "BBC News" for every item; printing that next to the source label produced
 * "BBC News · BBC News".
 */
const GENERIC_SECTION_LABELS = new Set([
  "bbc",
  "bbc news",
  "bbc.com",
  "bbc.co.uk",
  "cgtn",
  "voa news",
  "un news",
  "news",
  "general",
  "general news",
  "top stories",
  "top story",
  "latest",
  "latest news",
  "main",
  "main news",
]);

export function getSourceName(source: ArticleSource): string {
  return source === "bbc" ? BBC_SOURCE_NAME
    : source === "cgtn" ? CGTN_SOURCE_NAME
      : source === "voa" ? VOA_SOURCE_NAME
        : source === "un-news" ? UN_NEWS_SOURCE_NAME
        : source === "rest-of-world" ? REST_OF_WORLD_SOURCE_NAME
          : source === "aeon" ? AEON_SOURCE_NAME
            : source === "quanta" ? QUANTA_SOURCE_NAME
              : source === "works-in-progress" ? WORKS_IN_PROGRESS_SOURCE_NAME
                : BUNDLED_SOURCE_NAME;
}

/** Keeps a section label only when it adds information beyond the source name. */
export function getSectionLabel(category: string | undefined, source: ArticleSource): string {
  const section = (category ?? "").trim().replace(/\s+/g, " ");
  if (!section) return "";
  const normalized = section.toLowerCase();
  if (GENERIC_SECTION_LABELS.has(normalized)) return "";
  if (normalized === getSourceName(source).toLowerCase()) return "";
  if ([BBC_SOURCE_NAME, CGTN_SOURCE_NAME, VOA_SOURCE_NAME, UN_NEWS_SOURCE_NAME, REST_OF_WORLD_SOURCE_NAME, AEON_SOURCE_NAME, QUANTA_SOURCE_NAME, WORKS_IN_PROGRESS_SOURCE_NAME, BUNDLED_SOURCE_NAME].some((name) => normalized === name.toLowerCase())) return "";
  return section;
}

/**
 * Builds a kicker such as "BBC News · World" or "Daily English · Climate".
 * The source name is printed exactly once; the section is appended only when the
 * feed supplies a real, distinct one.
 */
export function formatSourceKicker(source: ArticleSource, category: string | undefined): string {
  const name = getSourceName(source);
  const section = getSectionLabel(category, source);
  return section ? `${name} · ${section}` : name;
}
