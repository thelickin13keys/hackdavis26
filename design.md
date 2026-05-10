# SafePath Design Guidelines
### Uber-inspired Design Language — v1.0

---

## Philosophy

> Functional, dark, data-forward. The map is the product — the UI gets out of the way.

1. Dark backgrounds. The map always reads first.
2. Color = status only. Never decorative.
3. Cards surface above the map — never compete with it.
4. One action per screen. One primary button, always bottom-anchored.
5. Information density is high. Typography carries the weight.

---

## Color System

### Base

| Token | Hex | Usage |
|---|---|---|
| `color-bg-base` | `#000000` | App background, map overlay |
| `color-bg-surface` | `#1A1A1A` | Cards, bottom sheets, panels |
| `color-bg-elevated` | `#242424` | Inputs, secondary cards |
| `color-bg-subtle` | `#2E2E2E` | Dividers, hover states |
| `color-text-primary` | `#FFFFFF` | Headings, primary content |
| `color-text-secondary` | `#ABABAB` | Labels, metadata, captions |
| `color-text-disabled` | `#525252` | Inactive states |
| `color-border` | `#333333` | Card borders, input borders |

### Accent / Status

| Token | Hex | Usage |
|---|---|---|
| `color-safe` | `#06C167` | Safe route, success, confirmed |
| `color-caution` | `#F5A623` | Caution route, warning |
| `color-danger` | `#E83B3B` | Avoid route, error, critical |
| `color-info` | `#4A90D9` | Info states, links |
| `color-white-action` | `#FFFFFF` | Primary CTA background |

### Rules
- Never use accent colors for decoration. Green = safe. Orange = caution. Red = danger. That's it.
- Primary CTA is always white background + black text on dark surfaces.
- Avoid placing two accent colors adjacent to each other.
- No tints or opacity variants — use the flat hex.

---

## Typography

Font stack: `"Uber Move", Inter, -apple-system, sans-serif`

| Role | Size | Weight | Color |
|---|---|---|---|
| Display | 28px | 700 | `#FFFFFF` |
| Heading 1 | 22px | 700 | `#FFFFFF` |
| Heading 2 | 17px | 600 | `#FFFFFF` |
| Heading 3 | 15px | 600 | `#FFFFFF` |
| Body | 14px | 400 | `#FFFFFF` |
| Label | 12px | 500 | `#ABABAB` |
| Caption | 11px | 400 | `#ABABAB` |
| Overline | 10px | 600 | `#ABABAB` — uppercase, +0.08em tracking |

### Rules
- Headings are sentence case — never all-caps in product UI.
- Line height: 1.3 for headings, 1.6 for body.
- No italic. No underline except interactive links.
- Letter spacing: default for all sizes except overline.

---

## Grid & Spacing

**Base unit:** 8px

| Token | Value | Usage |
|---|---|---|
| `space-1` | 4px | Icon gaps, tight padding |
| `space-2` | 8px | Component internal padding |
| `space-3` | 16px | Between related elements |
| `space-4` | 24px | Card padding, section gaps |
| `space-5` | 32px | Between major sections |
| `space-6` | 48px | Screen-level breathing room |

- Mobile-first. Design for 390px width, scale up.
- Bottom sheets start at 40% screen height, expand to 80%.
- Safe area insets respected on all mobile targets.
- Map occupies 100% of screen. UI layers float above it.

---

## Elevation & Surfaces

Three surface levels — no shadows, separation via background color only.

| Level | Background | Usage |
|---|---|---|
| Base | `#000000` | Map backdrop, screen bg |
| Surface | `#1A1A1A` | Bottom sheets, panels, cards |
| Elevated | `#242424` | Inputs, nested cards, dropdowns |

- Border: `1px solid #333333` on all cards and inputs.
- Border-radius: `12px` on cards and bottom sheets, `8px` on inputs and buttons, `999px` on pills/tags.
- No drop shadows.

---

## Components

### Primary button

```
background:    #FFFFFF
color:         #000000
font-size:     15px
font-weight:   600
border-radius: 8px
padding:       14px 24px
width:         100% (mobile) / auto (desktop)
border:        none
```

- One per screen. Always bottom-anchored on mobile.
- Hover: background `#F0F0F0`.
- Disabled: background `#2E2E2E`, color `#525252`.

### Secondary button

```
background:    transparent
color:         #FFFFFF
border:        1px solid #333333
font-size:     15px
font-weight:   600
border-radius: 8px
padding:       14px 24px
```

### Input field

```
background:    #242424
color:         #FFFFFF
border:        1px solid #333333
border-radius: 8px
font-size:     15px
padding:       14px 16px
```

- Focus: border-color `#FFFFFF`.
- Error: border-color `#E83B3B` + red caption below.
- Placeholder: color `#525252`.

### Cards

```
background:    #1A1A1A
border:        1px solid #333333
border-radius: 12px
padding:       16px
```

- Use for route options, trip details, street view previews.
- Active/selected card: border-color `#06C167`, 2px.

### Bottom sheet

```
background:    #1A1A1A
border-radius: 16px 16px 0 0
border-top:    1px solid #333333
padding:       20px 24px
```

- Drag handle: 4px × 32px, `#333333`, centered, `border-radius: 999px`, 8px from top.
- Minimum height: 40vh. Maximum: 85vh.

### Route segment tags

| State | Background | Text | Usage |
|---|---|---|---|
| Safe | `#06C167` | `#000` | Low risk route |
| Caution | `#F5A623` | `#000` | Moderate risk |
| Danger | `#E83B3B` | `#fff` | Avoid |

- Padding: 4px 10px. Border-radius: 999px. Font: 11px / 600 / sentence case.

### Map route lines

| State | Color | Width |
|---|---|---|
| Safe | `#06C167` | 5px |
| Caution | `#F5A623` | 5px |
| Danger | `#E83B3B` | 5px |
| Inactive | `#525252` | 3px |

---

## Iconography

- Outline icons (Tabler Icons or Phosphor).
- Size: 20px standard, 24px in headers, 16px in labels.
- Color: `#FFFFFF` primary, `#ABABAB` secondary/inactive.
- Icon + label gap: 8px always.
- No icon-only buttons without an accessible label.

---

## SafePath-Specific Patterns

### Route card

Displays a single route option in the bottom sheet.

```
[Route card]
  Top row:    route name (heading 3)  +  safety score badge (right-aligned)
  Mid row:    distance · ETA · safety level  (label, secondary color)
  Bottom row: "Start route" button (primary, full width)
  Border:     1px #333 default / 2px #06C167 if selected
```

### Street view panel

Side panel or bottom sheet section showing streamed AI analysis.

```
[Street view panel]
  Image frame:   16:9, border-radius 8px, bg #242424 while loading
  Analysis tags: row of route segment tags below image
  Description:   body text, secondary color, 2-line max
  Stream state:  skeleton shimmer on #242424 while AI is processing
```

### Risk toggle

```
[Toggle row]
  Label:   "Cautious mode"  (heading 3)
  Sub:     "Avoids unlit and low-traffic roads"  (caption)
  Toggle:  right-aligned, active color #06C167
```

### Safety score indicator

Inline badge on route cards and map callouts.

```
0–40    → Danger   #E83B3B
41–70   → Caution  #F5A623
71–100  → Safe     #06C167
```

---

## Motion

- Transitions: `200ms ease-out` for state changes (hover, focus, toggle).
- Bottom sheet entry: `300ms ease-out` slide up.
- Route line draw: animate stroke-dashoffset over `500ms ease-in-out`.
- No bouncing, spring, or decorative animations.
- Respect `prefers-reduced-motion` — disable all transitions if set.

---

## Do / Don't

| Do | Don't |
|---|---|
| Dark surfaces everywhere | Light mode components on dark screens |
| Color = status only | Green buttons just because they look good |
| One primary CTA per screen | Two white buttons competing |
| Cards float with 1px border | Cards with drop shadows |
| Sentence case labels | ALL CAPS UI text |
| Skeleton loading states | Spinners blocking the full screen |
| Map always visible behind UI | Full-screen UI hiding the map |