# home-ia-monitoring-web

Microfrontend React/TypeScript do módulo **Monitoramento** do Home IA. Este repositório é um remote de Module Federation exposto como `./MonitoringModule`; o shell do portal (`garage-watch-web` nesta fase) fornece sessão, navegação, tema, idioma e o container visual.

## Contrato exposto

`src/MonitoringModule.tsx` exporta um componente com:

- `locale`: locale ativo no shell.
- `cameras`: coleção de câmeras autorizadas pelo shell.
- `selectedCameraId` e `onCameraSelect`.
- `userRole`: papel atual.
- `portalModuleIds`: módulos autorizados pelo portal.

O remote não autentica, não decide autorização, não lê cookie de sessão e não recebe segredo, mídia ou embedding. As chamadas HTTP usam a mesma origem do shell e são revalidadas pela API.

## Desenvolvimento e verificação

A partir da raiz do repositório de contexto:

```bash
./garage verify-monitoring-web
./garage format-monitoring-web
./garage lock-monitoring-web
```

O Compose fixa Node por digest; `npm ci`, Biome, Vitest e build Vite rodam no container. O build gera `remoteEntry.js` e o exposto `MonitoringModule`.

O remote contém o código canônico de monitoramento (dashboard, player HLS, clipes, painéis administrativos, triagem de identidade e operações). A triagem em Gestão→Pessoas lista observações minimizadas, candidatos e histórico, e permite confirmar, rejeitar, marcar inconclusivo ou associar pessoa ativa; a decisão é sempre autorizada pela API e nunca renderiza imagem, recorte ou embedding. Logo abaixo, a **calibração de reconhecimento** ajusta limiar/margem com métricas recalculadas na amostra revisada, grava rascunho versionado e exige promoção/reversão explícitas; a tela recebe apenas histogramas agregados, nunca imagem, embedding ou identificador de observação. i18n, tema, HTTP, tipos, StatusBadge e CSS global vêm de `home-ia-shared`, compartilhado como singleton; não há cópia local desses módulos. O shell carrega o CSS global e o remote usa as mesmas classes.

## Limites

- Não é um serviço de produção, não tem autenticação própria e não deve ser publicado fora do loopback sem ADR.
- O remote depende do shell para sessão, autorização, tema, idioma e CSS.
- A validação atual cobre build/testes do remote, build/testes do shell host e o ensaio `./garage test-federation-web` em Chromium com axe/teclado. Inspeção visual manual em dispositivos e CT02 continuam separados.
- Nenhum dado de câmera, NAS ou usuário é versionado aqui.
