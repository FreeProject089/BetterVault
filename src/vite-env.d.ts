/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BETTERVAULT_SERVER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module 'virtual:bettervault-icons/simple' {
  /** [slug, titre, couleur hexadécimale, tracé SVG] */
  const rows: Array<[string, string, string, string]>;
  export default rows;
}

declare module 'virtual:bettervault-icons/brands' {
  /** Logos des gestionnaires de mots de passe : [slug, titre, couleur hexadécimale, tracé SVG] */
  const rows: Array<[string, string, string, string]>;
  export default rows;
}

declare module 'virtual:bettervault-icons/phosphor' {
  /** [nom, mots-clés, contenu SVG] */
  const rows: Array<[string, string, string]>;
  export default rows;
}
