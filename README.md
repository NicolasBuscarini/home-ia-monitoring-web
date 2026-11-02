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

O remote contém o código canônico de monitoramento (dashboard, player HLS, clipes, painéis administrativos, operações e i18n local). A duplicação de utilitários/estilos em relação ao shell é uma limitação desta fase; o shell carrega o CSS global e o remote usa as mesmas classes. A extração de um pacote compartilhado definitivo e a renomeação do shell pertencem ao restante de `T16-D`/`T16-F`.

## Limites

- Não é um serviço de produção, não tem autenticação própria e não deve ser publicado fora do loopback sem ADR.
- O remote depende do shell para sessão, autorização, tema, idioma e CSS.
- A validação atual cobre build/testes do remote e build/testes do shell host; o carregamento federado em browser real ainda precisa de ensaio manual.
- Nenhum dado de câmera, NAS ou usuário é versionado aqui.
