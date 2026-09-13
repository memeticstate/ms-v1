# Memetic State — Cloudflare Workers cutover

## Goal

Move Memetic State off ChatGPT Sites as the production runtime without disrupting the current live site. Cloudflare Workers becomes the primary application/runtime platform; ChatGPT remains a development environment/model provider rather than the hosting dependency.

## Safety rule

Do not move `memeticstate.com` DNS until a staging deployment on `*.workers.dev` passes the full smoke test.

## Existing compatibility

The current application is already close to a native Workers deployment:

- Next.js 16 through vinext.
- `@cloudflare/vite-plugin`.
- Custom `worker/index.ts` with both `fetch()` and `scheduled()` handlers.
- D1 accessed through the `DB` binding.
- Cloudflare Images accessed through the `IMAGES` binding.
- Static assets accessed through the `ASSETS` binding.
- Cron-driven collection already implemented.

The OpenAI Sites-specific layer is currently concentrated in `.openai/hosting.json`, `build/sites-vite-plugin.ts`, `scripts/sites-env.sh`, and the local placeholder binding logic in `vite.config.ts`.

## Migration phases

### Phase 1 — Cloudflare staging

1. Authenticate Wrangler against the paid Cloudflare account.
2. Create a dedicated D1 database named `memetic-state-staging`.
3. Add a native `wrangler.jsonc` using the real D1 database ID.
4. Make the Vite configuration support both OpenAI Sites and direct Cloudflare deployment during migration.
5. Apply all Drizzle migrations to the staging D1 database.
6. Deploy to a `*.workers.dev` hostname.
7. Verify UI, route handlers, image optimization, collector wake endpoints and scheduled execution.

### Phase 2 — Data/state verification

1. Let the staging collector index from chain sources.
2. Compare current protocol state, PONS launch coverage, freshness and rankings with the live Sites deployment.
3. Preserve any user/account/history state that cannot be reconstructed before cutover.
4. Integrate the Privy migration and X/social ingestion on Workers rather than tying them to Sites.

### Phase 3 — Production Cloudflare deployment

1. Create a production D1 database (`memetic-state-prod`) or promote/import the validated staging state.
2. Configure production secrets through `wrangler secret` / Cloudflare dashboard; never commit them.
3. Enable observability and appropriate sampling.
4. Verify scheduled jobs and alarms in production.
5. Add a temporary Cloudflare production hostname/subdomain and smoke-test again.

### Phase 4 — Domain cutover

1. Add `memeticstate.com` to Cloudflare as a zone and complete nameserver delegation from Hostinger.
2. Keep the existing Sites DNS active until the Cloudflare zone is ready.
3. Attach the Worker through a Cloudflare Custom Domain only after the deployment is healthy.
4. Verify apex and `www`, TLS, redirects, Privy allowed origins, CSP and X-Frame policy.
5. Remove the old ChatGPT Sites DNS records only after Cloudflare is serving the production app correctly.

## Initial runtime bindings

The direct Workers deployment needs at minimum:

- `DB` — D1 database binding.
- `ASSETS` — static asset binding.
- `IMAGES` — Cloudflare Images binding used by the current vinext image optimizer.
- Cron trigger — initially preserve the existing one-minute schedule while validating collector behavior.

Future bindings can include Queues, Workflows, Durable Objects, Vectorize, Workers AI and service bindings as the intelligence network grows.

## Kyun

The Kyun VM is intentionally not part of the critical path. Keep it stopped as optional Linux/heavy-compute capacity for workloads that do not fit Workers (browser automation, native binaries, long-running local processes, media processing, experimental services, etc.).
