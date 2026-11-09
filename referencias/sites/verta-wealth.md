# Verta Wealth — MFO AWT

**Slug:** verta-wealth
**Categoria:** MFO AWT (prioridade alta)

## Identidade Visual

- **Tema:** dark forest green ao longo de TODO o site
- **Cores:** #0d1f17 (verde floresta), #4ecbb4 (teal accent), #fff
- **Tipografia:** sans-serif bold (Inter/Montserrat), display muito grande
- **Tagline:** "Seu patrimônio, / com método." — headline dividida, linha 2 em teal

## Layout

- Hero dark com 3D logo "V" no lado direito + "ARRASTE PARA GIRAR"
- Label "MULTI FAMILY OFFICE INDEPENDENTE" uppercase
- Disclaimer box semi-transparente na base do hero
- Seções: dark throughout
- Cards de especialidades como carrossel horizontal com fotos natureza + pill tags

## CSS Patterns

```css
body { background: #0d1f17; color: #fff; }

/* Headline dividida */
h1 { color: #fff; }
h1 span.accent { color: #4ecbb4; }

/* Cards de especialidades */
.card { border-radius: 16px; overflow: hidden; position: relative; }

/* Tags pill */
.tag {
  background: rgba(255,255,255,0.15);
  border-radius: 20px;
  padding: 4px 12px;
  font-size: 0.75rem;
}
```
