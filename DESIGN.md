# DESIGN.md — LintasPeta Design System

Source of truth untuk semua UI. Setiap warna/font/spacing/radius di code harus berasal dari token di sini.

## 1. Konteks

- **Produk**: Map visualizer konsolidasi 3 dataset Jawa Barat (ruas jalan provinsi, sekolah, rambu kelas jalan)
- **Stack**: Vanilla JS ES modules + vanilla CSS (tanpa framework). MapLibre GL v5.11.
- **Mode**: dark (default) + light
- **Audience**: internal pemerintahan (DISHUB), data-dense, akses cepat

## 2. Tokens — Warna

| Role | Dark | Light | CSS Var |
|------|------|-------|---------|
| Background (map area) | `#0F172A` | `#F1F5F9` | `--bg-page` |
| Surface (panel, cards) | `#1E293B` | `#FFFFFF` | `--surface` |
| Surface-2 (input, nested) | `#334155` | `#F8FAFC` | `--surface-2` |
| Surface-3 (hover) | `#475569` | `#F1F5F9` | `--surface-3` |
| Border | `rgba(255,255,255,0.08)` | `#E2E8F0` | `--border` |
| Text primary | `#F8FAFC` | `#0F172A` | `--text-1` |
| Text secondary | `#94A3B8` | `#64748B` | `--text-2` |
| Text muted | `#64748B` | `#94A3B8` | `--text-3` |
| Accent (primary action, focus) | `#2563EB` | `#2563EB` | `--accent` |
| Accent hover | `#3B82F6` | `#1D4ED8` | `--accent-hover` |
| Success | `#22C55E` | `#16A34A` | `--success` |
| Warning | `#F59E0B` | `#D97706` | `--warning` |
| Danger | `#EF4444` | `#DC2626` | `--danger` |

**Data series** (layer peta — konsisten antar mode):
- UPTD-I `#E11D48` · UPTD-II `#2563EB` · UPTD-III `#059669` · UPTD-IV `#7C3AED`
- Jaringan arteri `#EF4444` · kolektor `#F97316` · ruas `#8B5CF6`
- Distance gradient: `#2166AC → #67A9CF → #FDDBC7 → #B2182B`
- N/A gray `#6B7280`

**Aturan**: SATU accent (`#2563EB`). Buang `#38bdf8` cyan dan semua warna ad-hoc. Status colors (success/warning/danger) dipakai hanya untuk makna.

## 3. Typography

- **Font**: `Fira Sans` (UI) + `Fira Code` (angka/data, tabular-nums)
- Google Fonts: `https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600;700&family=Fira+Sans:wght@300;400;500;600;700&display=swap`
- Angka pada stat/distance pakai `font-variant-numeric: tabular-nums`

| Scale | Size | Weight | Use |
|-------|------|--------|-----|
| Display | 20px | 700 | Panel title header |
| Title | 14px | 600 | Section title |
| Body | 13px | 400 | Default |
| Caption | 11px | 400 | Labels, muted text |
| Micro | 10px | 600 uppercase | Section labels (DATA, FILTER) |

## 4. Spacing & Radius

- **Spacing scale**: 4px base — `4/8/12/16/24/32`
- Panel padding: `12px` (body), `14px` (header)
- Card gap: `8px` · Section gap: `16px`
- **Radius**: panel `12px`, card `8px`, button `8px`, input `8px`, chip `6px`
- Shadows: tinted (`0 2px 12px rgba(2,8,23,0.4)` dark / `0 2px 12px rgba(15,23,42,0.08)` light)

## 5. Layout

- **Panel**: absolute `top:12 left:12 width:300` max-height `calc(100vh - 100px)`, flex column, body scrollable
- **Kebab menu**: top-right `top:12 right:12`, 36px, dropdown `top:56 right:12 width:240`
- **Search bar**: top-right `top:12 right:56 width:340`
- **Zoom (MapLibre nav)**: top-right di bawah kebab/search `top:56 right:12`
- **Legend**: absolute `bottom:45 right:12` (dinamis di atas attribution)
- **Attribution**: bottom-right corner, di bawah legend
- **Scale (MapLibre)**: bottom-left
- **Z-index**: map `1` · panel `10` · search `20` · menu `40` · modal/overlay `1000`

## 6. Icons — SVG Only (NO EMOJI)

Emoji 🛣️🏫⚠️ sebagai structural icon DILARANG. Ganti dengan SVG inline (stroke 1.5px, 20px):
- Ruas jalan: `road` (Heroicons)
- Sekolah: `academic-cap`
- Rambu: `exclamation-triangle`
- Kebab: vertical dots `⋮`
- Locate: crosshair/paper-airplane
- Chevron (collapsible): chevron-right, rotate 90° saat open

## 7. States

Semua interaktif wajib: hover (surface-3 / 150ms), active (`scale(0.98)`), focus-visible (2px accent ring), disabled (opacity 0.5). Transisi `150ms ease`.

## 8. Anti-Patterns (dari audit)

- ❌ Emoji sebagai icon navigasi/kontrol
- ❌ Accent warna ad-hoc selain `#2563EB` (buang cyan `#38bdf8`)
- ❌ Font Inter / browser default
- ❌ Legend / zoom / scale berebut space (posisi sudah ditetapkan §5)
- ❌ Uniform radius tanpa hierarki (gunakan §4)
- ❌ Border `#334155` solid tebal → pakai `--border` rgba tipis
