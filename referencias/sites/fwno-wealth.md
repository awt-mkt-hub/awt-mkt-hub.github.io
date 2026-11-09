# Fwn.o Wealth — MFO AWT

**Slug:** fwno-wealth
**Categoria:** MFO AWT (prioridade alta)

## Identidade Visual

- **Tema:** dark aéreo/natureza
- **Cores:** #1a1a1a ou very dark overlay, #d4a660 (ouro quente), #fff
- **Tipografia:** sans-serif extrabold, headline MUITO grande (5–6 linhas)
- **Tagline:** "Poucos momentos definem o patrimônio de uma vida." — última linha em tom muted

## Layout

- Hero dark com 3D logo "F" lado direito (efeito 3D com CSS/SVG)
- Label "——— MULTI FAMILY OFFICE INDEPENDENTE" em ouro
- Disclaimer texto na base
- Headline 5 linhas, "de uma vida." em cinza/muted (#aaa)

## CSS Patterns

```css
h1 {
  font-size: clamp(2.8rem, 6vw, 5rem);
  font-weight: 900;
  line-height: 1.0;
}
h1 .muted { color: rgba(255,255,255,0.4); }

/* CTA */
.cta-primary { background: #d4a660; color: #111; border-radius: 2rem; padding: 0.8rem 2rem; }
```
