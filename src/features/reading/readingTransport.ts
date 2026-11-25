import { invokeWithAbort } from "../../lib/desktop";

type ReadingSourceResponse = { status: number; body: string; contentType: string };

/** Packaged windows do not have Vite's /api server; native HTTP uses the system proxy. */
export async function fetchDesktopReadingSource(source: string, url: string, signal?: AbortSignal): Promise<Response> {
  const result = await invokeWithAbort<ReadingSourceResponse>("reading_source", { source, url }, signal);
  return new Response([204, 205, 304].includes(result.status) ? null : result.body, {
    status: result.status,
    headers: { "content-type": result.contentType },
  });
}
