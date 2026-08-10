# bsg_web_dashboard

Next.js/TypeScript admin dashboard for the BSG platform (agent back office + superadmin portal). See `../CLAUDE.md`, `../RULES.md`, `../CHANGELOG.md`, and `../MASTER_AUDIT_AND_REMEDIATION_PLAN.md` at the repo root for the full workflow and history.

## Deploy pipeline note (2026-08-11)

Two consecutive pushes to `main` didn't trigger an automatic Vercel deployment even though the GitHub App integration, connected repo (`webwynk/bsg`), and Production branch were all confirmed correctly configured. Unblocked via a manually-created Vercel Deploy Hook (Settings → Git → Deploy Hooks). If a push ever silently fails to deploy again, that's the fastest way to force a build of whatever is currently on `main` while investigating further.
