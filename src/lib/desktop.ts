import { invoke } from "@tauri-apps/api/core";

/** Native operations do not accept AbortSignal; cancel HTTP and reject stale work locally. */
export function invokeWithAbort<T>(command: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) return Promise.reject(new DOMException("Request cancelled", "AbortError"));
  const requestId = crypto.randomUUID();
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      reject(new DOMException("Request cancelled", "AbortError"));
      if (command === "desktop_ai_request") void invoke("cancel_desktop_ai", { requestId }).catch(() => {});
    };
    signal?.addEventListener("abort", abort, { once: true });
    void invoke<T>(command, { ...args, requestId }).then(resolve, (error: unknown) => {
      reject(error instanceof Error ? error : new Error(typeof error === "string" ? error : "桌面请求失败"));
    })
      .finally(() => signal?.removeEventListener("abort", abort));
  });
}
