# Privy production security notes

Privy app ID: `cmtp72a3700070bl79bfbeliw`

This identifier is public client configuration and is not a secret. Keep the Privy app secret out of source control.

## Important dashboard clarification

The Privy production checklist can show CSP and X-Frame items as checked when the operator confirms them. Those checkmarks are not proof that Memetic State is already returning the required HTTP headers.

Before production cutover we must verify the headers from the deployed `https://memeticstate.com` response itself.

## Required CSP shape

Privy's current web guidance requires the following trusted origins for `@privy-io/react-auth`:

- `child-src`: `https://auth.privy.io`, `https://verify.walletconnect.com`, `https://verify.walletconnect.org`
- `frame-src`: same origins, plus `https://challenges.cloudflare.com` when CAPTCHA is used
- `connect-src`: `https://auth.privy.io`, WalletConnect relay websocket origins, Coinbase Wallet websocket origin, `https://*.rpc.privy.systems`, and WalletConnect explorer API

Memetic State should start with CSP in report-only mode on the Privy staging branch, exercise wallet/email/Google/mobile-wallet flows, then enforce it after violations are understood.

## Framing

Memetic State is not intended to be embedded in third-party frames. Use `frame-ancestors 'none'` in CSP and `X-Frame-Options: DENY` as a legacy defense-in-depth header unless the Sites runtime requires a narrower exception discovered during staging.

## Verification checklist

- Inspect live response headers, not dashboard checkmarks.
- Confirm wallet modal iframe loads.
- Confirm WalletConnect QR/mobile flow works.
- Confirm email and Google OAuth callbacks work.
- Confirm public observatory remains usable without authentication.
- Confirm no auth token, secret, signature, or challenge value appears in logs.
