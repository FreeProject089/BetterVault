// Les tests sont écrits pour l'application en français. Sans cela, l'application prend la
// langue de la machine (navigator.language) : l'anglais sur les runners GitHub, et les
// messages et emails du serveur arrivent traduits.
if (globalThis.navigator) {
  Object.defineProperty(globalThis.navigator, 'language', { value: 'fr-FR', configurable: true });
  Object.defineProperty(globalThis.navigator, 'languages', { value: ['fr-FR', 'fr'], configurable: true });
}
