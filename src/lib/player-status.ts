/** Three real states, not two: an auto-lock (5 failed logins, Issue #52)
 * reads and clears differently from a deliberate agent/superadmin block, so
 * the label and badge color need to tell them apart, not just show
 * "Blocked" for both. Shared by the agent players page and the superadmin
 * agent-detail page -- both render the same underlying player state. */
export function playerStatus(player: { is_active: boolean; auto_locked_at: string | null }) {
  if (player.is_active) {
    return { label: 'Active', badgeClass: 'bg-success-bg text-success-text border border-emerald-500/20' }
  }
  if (player.auto_locked_at) {
    return { label: 'Temporary Block', badgeClass: 'bg-amber-500/10 text-amber-400 border border-amber-500/20' }
  }
  return { label: 'Blocked', badgeClass: 'bg-danger-bg text-danger-text border border-red-500/20' }
}
