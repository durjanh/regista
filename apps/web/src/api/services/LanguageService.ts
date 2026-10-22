import type { HttpClient } from "../http/HttpClient";

/** Azure AI Translator and Azure AI Speech, through the API. */
export class LanguageService {
  constructor(private readonly http: HttpClient) {}

  translate(texts: string[], to: string) {
    return this.http.post<{ texts: string[]; engine: string }>("/translate", { texts, to });
  }

  /** Spoken audio, or null when Speech isn't configured (HTTP 501): the caller falls back to the browser voice. */
  synthesize(text: string, language: string, persona?: string) {
    return this.http.postBlob("/speech", { text, language, persona });
  }
}
