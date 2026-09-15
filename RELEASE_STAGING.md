# Memetic State: Simple experience staging review

Base: `infra/cloudflare-staging-v62` at `e4d30bc6eefe65b370cdb4df5ac32a26ac5d84fc`.
Review branch: `work/simple-experience-v62`. Target: `infra/cloudflare-staging-v62`.

The Simple v62 redesign was merged in PR #2 at `3489a483bd9fa0061a8dc8cfdadc75823103f30c` and deployed by the owner to `memetic-state-staging`. Wrangler reported version `313ac889-7414-41c0-85f8-59af3af6aad1` on 2026-09-15. Production has not been cut over.

This v62.1 follow-up fixes a live review finding: a recorded transition could describe historical eligibility as if it were the current reading. Token Brief and the Observatory now explicitly distinguish recorded state from current state and prefer current research guidance. This follow-up is locally verified and awaits staging deployment.

## Release ledger

- Implemented: default `/app` with NOW, CHANGED and NEW, token search, and desktop/mobile navigation.
- Implemented: `/app/token/[address]` Token Brief with deterministic state, dated transition, trades, actors, trade activity versus prior window, current sampled holders, source coverage, and progressive evidence disclosure.
- Implemented: Ask, Save and Full evidence actions preserve the selected token.
- Implemented: dedicated `/app/observe`, `/app/research` and `/app/saved`; all existing Observatory instruments retained.
- Implemented: ASK / TOKEN BRIEF / SAVED navigation for holder research; existing server access controls retained.
- Implemented: bounded read-only state-history and state-change endpoints backed by persisted D1 observations. Hourly heartbeat observations no longer obscure material transitions.
- Implemented: Saved supports every canonical state and displays deterioration without synthesizing discovery alerts. New-device saves preserve existing account watch rules and dates.
- Implemented: **Canonical Robinhood Chain explorer upgraded to Robinhood Etherscan across token, transaction, contract and wallet surfaces.** Saved historical source links normalize on display; API/RPC destinations remain separate.
- Implemented: existing deep links and documentation links lead to the new dedicated routes, preserving token, habitat and observation-window context.

The RPC collector, deterministic classifier, D1 schema, production hosting configuration, and holder threshold were not replaced. This is not a new scoring engine or an Etherscan API ingestion migration.

## Evidence semantics

- NOW selects canonical eligible readings and canonical stress only while state evidence is current. Stress remains ineligible for the discovery shortlist.
- CHANGED shows the latest material persisted transition per token within 24 hours (up to 60), independently of current activity rank. Its dated states are not presented as current token metrics.
- NEW uses confirmed launch events from the bounded factory window. Metrics appear only when matching current canonical evidence includes the launch block.
- Percent change means trade-count change versus the prior indexed pulse, not price return. A missing baseline stays missing.
- Holder counts use the existing ten-minute observation freshness rule and retain their sampled basis.
- `stressed → unverified` means stress is no longer confirmed; it is not recovery. Current guidance takes precedence over an older transition into a different state.
- Raw quote amounts are shown as flow direction until normalized amounts are available; no quote-token decimals are guessed.
- Missing, delayed, failed and future-dated evidence are explicit. X/social configuration is never inferred from trading data.

## Completed verification

- Existing lockfile installation succeeded without dependency changes.
- `npm test`: production build succeeded; **180 tests passed, zero failed**.
- `npx tsc --noEmit --incremental false`: passed.
- `git diff --check`: passed.
- Added executable regression coverage for navigation, rendered routes, legacy links, state-history queries, stress/recovery, freshness, sampled holders, unknown baselines, raw flow direction, Watchtower state validation, and explorer/API separation.
- Production Wrangler configuration, RPC transport, deterministic research classifier, dependency versions and D1 migrations are unchanged.

## Live staging review — 2026-09-15

- Desktop Simple NOW, CHANGED, NEW and token search rendered successfully. Exact contract selection opened the intended Token Brief.
- Token Brief, Observatory dossier, Research and Saved preserved the selected token. Advanced evidence disclosed holder sampling and dated state history.
- A local watch was saved, survived reload, and was removed successfully. This does not verify authenticated account restore.
- Research displayed the 0.1% holder access requirement. Privy opened and offered wallet/email/social methods; authenticated entitlement checks remain pending.
- Inspected token, contract, transaction, block, creator and protocol coverage links used `https://robin.etherscan.io`.
- Collector timestamps and launch blocks advanced during the review; state memory showed four of five horizons resolved, with the 7-day horizon warming. Three hourly public UI spot checks were scheduled; uninterrupted collector health is not yet established.
- Desktop screenshots capture deployed v62, before this presentation follow-up. Mobile visual review remains pending because the available browser did not support a mobile viewport.
- Independent automated API checks were denied by Cloudflare with HTTP 403 / Error 1010 and stopped. Full parity on identical observation blocks, authenticated API denial and access tests have not been completed.

## Remaining release gates

1. Deploy and review the v62.1 presentation follow-up on `memetic-state-staging` only.
2. Review approximately 390px mobile layouts, tap targets, drawers and scrolling.
3. Complete Privy wallet/email/Google login, below-threshold denial, 0.1% holder access, access expiry/refresh, Research and authenticated Save/account restore.
4. Compare deterministic readings against canonical evidence for identical tokens and observation blocks through an authorized client.
5. Finish collector freshness and persistent state-memory soak; UI spot checks alone do not establish continuous health.
6. Verify explorer destinations in authenticated saved research and wallet UI.

The staging-only portable package passed Wrangler 4.132.0 dry run. No database migration, dependency change, RPC transport change, classifier change or production-domain configuration change is included.

`memeticstate.com`, its DNS and the existing ChatGPT Sites production remain outside this release. Production-domain cutover is a separate later decision after the checks above pass.
