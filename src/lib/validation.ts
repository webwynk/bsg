// Single source of truth for username format, matching the database's
// profiles_username_format CHECK exactly. Import this everywhere a username
// is validated (client-side pre-checks and server actions alike) instead of
// re-declaring the pattern — duplicated copies are how this project's own
// Issue #7 (client regex missing the underscore DB/server allowed) happened.
//
// Letters and numbers only, no underscore -- product decision 2026-08-11,
// enforced identically here, in profiles_username_format, and in both
// createAgentAction/createPlayerAction.
export const USERNAME_PATTERN = /^[A-Za-z0-9]{3,20}$/
