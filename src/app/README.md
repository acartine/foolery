# app

Next.js App Router pages and layouts.

## Key Files

- **`layout.tsx`** — Root layout with fonts (Manrope, Space Grotesk, IBM Plex Mono), providers, header, and terminal panel
- **`page.tsx`** — Root page that redirects to `/beats` (or `/beats?settings=repos` if no repos registered)
- **`globals.css`** — Global CSS with Tailwind directives and custom properties

## Subdirectories

- **`beats/`** — Beat list page (`page.tsx`), beat detail page (`[id]/`), and page-level hooks
- **`registry/`** — Repository registry page (`page.tsx`)
- **`api/`** — API route handlers
