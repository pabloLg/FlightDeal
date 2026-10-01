// Minimal JSON transport shared by the API sources, injectable so tests run
// offline against fixtures. The HTTP status is returned on purpose: quota, auth
// and billing failures must be told apart from a real payload so the caller can
// degrade fail-closed instead of parsing an error body into "no flights".
export interface JsonRequest {
  url: string;
  method: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
}

export interface JsonResponse {
  status: number;
  body: string;
}

export type JsonFetcher = (request: JsonRequest) => Promise<JsonResponse>;

// Per-request cap so a stalled API cannot eat the invocation: without it a
// hanging SerpAPI/Ignav response ran the tick past the platform's 60 s and the
// execution was killed with nothing recorded.
const REQUEST_TIMEOUT_MS = 10_000;

export const httpJsonFetcher: JsonFetcher = async (request) => {
  const response = await fetch(request.url, {
    method: request.method,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    ...(request.headers ? { headers: request.headers } : {}),
    ...(request.body ? { body: request.body } : {}),
  });
  return { status: response.status, body: await response.text() };
};

export function parseJson(body: string): unknown | null {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}
