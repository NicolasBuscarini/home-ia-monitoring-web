/**
 * Evento de UI do download de clipes (T17-G).
 *
 * Usa o emissor do pacote compartilhado sobre a sessão same-origin existente; o servidor deriva
 * ator, sessão, fonte e correlação. A emissão é melhor esforço: nunca bloqueia nem altera o
 * download, e falhas ficam apenas nas estatísticas do emissor.
 */
import { createPlatformEventEmitter, type PlatformEventEmitter } from 'home-ia-shared';

let emitter: PlatformEventEmitter | undefined;

export function emitClipDownload(): void {
  emitter ??= createPlatformEventEmitter({
    fetch: (input, init) => globalThis.fetch(input, init),
  });
  emitter.emit({ eventType: 'ui.action', metadata: { action: 'clip.download' } });
}
