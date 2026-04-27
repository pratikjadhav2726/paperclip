import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { withCompanyRls } from "../services/company-rls.js";
import { dashboardService } from "../services/dashboard.js";
import { assertCompanyAccess } from "./authz.js";

export function dashboardRoutes(db: Db) {
  const router = Router();

  router.get("/companies/:companyId/dashboard", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const summary = await withCompanyRls(db, companyId, (scopedDb) => dashboardService(scopedDb).summary(companyId));
    res.json(summary);
  });

  return router;
}
