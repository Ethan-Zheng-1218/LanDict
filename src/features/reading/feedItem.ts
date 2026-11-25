import type { ArticleSource } from "./articleDocument";

export type FeedItem = {
  id: string;
  source: Exclude<ArticleSource, "bundled">;
  title: string;
  summary: string;
  originalUrl: string;
  publishedAt: string;
  category: string;
  contentType?: "news" | "article";
  imageUrl?: string;
  downloaded: boolean;
  localArticleId?: string;
};
