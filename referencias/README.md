# Referências Visuais — AWT Branding

Pasta de referências utilizadas pelo Painel de Branding para geração via Claude AI.

## Estrutura

| Pasta | Conteúdo |
|-------|----------|
| `sites/` | Descrições de referências visuais para geração de sites |
| `logos/` | Exemplos e diretrizes de logos |
| `cards/` | Exemplos de cartões de visitas |
| `fotos/` | Referências de foto corporativa |

## Como usar

Cada arquivo `.md` em `sites/` descreve um site de referência com tema, cores, tipografia e padrões CSS.
O painel lê esses arquivos e injeta as descrições no prompt de geração do site institucional via `pickRefs(5)`.

## Adicionar nova referência

Crie um arquivo `.md` em `referencias/sites/` com o formato:

```
REFERÊNCIA: nome-slug (Nome do Site — descrição breve)
Tema: ...
Cores: #hex1, #hex2
Tipografia: ...
Layout: ...
CSS Pattern:
  - propriedade: valor
```

Depois atualize a constante `SITE_REFS` no `index.html` com o conteúdo do novo arquivo.
