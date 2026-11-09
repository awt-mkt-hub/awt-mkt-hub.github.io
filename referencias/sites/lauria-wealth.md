# Lauria Wealth — MFO brasileiro

**Slug:** lauria-wealth
**Categoria:** MFO brasileiro (referência primária)

## Identidade Visual

- **Tema:** dark hero + light mid sections + dark CTA (híbrido dark/light)
- **Cores:** #0a1628 (navy), #ffffff, #c9a96e (gold accent)
- **Tipografia:** Playfair Display (serif headlines com itálico para palavra-chave) + Inter (body sans)
- **Tagline:** "Multiplique seu patrimônio com gestão profissional, estratégia clara e zero conflito de interesses."

## Layout

Nav transparente sobre dark hero → Trust bar branca → Feature cards brancos → Dark CTA section

## CSS Patterns

```css
/* Hero */
background: linear-gradient(135deg, #0a1628 0%, #1a2f4a 100%);
color: #fff;

/* Headline */
/* serif com <em> em palavra-chave */
font-style: italic; /* em palavra-chave */

/* Labels de seção */
/* "——— NOSSOS DIFERENCIAIS" */
letter-spacing: 0.15em;
text-transform: uppercase;
font-size: 0.75rem;

/* Cards */
border-radius: 2px;
box-shadow: 0 1px 3px rgba(0,0,0,0.08);
padding: 2rem;

/* CTA section */
/* mesma paleta dark do hero, botão outline branco */

/* Espaçamento */
padding-block: 5rem; /* mínimo por seção */
```
