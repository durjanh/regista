/**
 * What the domain services need from HTTP, and nothing more. Services depend on this interface, not on axios, so the
 * transport can change (or be faked in a test) without touching them.
 */
export interface HttpClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  /** POST returning binary (speech audio). Null when the endpoint answers 501 Not Implemented. */
  postBlob(path: string, body: unknown): Promise<Blob | null>;
  /** Absolute URL of an API path, for clients that can't go over HTTP request/response (EventSource). */
  url(path: string): string;
}
