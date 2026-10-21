/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Public URL of the Regista API (https://...), set at build time for Azure Static Web Apps; empty locally. */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
