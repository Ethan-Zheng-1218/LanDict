import type { ArticleDocument } from "./articleDocument";

export const READING_ARTICLE_TITLE = "Global Push for Clean Energy Gains Momentum Amid Climate Concerns";
export const READING_ARTICLE_DEK = "More countries are increasing investment in clean energy as they seek to tackle climate change and build more secure, resilient economies.";

export const BUNDLED_ARTICLE_DOCUMENT: ArticleDocument = {
  id: "global-push-clean-energy",
  source: "bundled",
  title: READING_ARTICLE_TITLE,
  summary: READING_ARTICLE_DEK,
  originalUrl: "",
  publishedAt: "2026-10-14T00:00:00.000Z",
  category: "Climate",
  downloaded: true,
  blocks: [
    { id: "intro", type: "paragraph", text: "Governments around the world are ramping up investment in clean energy, a trend experts say could help reduce carbon emissions, strengthen energy security and support new industries. Many governments are also expanding subsidy programs for renewable energy projects." },
    { id: "intro-2", type: "paragraph", text: "From North America to Asia, policymakers are using tax incentives, public investment and direct support to accelerate the transition away from fossil fuels. Supporters say these measures can reduce costs for households and encourage businesses to adopt cleaner technologies." },
    { id: "economy", type: "heading", level: 2, text: "A changing economic case" },
    { id: "economy-1", type: "paragraph", text: "The transition to a greener economy could create millions of jobs over the next decade, while also reshaping industries that have depended on coal, oil and gas. Economists note that the pace of change will differ across regions." },
    { id: "economy-2", type: "paragraph", text: "Countries with stronger grids and more diversified economies may be more resilient during the transition. Others may need additional financial support, training programs and infrastructure investment." },
    { id: "climate", type: "heading", level: 2, text: "Climate pressure is increasing" },
    { id: "climate-1", type: "paragraph", text: "Scientists continue to warn that global greenhouse-gas emission levels remain too high. At the same time, extreme heat, flooding and drought are placing greater pressure on communities and public services." },
    { id: "climate-2", type: "paragraph", text: "Climate resilience has become a central part of long-term planning, especially for cities that face repeated heat waves or coastal flooding." },
    { id: "outlook", type: "heading", level: 2, text: "What happens next" },
    { id: "outlook-1", type: "paragraph", text: "Analysts expect clean-energy investment to keep growing, but they also point to difficult questions about affordability, industrial competition and the speed of infrastructure construction. The next few years are likely to determine how quickly national climate goals translate into visible changes in everyday life." },
  ],
};
