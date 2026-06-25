/// <reference types="vite/client" />

// Augment Vite's ImportMetaEnv with project-specific env vars
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
}

