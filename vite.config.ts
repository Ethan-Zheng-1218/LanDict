import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fetch as proxyFetch, ProxyAgent } from "undici";
import type { Plugin } from "vite";
import { isChineseWord, queryEcdictLookup, queryEcdictReverse, queryWordFamily } from "./server/ecdict";
import { lookupLemmas, lookupWords, reverseLookup, suggestDictionaryWords } from "./server/dictionaryLookup";
import { queryMerriamWebsterPronunciation } from "./server/merriamWebster";
import { queryOxfordPronunciation, queryOxfordUsage } from "./server/oxford";
import { selectPrimaryPronunciation } from "./src/lib/phonetics";
import { SOURCE_ENDPOINTS, type ExternalArticleSource } from "./src/features/reading/newsSources";

const sourceDir = decodeURIComponent(new URL("./src", import.meta.url).pathname)
  .replace(/^\/([A-Za-z]:\/)/, "$1");

/** A notebook is small, but a runaway query string still should not reach the SQLite layer. */
const MAX_WORD_FAMILY_QUERY_WORDS = 400;

/** 策略层一次会发来「原词加全部候选原形」，给一个上限挡住异常请求。 */
const MAX_LOOKUP_WORDS = 60;

/**
 * 有道的英美音标。只在「牛津对美式只给半截」或美式空缺时才问一次（约 3%~6% 的词），
 * 所以顺手在内存里缓存；浏览器直连会被 403 + 无 CORS 挡掉，必须由这里中转。
 */
const youdaoIpaCache = new Map<string, { usphone: string; ukphone: string }>();

async function queryYoudaoIpa(word: string): Promise<{ usphone: string; ukphone: string }> {
  const response = await fetch(`https://dict.youdao.com/jsonapi?q=${encodeURIComponent(word)}`, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return { usphone: "", ukphone: "" };
  const payload = (await response.json()) as { ec?: { word?: { usphone?: unknown; ukphone?: unknown }[] } };
  const entry = Array.isArray(payload.ec?.word) ? payload.ec.word[0] : undefined;
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  return { usphone: text(entry?.usphone), ukphone: text(entry?.ukphone) };
}

const ENGLISH_WORD = /^[a-zA-Z]+(?:[-'][a-zA-Z]+)*$/;
const ENGLISH_DICTIONARY_QUERY = /^[a-zA-Z]+(?:[-'][a-zA-Z]+)*(?: +[a-zA-Z]+(?:[-'][a-zA-Z]+)*){0,5}$/;
const HAN_TERM = /^[\p{Script=Han}]{1,12}$/u;

function localDictionaryPlugin(): Plugin {
  async function readBody(request: any): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString("utf8");
  }

  async function middleware(request: any, response: any, next: () => void) {
    const url = new URL(request.url ?? "/", "http://localhost");

    if (url.pathname === "/api/dictionary-suggest") {
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      if (request.method !== "POST") { response.statusCode = 405; response.end("{}"); return; }
      try {
        const body = JSON.parse(await readBody(request));
        const prefix = typeof body.prefix === "string" ? body.prefix : "";
        const words = Array.isArray(body.words) ? body.words.filter((word: unknown): word is string => typeof word === "string").slice(0, 2000) : [];
        response.end(JSON.stringify({ words: await suggestDictionaryWords(prefix, words) }));
      } catch { response.statusCode = 500; response.end(JSON.stringify({ words: [] })); }
      return;
    }

    if (url.pathname === "/api/youdao-dictionary") {
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      const word = (url.searchParams.get("word") ?? "").trim();
      if (request.method !== "GET" || word.length > 80 || (!ENGLISH_DICTIONARY_QUERY.test(word) && !HAN_TERM.test(word))) {
        response.statusCode = 400;
        response.end(JSON.stringify({ error: "invalid word" }));
        return;
      }
      try {
        const upstream = await fetch(`https://dict.youdao.com/jsonapi?q=${encodeURIComponent(word)}`, {
          headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(4000),
        });
        if (!upstream.ok) throw new Error("Youdao unavailable");
        const { ec, ce, phrs, blng_sents_part } = await upstream.json();
        response.end(JSON.stringify({ ec, ce, phrs, blng_sents_part }));
      } catch {
        response.statusCode = 502;
        response.end(JSON.stringify({ error: "online dictionary unavailable" }));
      }
      return;
    }

    // 策略层专用的批量查询：一次拿回「原词加候选原形」在牛津与精简 ECDICT 里的命中。
    if (
      url.pathname === "/api/dictionary-lookup"
      || url.pathname === "/api/dictionary-reverse"
      || url.pathname === "/api/dictionary-lemmas"
    ) {
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      if (request.method !== "POST") {
        response.statusCode = 405;
        response.end(JSON.stringify({ error: "method not allowed" }));
        return;
      }
      try {
        const body = JSON.parse(await readBody(request)) as { words?: unknown; term?: unknown };
        if (url.pathname === "/api/dictionary-lemmas") {
          const words = (Array.isArray(body.words) ? body.words : [])
            .filter((word): word is string => typeof word === "string" && ENGLISH_WORD.test(word.trim()))
            .slice(0, MAX_LOOKUP_WORDS);
          response.end(JSON.stringify({ lemmas: await lookupLemmas(words) }));
          return;
        }
        if (url.pathname === "/api/dictionary-lookup") {
          const words = (Array.isArray(body.words) ? body.words : [])
            .filter((word): word is string => typeof word === "string" && ENGLISH_WORD.test(word.trim()))
            .slice(0, MAX_LOOKUP_WORDS);
          if (!words.length) {
            response.statusCode = 400;
            response.end(JSON.stringify({ error: "invalid words" }));
            return;
          }
          response.end(JSON.stringify({ hits: await lookupWords(words) }));
          return;
        }
        const term = typeof body.term === "string" ? body.term.trim() : "";
        if (!HAN_TERM.test(term)) {
          response.statusCode = 400;
          response.end(JSON.stringify({ error: "invalid term" }));
          return;
        }
        response.end(JSON.stringify({ hits: await reverseLookup(term) }));
      } catch {
        response.statusCode = 500;
        response.end(JSON.stringify({ error: "dictionary lookup unavailable" }));
      }
      return;
    }

    // 有道的音标补全：牛津给不出完整美式写法时才会走到这里。
    if (url.pathname === "/api/youdao-ipa") {
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      const word = (url.searchParams.get("word") ?? "").trim().toLowerCase();
      if (!ENGLISH_WORD.test(word)) {
        response.statusCode = 400;
        response.end(JSON.stringify({ usphone: "", ukphone: "" }));
        return;
      }
      const cached = youdaoIpaCache.get(word);
      if (cached) {
        response.end(JSON.stringify(cached));
        return;
      }
      try {
        const result = await queryYoudaoIpa(word);
        youdaoIpaCache.set(word, result);
        response.end(JSON.stringify(result));
      } catch {
        response.statusCode = 502;
        response.end(JSON.stringify({ usphone: "", ukphone: "" }));
      }
      return;
    }

    if (url.pathname === "/api/word-family") {
      const words = (url.searchParams.get("words") ?? "")
        .split(",")
        .map((word) => word.trim())
        .filter(Boolean)
        .slice(0, MAX_WORD_FAMILY_QUERY_WORDS);
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      try {
        const families: Record<string, string[]> = {};
        for (const word of words) {
          // A word ECDICT cannot place is still answered, so the reading view stops asking for it.
          families[word.toLowerCase()] = queryWordFamily(word)?.forms ?? [];
        }
        response.end(JSON.stringify({ families }));
      } catch {
        response.statusCode = 500;
        response.end(JSON.stringify({ error: "word family unavailable" }));
      }
      return;
    }

    if (url.pathname !== "/api/local-dictionary") return next();
    const word = url.searchParams.get("word")?.trim() ?? "";
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    if (!/^[a-zA-Z]+(?:[-'][a-zA-Z]+)*$/.test(word) && !isChineseWord(word)) {
      response.statusCode = 400;
      response.end(JSON.stringify({ error: "invalid word" }));
      return;
    }
    try {
      if (isChineseWord(word)) {
        response.end(JSON.stringify({ entries: queryEcdictReverse(word) }));
        return;
      }
      const lookup = queryEcdictLookup(word);
      const resolvedWord = lookup?.entry.word ?? word;
      response.end(JSON.stringify({
        entry: lookup?.entry ?? null,
        resolvedWord: lookup?.resolvedWord,
        britishPhonetic: selectPrimaryPronunciation(lookup?.entry.phonetic),
        oxfordPronunciation: queryOxfordPronunciation(resolvedWord),
        oxford: queryOxfordUsage(resolvedWord),
        merriamWebster: queryMerriamWebsterPronunciation(resolvedWord),
      }));
    } catch {
      response.statusCode = 500;
      response.end(JSON.stringify({ error: "dictionary unavailable" }));
    }
  }

  return {
    name: "landict-local-dictionaries",
    configureServer(server) { server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(middleware); },
  };
}

/**
 * The AI provider is configured in the browser, but OpenAI-compatible endpoints do not send CORS
 * headers, so the dev server relays the chat completion request. Direct requests are still used
 * outside the local dev origin (for example inside the Tauri shell).
 */
function aiProxyPlugin(): Plugin {
  const aiHttpProxy = process.env.AI_HTTP_PROXY ?? process.env.BBC_HTTP_PROXY ?? "http://127.0.0.1:7897";
  const aiProxyAgent = new ProxyAgent(aiHttpProxy);

  async function readBody(request: any): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString("utf8");
  }

  async function middleware(request: any, response: any, next: () => void) {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== "/api/ai-translate") return next();
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    if (request.method !== "POST") {
      response.statusCode = 405;
      response.end(JSON.stringify({ error: "method not allowed" }));
      return;
    }
    try {
      const body = JSON.parse(await readBody(request)) as {
        baseUrl?: unknown; apiKey?: unknown; model?: unknown; messages?: unknown;
      };
      const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() : "";
      const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
      const model = typeof body.model === "string" ? body.model.trim() : "";
      const messages = Array.isArray(body.messages) ? body.messages : [];
      const endpoint = new URL(`${baseUrl.replace(/\/+$/, "")}/chat/completions`);
      if ((endpoint.protocol !== "http:" && endpoint.protocol !== "https:") || !apiKey || !model || !messages.length) {
        response.statusCode = 400;
        response.end(JSON.stringify({ error: "baseUrl / apiKey / model / messages are required" }));
        return;
      }
      const init = {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages, temperature: 0.2 }),
      };
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);
      let upstream: Awaited<ReturnType<typeof proxyFetch>>;
      try {
        upstream = await proxyFetch(endpoint.href, { ...init, signal: controller.signal });
      } catch {
        upstream = await proxyFetch(endpoint.href, { ...init, signal: controller.signal, dispatcher: aiProxyAgent });
      } finally {
        clearTimeout(timeout);
      }
      response.statusCode = upstream.status;
      response.end(await upstream.text());
    } catch (error) {
      response.statusCode = 502;
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : "AI upstream unavailable" }));
    }
  }

  return {
    name: "landict-ai-proxy",
    configureServer(server) { server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(middleware); },
  };
}

function readingSourceProxyPlugin(): Plugin {
  const sourceHttpProxy = process.env.READING_HTTP_PROXY ?? process.env.BBC_HTTP_PROXY ?? "http://127.0.0.1:7897";
  const sourceProxyAgent = new ProxyAgent(sourceHttpProxy);

  async function fetchWithTimeout(input: string, timeoutMs: number) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await proxyFetch(input, { signal: controller.signal, dispatcher: sourceProxyAgent });
    } finally {
      clearTimeout(timeout);
    }
  }

  async function middleware(request: any, response: any, next: () => void) {
    const url = new URL(request.url ?? "/", "http://localhost");
    const isLegacyFeed = url.pathname === "/api/bbc-feed";
    const legacyArticleUrl = url.pathname === "/api/bbc-article" ? url.searchParams.get("url") : null;
    const isGenericSource = url.pathname === "/api/reading-source";
    const sourceName = (url.searchParams.get("source") ?? "") as ExternalArticleSource;
    const genericUrl = isGenericSource ? url.searchParams.get("url") : null;
    const ipaWord = url.pathname === "/api/ipa-pronunciation" ? url.searchParams.get("word")?.trim() ?? "" : null;
    if (!isLegacyFeed && !legacyArticleUrl && !isGenericSource && ipaWord === null) return next();
    try {
      if (ipaWord !== null) {
        if (!/^[a-zA-Z]+(?:[-'][a-zA-Z]+)*$/.test(ipaWord)) {
          response.statusCode = 400;
          response.end(JSON.stringify({ error: "invalid word" }));
          return;
        }
        const pronunciationUrl = `https://en.wiktionary.org/w/api.php?action=parse&page=${encodeURIComponent(ipaWord)}&prop=wikitext&format=json&origin=*`;
        const upstream = await fetchWithTimeout(pronunciationUrl, 12000);
        response.statusCode = upstream.status;
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.end(await upstream.text());
        return;
      }
      const source = isLegacyFeed || legacyArticleUrl ? "bbc" : sourceName;
      const target = isLegacyFeed ? SOURCE_ENDPOINTS.bbc.feedUrls[0] : legacyArticleUrl ?? genericUrl;
      if (!target || !Object.hasOwn(SOURCE_ENDPOINTS, source)) {
        response.statusCode = 400;
        response.end("unsupported reading source request");
        return;
      }
      const parsed = new URL(target);
      const config = SOURCE_ENDPOINTS[source];
      const isFeedTarget = config.feedUrls.includes(target);
      const isArticleTarget = config.articleHosts.includes(parsed.hostname) && config.articlePath.test(parsed.pathname);
      if ((!isFeedTarget && !isArticleTarget) || (isGenericSource && !config.feedUrls.includes(target) && !isArticleTarget)) {
        response.statusCode = 400;
        response.end("unsupported reading source URL");
        return;
      }
      const upstream = await fetchWithTimeout(target, isFeedTarget ? 15000 : 12000);
      response.statusCode = upstream.status;
      response.setHeader("Content-Type", upstream.headers.get("content-type") ?? (isFeedTarget ? "application/xml; charset=utf-8" : "text/html; charset=utf-8"));
      response.end(await upstream.text());
    } catch {
      response.statusCode = 502;
      response.end("reading source upstream unavailable");
    }
  }
  return {
    name: "landict-reading-source-proxy",
    configureServer(server) { server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(middleware); },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), localDictionaryPlugin(), aiProxyPlugin(), readingSourceProxyPlugin()],
  // Rust build executables are locked while compiling on Windows; Vite only needs frontend files.
  // data/phrase-ai 是本地模型跑词组库时的进度文件，每处理一条就写一次；
  // 不忽略的话 dev server 的 watcher 会被它刷爆，模块转换会慢到几秒一个。
  server: { watch: { ignored: ["**/src-tauri/target/**", "**/data/phrase-ai/**"] } },
  resolve: {
    alias: {
      "@": sourceDir,
    },
  },
  clearScreen: false,
  test: {
    // Downloaded tools and captured browser profiles are not LanDict test sources.
    exclude: [...configDefaults.exclude, ".superpowers/**"],
    environment: "jsdom",
    environmentOptions: {
      jsdom: { url: "http://localhost/" },
    },
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
  },
});
