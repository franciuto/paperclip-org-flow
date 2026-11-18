/**
 * Org Flow UI entry. The host loads this module and mounts the exported components in the
 * slots declared by the manifest:
 * - `OrgFlowPage`            → page slot (routePath "org-flow")
 * - `OrgFlowSidebarLink`     → sidebar slot
 * - `OrgFlowDashboardWidget` → dashboardWidget slot
 */
export { OrgFlowPage } from "./components/Page.js";
export { OrgFlowDashboardWidget, OrgFlowSidebarLink } from "./components/Widget.js";
