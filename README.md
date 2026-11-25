# AWT Marketing Hub

Painel de Branding da AWT (site estático no GitHub Pages).

| Arquivo | O que é |
|---|---|
| `index.html` | Painel de geração: logo, cartão, papel timbrado, site e foto corporativa, e a publicação |
| `thiago-dashboard.html` | Dashboard do operador: envia arquivos prontos ao onboarding e registra a entrega |
| `js/awt-brand.js` | Contrato com o `awt-onboarding-services`: tipos de arquivo, cliente HTTP, erros, preparo e envio dos arquivos. Sem DOM, roda no browser e no Node |
| `js/awt-publish.js` | Publicar o escritório: pasta no GitHub, deploy no Vercel e entrega ao onboarding. Sem DOM |
| `js/awt-brand-browser.js` | O que só existe no navegador: converter imagem para PNG, SVG→PNG, HTML→PDF |
| `tests/` | Testes dos dois módulos (`npm test`, exige Node 20+, sem dependências) |

## Publicar (um clique)

Na última etapa do painel, **Publicar agora** faz tudo, nesta ordem, e para no primeiro erro mostrando o motivo:

1. **Prepara e confere os arquivos.** Nada é publicado se algum estiver inválido (JPEG/WebP/GIF viram PNG de verdade; logo opaca não
   gera a versão branca).
2. **Pasta no GitHub**, em `awt-mkt-hub/AWT-Onboarding`, com o **nome do escritório** (ex.: `Teste Wealth/`), num único commit:
   `index.html` (site), `logo.svg`, `logo.png`, `logo-branco.png`, `cartao-de-visita.pdf`, `papel-timbrado.pdf`, `foto.png` (quando
   há foto) e `publicacao.json` (guarda o `slug` do escritório). Publicar de novo atualiza a mesma pasta; se já existir uma pasta com
   esse nome de **outro** escritório, a publicação para em vez de sobrescrevê-la.
3. **Deploy no Vercel** (`index.html` + `logo.svg`, projeto `<slug>`); espera o deploy ficar pronto e usa o endereço que o Vercel
   atribuiu.
4. **Entrega ao onboarding** dos mesmos arquivos, já com a URL real do site e o link da pasta. Só parceira que veio da fila
   (tem `partnerId`) é entregue; parceira de teste publica sem entregar.

Antes de começar, o painel avisa o que falta (arquivo não gerado, token do GitHub/Vercel, Integração AWT) e não deixa publicar.
Os tokens do GitHub e do Vercel são digitados na barra lateral e ficam só no `localStorage` do operador. Cada publicação refaz as
quatro etapas (a republicação é segura: a pasta é atualizada e o onboarding recebe a versão seguinte).

## Contrato com o onboarding

Os dois HTMLs falam com o serviço **só** por `js/awt-brand.js`. Regras que o serviço aplica e o painel respeita:

- O tipo do arquivo vem dos **bytes**, não da extensão: um JPEG renomeado para `.png` é recusado (`file_rejected`). O painel converte
  JPEG/WebP/GIF para PNG de verdade antes de enviar.
- A entrega é tudo ou nada: o painel confere os obrigatórios **antes** de pedir qualquer URL de upload, valida todos os arquivos
  antes do primeiro envio e qualquer falha interrompe com o motivo real.
- `operator` é o e-mail dono da chave de integração; os dois andam sempre juntos.
- A versão da entrega é `versaoAtual + 1`, informada pela fila (`GET /internal/brand/queue`), não um contador local.
- Ao mudar as regras de arquivo em `awt-onboarding-services/domain/brand_files.py`, atualize `KINDS` em `js/awt-brand.js`.

## Deploy

### Deste painel (`index.html`, `thiago-dashboard.html`, `js/`)

**Push na `main` publica.** O repositório é um *user site* do GitHub Pages (`https://awt-mkt-hub.github.io/`), construído pelo workflow
padrão `pages-build-deployment`; não há workflow nem `CNAME` no repositório. Verificado em 24/11/2026: o `index.html` no ar era
idêntico ao do `main`, e o site foi atualizado ~40 s depois do push. O CDN responde com `Cache-Control: max-age=600`, então quem já
estava com a página aberta pode levar até 10 minutos para ver a mudança (ou recarregar com Ctrl+F5).

- O repositório é **público** e tudo nele é servido a qualquer pessoa: nada de chave, token ou senha no código.
- A origem `https://awt-mkt-hub.github.io` está liberada em dois lugares do `awt-onboarding-services`: `BRAND_PANEL_ORIGINS` (CORS da API)
  e `deploy/bucket-cors.json` (CORS do bucket de upload). Se o endereço do painel mudar, os dois precisam mudar junto.
- A fonte do Pages (branch e pasta) fica em *Settings → Pages*; ela não está versionada, então confira lá antes de mexer na estrutura.

### Dos sites das parceiras

É o passo 2 e 3 de **Publicar** (acima), feito pelo navegador do operador. O repositório de destino também é público: o que for para
a pasta do escritório (cartão com contatos, papel timbrado, foto) fica visível a qualquer pessoa.

## Rodar local

```bash
python -m http.server 4173      # painel em http://localhost:4173/index.html
```

Para não usar a API real, rode `python dev_server.py` no `awt-onboarding-services` (porta 8082, chave `dev-brand-key`, operador
`thiago@awtgroup.com.br`) e aponte a *Integração AWT* do painel para `http://localhost:8082`.

## Testes

```bash
npm test
```
