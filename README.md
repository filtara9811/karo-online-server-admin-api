# Karo Online — Server + Admin

React admin (pixel-matched gold panel) + Node Express API. Same Supabase project as today. Mongo later — all reads/writes go through Express.

```
karo-online-server-admin/
  apps/api      Express TypeScript  :4000
  apps/admin    React + Vite        :5173
  packages/design-tokens
```
new

## Setup

1. Copy API env and add the **service role** key (from Supabase dashboard → Settings → API). Privileged routes (OTP, nearby vendors, payments) need it.

```bash
cp apps/api/.env.example apps/api/.env
# set SUPABASE_PUBLISHABLE_KEY and SUPABASE_SERVICE_ROLE_KEY
```

2. Install and run:

```bash
cd apps/api && npm install && npm run dev
cd apps/admin && npm install && npm run dev
```

- API: http://localhost:4000/health
- Admin: http://localhost:5173/login

Admin login uses the **same** Supabase email/password as `/admin/login` on karoonline.in. After login, the panel calls Express with the JWT.

## Design

Antique gold `#D4AF37`, Cormorant Garamond + Inter, dark gold sidebar. Tokens: `packages/design-tokens/tokens.json`.

## Later: MongoDB

Do not add `supabase.from(...)` in the React admin. Only Express talks to data. Swap repositories in `apps/api` when you migrate.
# karo-online-server-admin-api
