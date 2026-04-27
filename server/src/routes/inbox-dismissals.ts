import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { withCompanyRls } from "../services/company-rls.js";
import { inboxDismissalService, logActivity } from "../services/index.js";

const inboxDismissalSchema = z.object({
  itemKey: z.string().trim().min(1).regex(/^(approval|join|run):.+$/, "Unsupported inbox item key"),
});

export function inboxDismissalRoutes(db: Db) {
  const router = Router();

  router.get("/companies/:companyId/inbox-dismissals", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    if (req.actor.type !== "board") {
      res.status(403).json({ error: "Board authentication required" });
      return;
    }
    if (!req.actor.userId) {
      res.status(403).json({ error: "Board user context required" });
      return;
    }
    const dismissals = await withCompanyRls(db, companyId, (scopedDb) =>
      inboxDismissalService(scopedDb).list(companyId, req.actor.userId as string),
    );
    res.json(dismissals);
  });

  router.post(
    "/companies/:companyId/inbox-dismissals",
    validate(inboxDismissalSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      if (req.actor.type !== "board") {
        res.status(403).json({ error: "Board authentication required" });
        return;
      }
      if (!req.actor.userId) {
        res.status(403).json({ error: "Board user context required" });
        return;
      }

      const dismissal = await withCompanyRls(db, companyId, async (scopedDb) => {
        const dismissed = await inboxDismissalService(scopedDb).dismiss(
          companyId,
          req.actor.userId as string,
          req.body.itemKey,
          new Date(),
        );
        const actor = getActorInfo(req);
        await logActivity(scopedDb, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "inbox.dismissed",
          entityType: "company",
          entityId: companyId,
          details: {
            userId: req.actor.userId,
            itemKey: dismissed.itemKey,
            dismissedAt: dismissed.dismissedAt,
          },
        });
        return dismissed;
      });

      res.status(201).json(dismissal);
    },
  );

  return router;
}
