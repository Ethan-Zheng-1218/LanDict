export type ArticleSource = "bbc" | "cgtn" | "voa" | "un-news" | "rest-of-world" | "aeon" | "quanta" | "works-in-progress" | "bundled";

export type ArticleBlock =
  | { id: string; type: "paragraph"; text: string }
  | { id: string; type: "heading"; level: 2 | 3; text: string }
  | { id: string; type: "image"; src: string; alt: string; caption?: string }
  | { id: string; type: "quote"; text: string; attribution?: string }
  | { id: string; type: "list"; ordered: boolean; items: string[] };

export type ArticleDocument = {
  id: string;
  source: ArticleSource;
  title: string;
  summary: string;
  author?: string;
  originalUrl: string;
  publishedAt: string;
  category: string;
  contentType?: "news" | "article";
  imageUrl?: string;
  downloaded: boolean;
  downloadedAt?: string;
  /** Extraction schema of the cached document; documents below the current version are re-extracted. */
  extractorVersion?: number;
  blocks: ArticleBlock[];
};
