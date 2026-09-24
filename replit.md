# Image to PDF

A private browser utility that turns JPG, PNG, and WEBP images into an ordered PDF.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/image-to-pdf/src/App.tsx` — single-page image upload, ordering, page-size selection, and browser PDF generation
- `artifacts/image-to-pdf/src/index.css` — visual theme, responsive layout, and interaction states

## Architecture decisions

- Image processing and PDF creation happen entirely in the browser; no file bytes are uploaded or persisted.
- The app uses a small browser-native PDF writer instead of a server or document-processing service.
- A separate PDF page is created for each image, with A4, Letter, and fit-to-image sizing.

## Product

- Accepts multiple JPG, PNG, and WEBP images by file picker or drag and drop.
- Supports drag reordering, arrow controls, removal, and adding more images.
- Downloads a generated PDF with selectable page size and local-only processing.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
