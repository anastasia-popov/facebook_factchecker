---
name: Premium SaaS Minimalist
colors:
  surface: '#f7f9fb'
  surface-dim: '#d8dadc'
  surface-bright: '#f7f9fb'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f4f6'
  surface-container: '#eceef0'
  surface-container-high: '#e6e8ea'
  surface-container-highest: '#e0e3e5'
  on-surface: '#191c1e'
  on-surface-variant: '#45474c'
  inverse-surface: '#2d3133'
  inverse-on-surface: '#eff1f3'
  outline: '#75777d'
  outline-variant: '#c5c6cd'
  surface-tint: '#545f73'
  primary: '#091426'
  on-primary: '#ffffff'
  primary-container: '#1e293b'
  on-primary-container: '#8590a6'
  inverse-primary: '#bcc7de'
  secondary: '#505f76'
  on-secondary: '#ffffff'
  secondary-container: '#d0e1fb'
  on-secondary-container: '#54647a'
  tertiary: '#1e1200'
  on-tertiary: '#ffffff'
  tertiary-container: '#35260c'
  on-tertiary-container: '#a38c6a'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d8e3fb'
  primary-fixed-dim: '#bcc7de'
  on-primary-fixed: '#111c2d'
  on-primary-fixed-variant: '#3c475a'
  secondary-fixed: '#d3e4fe'
  secondary-fixed-dim: '#b7c8e1'
  on-secondary-fixed: '#0b1c30'
  on-secondary-fixed-variant: '#38485d'
  tertiary-fixed: '#fadfb8'
  tertiary-fixed-dim: '#ddc39d'
  on-tertiary-fixed: '#271902'
  on-tertiary-fixed-variant: '#564427'
  background: '#f7f9fb'
  on-background: '#191c1e'
  surface-variant: '#e0e3e5'
typography:
  headline-lg:
    fontFamily: Manrope
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Manrope
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Manrope
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Manrope
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Manrope
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-caps:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  container-max: 1200px
  gutter: 24px
  margin-mobile: 16px
  margin-desktop: 48px
  stack-sm: 8px
  stack-md: 16px
  stack-lg: 32px
---

## Brand & Style

The brand personality is authoritative yet approachable, focusing on clarity, precision, and high-end utility. The target audience includes professionals and enterprise users who value efficiency and a distraction-free environment. 

The design style is **Minimalism with a Corporate Modern twist**. It leverages heavy whitespace to reduce cognitive load and emphasizes quality typography to guide the user's eye. The emotional response should be one of "calm confidence"—the interface stays out of the way, signaling that the system is powerful, reliable, and currently performing sophisticated work in the background.

## Colors

The palette is intentionally restrained to maintain a "Premium SaaS" aesthetic. 

- **Primary (Slate-800):** Used for the magnifying glass elements, primary text, and key branding icons. It provides the grounding weight for the interface.
- **Secondary (Slate-500):** Used for secondary text and supporting icons to create a clear hierarchy.
- **Neutral (Slate-50):** The primary background color. It is softer than pure white, reducing eye strain while maintaining a clean, expansive feel.
- **Accent (Blue-500):** Reserved for subtle progress indicators or success states to provide a professional "tech" touch without overwhelming the monochromatic base.

## Typography

This design system uses **Manrope** as the primary typeface for its modern, refined, and balanced characteristics. It feels professional yet approachable. 

- **Headlines:** Use a tighter letter-spacing and bold weights to establish a strong presence.
- **Body Text:** Standard weight with generous line-height for maximum legibility.
- **Technical Labels:** **JetBrains Mono** is introduced for status labels and "loader logs" to provide a precise, developer-friendly touch that reinforces the SaaS context.

## Layout & Spacing

The layout follows a **Fixed Grid** philosophy for desktop to maintain the "contained" premium feel, centering the loader content within a clear safe zone. 

- **Desktop:** 12-column grid with 24px gutters. The primary content should occupy the central 4-6 columns for loader screens.
- **Mobile:** Single column with 16px side margins.
- **Spacing Rhythm:** Based on an 8px scale. Use `stack-lg` (32px) to separate the animation from the text, and `stack-sm` (8px) for related label-headline pairings.

## Elevation & Depth

Visual hierarchy is achieved through **Tonal Layers** and **Ambient Shadows**. 

- **Surface Tiering:** The main background is `slate-50`. Content containers or card-based loaders use a pure white surface (`#ffffff`) to pop slightly.
- **Shadows:** Use extremely soft, low-opacity shadows (e.g., `box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.03), 0 4px 6px -2px rgba(0, 0, 0, 0.01)`). Shadows should not look "heavy"; they should look like a subtle lift from the page.
- **Outlines:** Use 1px borders in `slate-200` for cards and inputs instead of heavy shadows to maintain the minimalist SaaS aesthetic.

## Shapes

The shape language is **Rounded**. 

- **Standard Elements:** Buttons and cards use a 0.5rem (8px) radius. 
- **Large Elements:** Container cards use a 1rem (16px) radius.
- **Magnifying Glass Icon:** Ensure the lens and handle geometry are consistent with the `rounded-lg` (1rem) logic for a cohesive, soft look.

## Components

- **Loader Animation:** The magnifying glass should be the focal point. Use `slate-800` for the frame and handle. The lens should use a subtle semi-transparent `slate-100` fill. The "search" motion should be smooth, following a circular path with an easing function (ease-in-out).
- **Progress Bars:** Use a thin 4px track in `slate-200` with a `slate-800` fill. No rounded ends for the bar (keep it architectural) or use the system's `roundedness` for a softer feel.
- **Cards:** White background, 1px `slate-200` border, and the ambient shadow defined in the Elevation section.
- **Status Chips:** Use `label-caps` typography within a `slate-100` background and `slate-600` text for a subtle "in-progress" indicator.
- **Micro-copy:** Pair a `headline-md` status (e.g., "Scanning Files...") with a `body-sm` description in `slate-500` to keep the user informed without clutter.