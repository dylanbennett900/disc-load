# DBSP design rules

## DBSP Hub (roster.html) and any DBSP-branded page

Use the **current DBSP visual system**, the one on dbsportperformance.com/guide and /onboarding:

| Token | Hex | Use |
|---|---|---|
| Navy deep | `#0f2235` | Header, tabs, stat tiles, hero blocks |
| Navy | `#1a3a5c` | Secondary dark, headings on light |
| Off-white | `#f4f2ee` | Page background for content |
| Cyan | `#00d4ff` | Primary highlight, CTA buttons, active tab, key numbers |
| Green | `#00e87a` | Data values, done states (one accent per headline: cyan or green, not both) |

Type: Barlow Condensed 900 (headings, uppercase, italic cyan highlight word), DM Sans (body), JetBrains Mono (labels, eyebrows, tags, chips; uppercase, letter-spaced).

**Retired, do not use:** the old editorial look (off-white with navy as the only accent, navy buttons, Barlow labels, no cyan/green, no mono). It was replaced in 2026. If you are restyling or building any DBSP page, copy the `:root` tokens from roster.html, not from older files.

The Frisbee Track app (index.html) keeps its own app theme.
