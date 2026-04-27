import { Router } from "express";
import type { Db } from "@paperclipai/db";
import {
  createCostEventSchema,
  createFinanceEventSchema,
  resolveBudgetIncidentSchema,
  updateBudgetSchema,
  upsertBudgetPolicySchema,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import {
  budgetService,
  costService,
  financeService,
  companyService,
  agentService,
  heartbeatService,
  logActivity,
} from "../services/index.js";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";
import { withCompanyRls } from "../services/company-rls.js";
import { fetchAllQuotaWindows } from "../services/quota-windows.js";
import { badRequest } from "../errors.js";
import type { PluginWorkerManager } from "../services/plugin-worker-manager.js";

export function parseCostDateRange(query: Record<string, unknown>) {
  const fromRaw = query.from as string | undefined;
  const toRaw = query.to as string | undefined;
  const from = fromRaw ? new Date(fromRaw) : undefined;
  const to = toRaw ? new Date(toRaw) : undefined;
  if (from && isNaN(from.getTime())) throw badRequest("invalid 'from' date");
  if (to && isNaN(to.getTime())) throw badRequest("invalid 'to' date");
  return (from || to) ? { from, to } : undefined;
}

export function parseCostLimit(query: Record<string, unknown>) {
  const raw = Array.isArray(query.limit) ? query.limit[0] : query.limit;
  if (raw == null || raw === "") return 100;
  const limit = typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
  if (!Number.isFinite(limit) || limit <= 0 || limit > 500) {
    throw badRequest("invalid 'limit' value");
  }
  return limit;
}

export function costRoutes(
  db: Db,
  options: { pluginWorkerManager?: PluginWorkerManager } = {},
) {
  const router = Router();
  const rootHeartbeat = heartbeatService(db, {
    pluginWorkerManager: options.pluginWorkerManager,
  });
  const budgetHooks = {
    cancelWorkForScope: rootHeartbeat.cancelBudgetScopeWork,
  };
  const rootAgents = agentService(db);

  const scopedServices = (scopedDb: Db) => ({
    costs: costService(scopedDb, budgetHooks),
    finance: financeService(scopedDb),
    budgets: budgetService(scopedDb, budgetHooks),
    companies: companyService(scopedDb),
    agents: agentService(scopedDb),
  });

  router.post("/companies/:companyId/cost-events", validate(createCostEventSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    if (req.actor.type === "agent" && req.actor.agentId !== req.body.agentId) {
      res.status(403).json({ error: "Agent can only report its own costs" });
      return;
    }

    const event = await withCompanyRls(db, companyId, async (scopedDb) => {
      const { costs } = scopedServices(scopedDb);
      const created = await costs.createEvent(companyId, {
        ...req.body,
        occurredAt: new Date(req.body.occurredAt),
      });

      const actor = getActorInfo(req);
      await logActivity(scopedDb, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        action: "cost.reported",
        entityType: "cost_event",
        entityId: created.id,
        details: { costCents: created.costCents, model: created.model },
      });
      return created;
    });

    res.status(201).json(event);
  });

  router.post("/companies/:companyId/finance-events", validate(createFinanceEventSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    assertBoard(req);

    const event = await withCompanyRls(db, companyId, async (scopedDb) => {
      const { finance } = scopedServices(scopedDb);
      const created = await finance.createEvent(companyId, {
        ...req.body,
        occurredAt: new Date(req.body.occurredAt),
      });

      const actor = getActorInfo(req);
      await logActivity(scopedDb, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        action: "finance_event.reported",
        entityType: "finance_event",
        entityId: created.id,
        details: {
          amountCents: created.amountCents,
          biller: created.biller,
          eventKind: created.eventKind,
          direction: created.direction,
        },
      });
      return created;
    });

    res.status(201).json(event);
  });

  router.get("/companies/:companyId/costs/summary", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const range = parseCostDateRange(req.query);
    const summary = await withCompanyRls(db, companyId, (scopedDb) =>
      scopedServices(scopedDb).costs.summary(companyId, range),
    );
    res.json(summary);
  });

  router.get("/companies/:companyId/costs/by-agent", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const range = parseCostDateRange(req.query);
    const rows = await withCompanyRls(db, companyId, (scopedDb) =>
      scopedServices(scopedDb).costs.byAgent(companyId, range),
    );
    res.json(rows);
  });

  router.get("/companies/:companyId/costs/by-agent-model", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const range = parseCostDateRange(req.query);
    const rows = await withCompanyRls(db, companyId, (scopedDb) =>
      scopedServices(scopedDb).costs.byAgentModel(companyId, range),
    );
    res.json(rows);
  });

  router.get("/companies/:companyId/costs/by-provider", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const range = parseCostDateRange(req.query);
    const rows = await withCompanyRls(db, companyId, (scopedDb) =>
      scopedServices(scopedDb).costs.byProvider(companyId, range),
    );
    res.json(rows);
  });

  router.get("/companies/:companyId/costs/by-biller", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const range = parseCostDateRange(req.query);
    const rows = await withCompanyRls(db, companyId, (scopedDb) =>
      scopedServices(scopedDb).costs.byBiller(companyId, range),
    );
    res.json(rows);
  });

  router.get("/companies/:companyId/costs/finance-summary", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const range = parseCostDateRange(req.query);
    const summary = await withCompanyRls(db, companyId, (scopedDb) =>
      scopedServices(scopedDb).finance.summary(companyId, range),
    );
    res.json(summary);
  });

  router.get("/companies/:companyId/costs/finance-by-biller", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const range = parseCostDateRange(req.query);
    const rows = await withCompanyRls(db, companyId, (scopedDb) =>
      scopedServices(scopedDb).finance.byBiller(companyId, range),
    );
    res.json(rows);
  });

  router.get("/companies/:companyId/costs/finance-by-kind", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const range = parseCostDateRange(req.query);
    const rows = await withCompanyRls(db, companyId, (scopedDb) =>
      scopedServices(scopedDb).finance.byKind(companyId, range),
    );
    res.json(rows);
  });

  router.get("/companies/:companyId/costs/finance-events", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const range = parseCostDateRange(req.query);
    const limit = parseCostLimit(req.query);
    const rows = await withCompanyRls(db, companyId, (scopedDb) =>
      scopedServices(scopedDb).finance.list(companyId, range, limit),
    );
    res.json(rows);
  });

  router.get("/companies/:companyId/costs/window-spend", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const rows = await withCompanyRls(db, companyId, (scopedDb) =>
      scopedServices(scopedDb).costs.windowSpend(companyId),
    );
    res.json(rows);
  });

  router.get("/companies/:companyId/costs/quota-windows", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    assertBoard(req);
    // validate companyId resolves to a real company so the "__none__" sentinel
    // and any forged ids are rejected before we touch provider credentials
    const company = await withCompanyRls(db, companyId, (scopedDb) =>
      scopedServices(scopedDb).companies.getById(companyId),
    );
    if (!company) {
      res.status(404).json({ error: "Company not found" });
      return;
    }
    const results = await fetchAllQuotaWindows();
    res.json(results);
  });

  router.get("/companies/:companyId/budgets/overview", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const overview = await withCompanyRls(db, companyId, (scopedDb) =>
      scopedServices(scopedDb).budgets.overview(companyId),
    );
    res.json(overview);
  });

  router.post(
    "/companies/:companyId/budgets/policies",
    validate(upsertBudgetPolicySchema),
    async (req, res) => {
      assertBoard(req);
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const summary = await withCompanyRls(db, companyId, (scopedDb) =>
        scopedServices(scopedDb).budgets.upsertPolicy(companyId, req.body, req.actor.userId ?? "board"),
      );
      res.json(summary);
    },
  );

  router.post(
    "/companies/:companyId/budget-incidents/:incidentId/resolve",
    validate(resolveBudgetIncidentSchema),
    async (req, res) => {
      assertBoard(req);
      const companyId = req.params.companyId as string;
      const incidentId = req.params.incidentId as string;
      assertCompanyAccess(req, companyId);
      const incident = await withCompanyRls(db, companyId, (scopedDb) =>
        scopedServices(scopedDb).budgets.resolveIncident(companyId, incidentId, req.body, req.actor.userId ?? "board"),
      );
      res.json(incident);
    },
  );

  router.get("/companies/:companyId/costs/by-project", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const range = parseCostDateRange(req.query);
    const rows = await withCompanyRls(db, companyId, (scopedDb) =>
      scopedServices(scopedDb).costs.byProject(companyId, range),
    );
    res.json(rows);
  });

  router.patch("/companies/:companyId/budgets", validate(updateBudgetSchema), async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const company = await withCompanyRls(db, companyId, async (scopedDb) => {
      const { companies, budgets } = scopedServices(scopedDb);
      const updated = await companies.update(companyId, { budgetMonthlyCents: req.body.budgetMonthlyCents });
      if (!updated) {
        return null;
      }

      await logActivity(scopedDb, {
        companyId,
        actorType: "user",
        actorId: req.actor.userId ?? "board",
        action: "company.budget_updated",
        entityType: "company",
        entityId: companyId,
        details: { budgetMonthlyCents: req.body.budgetMonthlyCents },
      });

      await budgets.upsertPolicy(
        companyId,
        {
          scopeType: "company",
          scopeId: companyId,
          amount: req.body.budgetMonthlyCents,
          windowKind: "calendar_month_utc",
        },
        req.actor.userId ?? "board",
      );
      return updated;
    });
    if (!company) {
      res.status(404).json({ error: "Company not found" });
      return;
    }

    res.json(company);
  });

  router.patch("/agents/:agentId/budgets", validate(updateBudgetSchema), async (req, res) => {
    const agentId = req.params.agentId as string;
    const agent = await rootAgents.getById(agentId);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    assertCompanyAccess(req, agent.companyId);
    assertBoard(req);

    const updated = await withCompanyRls(db, agent.companyId, async (scopedDb) => {
      const { agents, budgets } = scopedServices(scopedDb);
      const next = await agents.update(agentId, { budgetMonthlyCents: req.body.budgetMonthlyCents });
      if (!next) {
        return null;
      }

      const actor = getActorInfo(req);
      await logActivity(scopedDb, {
        companyId: next.companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        action: "agent.budget_updated",
        entityType: "agent",
        entityId: next.id,
        details: { budgetMonthlyCents: next.budgetMonthlyCents },
      });

      await budgets.upsertPolicy(
        next.companyId,
        {
          scopeType: "agent",
          scopeId: next.id,
          amount: next.budgetMonthlyCents,
          windowKind: "calendar_month_utc",
        },
        req.actor.type === "board" ? req.actor.userId ?? "board" : null,
      );

      return next;
    });
    if (!updated) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    res.json(updated);
  });

  return router;
}
