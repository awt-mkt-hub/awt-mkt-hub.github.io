# Áurea Wealth — MFO AWT

**Slug:** aurea-wealth
**Categoria:** MFO AWT (prioridade alta)

## Identidade Visual

- **Tema:** hero CLARO (creme/off-white quente) + seções mid alternadas
- **Cores:** #faf0e0 (creme), #c9962a (ouro), #111
- **Tipografia:** sans-serif bold para headlines, weight 800+, sem serif
- **Tagline:** "Planejamento patrimonial com **visão de longo prazo.**" — última frase em cor ouro

## Layout

- Hero claro com headline lado esquerdo + logo em card ESCURO (preto/ouro) no lado direito
- Stats bar: "30 anos · 6 frentes · Brasil e exterior"
- Label "——— MULTI FAMILY OFFICE INDEPENDENTE" em ouro uppercase
- Seções mid: foto-cards horizontais (Legado, Exterior, Imóveis, Tranquilidade...)
- White card de missão com stats numéricos grandes

## CSS Patterns

```css
body { background: linear-gradient(180deg, #faf0e0 0%, #f5e8cc 100%); }

h1 { color: #111; }
h1 span.gold { color: #c9962a; }

/* Logo card */
.logo-card { background: #111; border-radius: 12px; padding: 2rem; }

/* Stats */
.stats { display: flex; gap: 3rem; margin-top: 2rem; }
.stat-num { font-size: 2rem; font-weight: 800; }

/* Label */
.label { color: #c9962a; letter-spacing: 0.15em; font-size: 0.7rem; text-transform: uppercase; }
```
