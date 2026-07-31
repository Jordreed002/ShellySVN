/** Insights are neither useful nor allowed to compete with a collapsed or busy shell. */
export function shouldLoadSidebarInsights(collapsed: boolean, idle: boolean): boolean {
  return !collapsed && idle;
}
