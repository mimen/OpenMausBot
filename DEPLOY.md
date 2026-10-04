---
deployment_status: partial
deployment_last_assessed: 2026-10-03
deployment_targets:
  - component: React chat app
    where: local-install
    detail: Packaged UI in /Applications/OpenMausBot.app on the M5 laptop
  - component: Harness server
    where: local-install
    detail: Embedded server in /Applications/OpenMausBot.app on the M5 laptop
  - component: Electron desktop shell
    where: local-install
    detail: /Applications/OpenMausBot.app on the M5 laptop; installed version 0.1.25
  - component: Companion sidecar
    where: local-install
    detail: Packaged companion in /Applications/OpenMausBot.app on the M5 laptop; enabled on demand
  - component: Cloudflare Composio broker
    where: cloudflare
    detail: Shared upstream broker configured in the desktop shell; no fork-owned deployment verified
    url: https://openmausbot-composio.milindsoni201.workers.dev
---

# Deployment

The React chat app ships in the desktop bundle's `Contents/Resources/ui`. `electron-builder.yml` copies the Vite build there, and the installed M5 bundle contains that directory.

The Harness server ships in `Contents/Resources/server` inside the same bundle. The Electron desktop shell owns the local agent processes rather than deploying a separate hosted server.

The Electron desktop shell is installed at `/Applications/OpenMausBot.app` on the M5 laptop with bundle ID `com.openmausbot.app` and version `0.1.25`. Its `app-update.yml` points to the upstream `milind-soni/openmausbot-releases` channel. The installed bundle has no `release-identity.json`, so its source revision and the custom fork's installation chain are unverified. The local deployment system described in `PROJECT.md` remains outside this branch and supplies no runnable `deploy:*` commands here.

The Companion sidecar ships in `Contents/Resources/companion`. `electron-builder.yml` packages it as a separate process that stays off until requested. Packaging is confirmed, but no running sidecar was verified.

The Cloudflare Composio broker's shared upstream URL is the packaged desktop default in `electron/main.mjs`. `cloudflare/composio-broker/wrangler.jsonc` names the Worker and D1 database, and the adjacent README documents `pnpm broker:deploy`. That README requires forks to provision their own Cloudflare resources. No fork-owned broker deployment or iOS distribution channel was verified.
