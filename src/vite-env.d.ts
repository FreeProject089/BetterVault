/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BETTERVAULT_SERVER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
