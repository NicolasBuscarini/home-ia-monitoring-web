# Instruções do projeto home-ia-monitoring-web

## Fronteiras

- Repositório independente do microfrontend de Monitoramento do Home IA. `../../docs/` no repositório de contexto é a autoridade de produto, segurança e arquitetura.
- O shell do portal (`garage-watch-web` nesta fase) é dono de sessão, autorização, navegação, tema, idioma e CSS global. Este remote não autentica, não decide autorização e não recebe segredo, cookie, mídia ou embedding.
- A API continua autoridade de câmera, clipes, health e mídia. O remote apenas apresenta dados e envia comandos autorizados.
- O contrato exposto é `./MonitoringModule` com `locale`, `cameras`, `selectedCameraId`, `onCameraSelect`, `userRole` e `portalModuleIds`.

## Engenharia

- React + TypeScript, Vite, HLS.js local; Module Federation via `@module-federation/vite`.
- Não adicionar CDN, backend paralelo ou autorização no cliente. Não expor chaves, RTSP, NAS ou dados pessoais no bundle.
- Componentes devem manter acessibilidade, teclado/foco, responsividade e estados de loading/vazio/erro.
- O CSS global pertence ao shell nesta fase; o remote usa as mesmas classes e não deve depender de estilos próprios não documentados.
- Testes com Vitest/Testing Library cobrem o contrato do módulo e o estado vazio; o ensaio federado em browser é separado.
- Fixar Node/dependências e rodar verificações por Compose a partir da raiz (`./garage`).

## Verificações

- `./garage verify-monitoring-web`, `./garage format-monitoring-web` e `./garage lock-monitoring-web`.
- Não iniciar/parar captura real, não publicar o remote fora do loopback e não alterar segredos sem autorização operacional.
