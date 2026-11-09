# FTM Wealth — MFO AWT

**Slug:** ftm-wealth
**Categoria:** MFO AWT (prioridade alta)

## Identidade Visual

- **Tema:** dark preto puro (#111) luxury
- **Cores:** #0d0d0b (preto puro), #d4b483 (champagne/ouro), #fff
- **Tipografia:** Cormorant Garamond (serif italic para destaque), nav em ALL CAPS spaced
- **Tagline:** "Patrimônio que atravessa *gerações.*" — última palavra em itálico

## Layout

CENTRALIZADO (texto no centro, não à esquerda)
- Arco decorativo CSS/SVG no lado direito do hero
- Label "MULTI FAMILY OFFICE INDEPENDENTE" centralizado uppercase em ouro
- Stats bar: cards escuros com números grandes em ouro ("R$500k–2M · 10 · 2030")
- Nav: items em ALL CAPS com letter-spacing: 0.1em

## CSS Patterns

```css
body { background: #0d0d0b; color: #f5f0e8; }

/* Hero */
.hero { text-align: center; display: flex; flex-direction: column; align-items: center; }

h1 { font-family: serif; font-size: 4.5rem; font-weight: 400; color: #fff; }
h1 em { font-style: italic; color: #d4b483; }

/* Arco decorativo */
.arch {
  position: absolute; right: 5%;
  width: 300px; height: 400px;
  border: 1px solid rgba(212,180,131,0.3);
  border-radius: 50% 50% 0 0;
  top: 50px;
}

/* Stats */
.stat-card { background: #1a1a17; padding: 1.5rem 2.5rem; border: 1px solid rgba(212,180,131,0.15); }
.stat-num { font-size: 2.5rem; font-weight: 700; color: #d4b483; }

/* CTAs */
.cta-primary { background: #d4b483; color: #0d0d0b; border-radius: 2rem; padding: 0.9rem 2.5rem; }
.cta-secondary { background: transparent; border: 1px solid #d4b483; color: #d4b483; border-radius: 2rem; }
```
