import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { and, eq } from "drizzle-orm";
import { inboxDismissals, joinRequests } from "@paperclipai/db";
import { sidebarBadgeService } from "../services/sidebar-badges.js";
import { accessService } from "../services/access.js";
import { dashboardService } from "../services/dashboard.js";
import { withCompanyRls } from "../services/company-rls.js";
import { collapseDuplicatePendingHumanJoinRequests } from "../lib/join-request-dedupe.js";
import { assertCompanyAccess } from "./authz.js";

function buildDismissedAtByKey(
  dismissals: Array<{ itemKey: string; dismissedAt: Date | string }>,
): Map<string, number> {
  return new Map(
    dismissals.map((dismissal) => [dismissal.itemKey, new Date(dismissal.dismissedAt).getTime()]),
  );
}

export function sidebarBadgeRoutes(db: Db) {
  const router = Router();

  router.get("/companies/:companyId/sidebar-badges", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const badges = await withCompanyRls(db, companyId, async (scopedDb) => {
      const svc = sidebarBadgeService(scopedDb);
      const access = accessService(scopedDb);
      const dashboard = dashboardService(scopedDb);
      let canApproveJoins = false;
      if (req.actor.type === "board") {
        canApproveJoins =
          req.actor.source === "local_implicit" ||
          Boolean(req.actor.isInstanceAdmin) ||
          (await access.canUser(companyId, req.actor.userId, "joins:approve"));
      } else if (req.actor.type === "agent" && req.actor.agentId) {
        canApproveJoins = await access.hasPermission(companyId, "agent", req.actor.agentId, "joins:approve");
      }

      const visibleJoinRequests = canApproveJoins
        ? collapseDuplicatePendingHumanJoinRequests(
          await scopedDb
            .select({
              id: joinRequests.id,
              requestType: joinRequests.requestType,
              status: joinRequests.status,
              requestingUserId: joinRequests.requestingUserId,
              requestEmailSnapshot: joinRequests.requestEmailSnapshot,
              updatedAt: joinRequests.updatedAt,
              createdAt: joinRequests.createdAt,
            })
            .from(joinRequests)
            .where(and(eq(joinRequests.companyId, companyId), eq(joinRequests.status, "pending_approval")))
        ).map(({ id, updatedAt, createdAt }) => ({
          id,
          updatedAt,
          createdAt,
        }))
        : [];

      const dismissedAtByKey =
        req.actor.type === "board" && req.actor.userId
          ? await scopedDb
            .select({ itemKey: inboxDismissals.itemKey, dismissedAt: inboxDismissals.dismissedAt })
            .from(inboxDismissals)
            .where(and(eq(inboxDismissals.companyId, companyId), eq(inboxDismissals.userId, req.actor.userId)))
            .then(buildDismissedAtByKey)
          : new Map<string, number>();

      const scopedBadges = await svc.get(companyId, {
        dismissals: dismissedAtByKey,
        joinRequests: visibleJoinRequests,
      });
      const summary = await dashboard.summary(companyId);
      const hasFailedRuns = scopedBadges.failedRuns > 0;
      const alertsCount =
        (summary.agents.error > 0 && !hasFailedRuns ? 1 : 0) +
        (summary.costs.monthBudgetCents > 0 && summary.costs.monthUtilizationPercent >= 80 ? 1 : 0);
      scopedBadges.inbox = scopedBadges.failedRuns + alertsCount + scopedBadges.joinRequests + scopedBadges.approvals;
      return scopedBadges;
    });

    res.json(badges);
  });

  return router;
}
