import { Router, type Request } from "express";
import type { Db } from "@paperclipai/db";
import {
  createRoutineSchema,
  createRoutineTriggerSchema,
  rotateRoutineTriggerSecretSchema,
  runRoutineSchema,
  updateRoutineSchema,
  updateRoutineTriggerSchema,
} from "@paperclipai/shared";
import { trackRoutineCreated } from "@paperclipai/shared/telemetry";
import { validate } from "../middleware/validate.js";
import { accessService, logActivity, routineService } from "../services/index.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { forbidden, unauthorized } from "../errors.js";
import { getTelemetryClient } from "../telemetry.js";
import type { PluginWorkerManager } from "../services/plugin-worker-manager.js";
import { withCompanyRls } from "../services/company-rls.js";

export function routineRoutes(
  db: Db,
  options: { pluginWorkerManager?: PluginWorkerManager } = {},
) {
  const router = Router();
  const svc = routineService(db, {
    pluginWorkerManager: options.pluginWorkerManager,
  });
  const access = accessService(db);

  async function assertBoardCanAssignTasks(req: Request, companyId: string) {
    assertCompanyAccess(req, companyId);
    if (req.actor.type !== "board") return;
    if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) return;
    const allowed = await access.canUser(companyId, req.actor.userId, "tasks:assign");
    if (!allowed) {
      throw forbidden("Missing permission: tasks:assign");
    }
  }

  function assertCanManageCompanyRoutine(req: Request, companyId: string, assigneeAgentId?: string | null) {
    assertCompanyAccess(req, companyId);
    if (req.actor.type === "board") return;
    if (req.actor.type !== "agent" || !req.actor.agentId) throw unauthorized();
    if (assigneeAgentId !== req.actor.agentId) {
      throw forbidden("Agents can only manage routines assigned to themselves");
    }
  }

  async function assertCanManageExistingRoutine(req: Request, routineId: string) {
    const routine = await svc.get(routineId);
    if (!routine) return null;
    assertCompanyAccess(req, routine.companyId);
    if (req.actor.type === "board") return routine;
    if (req.actor.type !== "agent" || !req.actor.agentId) throw unauthorized();
    if (routine.assigneeAgentId !== req.actor.agentId) {
      throw forbidden("Agents can only manage routines assigned to themselves");
    }
    return routine;
  }

  router.get("/companies/:companyId/routines", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const result = await withCompanyRls(db, companyId, (scopedDb) =>
      routineService(scopedDb, {
        pluginWorkerManager: options.pluginWorkerManager,
      }).list(companyId),
    );
    res.json(result);
  });

  router.post("/companies/:companyId/routines", validate(createRoutineSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertBoardCanAssignTasks(req, companyId);
    assertCanManageCompanyRoutine(req, companyId, req.body.assigneeAgentId);
    const actor = getActorInfo(req);
    const created = await withCompanyRls(db, companyId, async (scopedDb) => {
      const scopedSvc = routineService(scopedDb, {
        pluginWorkerManager: options.pluginWorkerManager,
      });
      const next = await scopedSvc.create(companyId, req.body, {
        agentId: req.actor.type === "agent" ? req.actor.agentId : null,
        userId: req.actor.type === "board" ? req.actor.userId ?? "board" : null,
      });
      await logActivity(scopedDb, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "routine.created",
        entityType: "routine",
        entityId: next.id,
        details: { title: next.title, assigneeAgentId: next.assigneeAgentId },
      });
      return next;
    });
    const telemetryClient = getTelemetryClient();
    if (telemetryClient) {
      trackRoutineCreated(telemetryClient);
    }
    res.status(201).json(created);
  });

  router.get("/routines/:id", async (req, res) => {
    const detail = await svc.getDetail(req.params.id as string);
    if (!detail) {
      res.status(404).json({ error: "Routine not found" });
      return;
    }
    assertCompanyAccess(req, detail.companyId);
    const scopedDetail = await withCompanyRls(db, detail.companyId, (scopedDb) =>
      routineService(scopedDb, {
        pluginWorkerManager: options.pluginWorkerManager,
      }).getDetail(req.params.id as string),
    );
    res.json(scopedDetail ?? detail);
  });

  router.patch("/routines/:id", validate(updateRoutineSchema), async (req, res) => {
    const routine = await assertCanManageExistingRoutine(req, req.params.id as string);
    if (!routine) {
      res.status(404).json({ error: "Routine not found" });
      return;
    }
    const assigneeWillChange =
      req.body.assigneeAgentId !== undefined &&
      req.body.assigneeAgentId !== routine.assigneeAgentId;
    if (assigneeWillChange) {
      await assertBoardCanAssignTasks(req, routine.companyId);
    }
    const statusWillActivate =
      req.body.status !== undefined &&
      req.body.status === "active" &&
      routine.status !== "active";
    if (statusWillActivate) {
      await assertBoardCanAssignTasks(req, routine.companyId);
    }
    if (
      req.actor.type === "agent" &&
      req.body.assigneeAgentId !== undefined &&
      req.body.assigneeAgentId !== req.actor.agentId
    ) {
      throw forbidden("Agents can only assign routines to themselves");
    }
    const actor = getActorInfo(req);
    const updated = await withCompanyRls(db, routine.companyId, async (scopedDb) => {
      const scopedSvc = routineService(scopedDb, {
        pluginWorkerManager: options.pluginWorkerManager,
      });
      const next = await scopedSvc.update(routine.id, req.body, {
        agentId: req.actor.type === "agent" ? req.actor.agentId : null,
        userId: req.actor.type === "board" ? req.actor.userId ?? "board" : null,
      });
      await logActivity(scopedDb, {
        companyId: routine.companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "routine.updated",
        entityType: "routine",
        entityId: routine.id,
        details: { title: next?.title ?? routine.title },
      });
      return next;
    });
    res.json(updated);
  });

  router.get("/routines/:id/runs", async (req, res) => {
    const routine = await svc.get(req.params.id as string);
    if (!routine) {
      res.status(404).json({ error: "Routine not found" });
      return;
    }
    assertCompanyAccess(req, routine.companyId);
    const limit = Number(req.query.limit ?? 50);
    const result = await withCompanyRls(db, routine.companyId, (scopedDb) =>
      routineService(scopedDb, {
        pluginWorkerManager: options.pluginWorkerManager,
      }).listRuns(routine.id, Number.isFinite(limit) ? limit : 50),
    );
    res.json(result);
  });

  router.post("/routines/:id/triggers", validate(createRoutineTriggerSchema), async (req, res) => {
    const routine = await assertCanManageExistingRoutine(req, req.params.id as string);
    if (!routine) {
      res.status(404).json({ error: "Routine not found" });
      return;
    }
    await assertBoardCanAssignTasks(req, routine.companyId);
    const actor = getActorInfo(req);
    const created = await withCompanyRls(db, routine.companyId, async (scopedDb) => {
      const scopedSvc = routineService(scopedDb, {
        pluginWorkerManager: options.pluginWorkerManager,
      });
      const next = await scopedSvc.createTrigger(routine.id, req.body, {
        agentId: req.actor.type === "agent" ? req.actor.agentId : null,
        userId: req.actor.type === "board" ? req.actor.userId ?? "board" : null,
      });
      await logActivity(scopedDb, {
        companyId: routine.companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "routine.trigger_created",
        entityType: "routine_trigger",
        entityId: next.trigger.id,
        details: { routineId: routine.id, kind: next.trigger.kind },
      });
      return next;
    });
    res.status(201).json(created);
  });

  router.patch("/routine-triggers/:id", validate(updateRoutineTriggerSchema), async (req, res) => {
    const trigger = await svc.getTrigger(req.params.id as string);
    if (!trigger) {
      res.status(404).json({ error: "Routine trigger not found" });
      return;
    }
    const routine = await assertCanManageExistingRoutine(req, trigger.routineId);
    if (!routine) {
      res.status(404).json({ error: "Routine not found" });
      return;
    }
    await assertBoardCanAssignTasks(req, routine.companyId);
    const actor = getActorInfo(req);
    const updated = await withCompanyRls(db, routine.companyId, async (scopedDb) => {
      const scopedSvc = routineService(scopedDb, {
        pluginWorkerManager: options.pluginWorkerManager,
      });
      const next = await scopedSvc.updateTrigger(trigger.id, req.body, {
        agentId: req.actor.type === "agent" ? req.actor.agentId : null,
        userId: req.actor.type === "board" ? req.actor.userId ?? "board" : null,
      });
      await logActivity(scopedDb, {
        companyId: routine.companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "routine.trigger_updated",
        entityType: "routine_trigger",
        entityId: trigger.id,
        details: { routineId: routine.id, kind: next?.kind ?? trigger.kind },
      });
      return next;
    });
    res.json(updated);
  });

  router.delete("/routine-triggers/:id", async (req, res) => {
    const trigger = await svc.getTrigger(req.params.id as string);
    if (!trigger) {
      res.status(404).json({ error: "Routine trigger not found" });
      return;
    }
    const routine = await assertCanManageExistingRoutine(req, trigger.routineId);
    if (!routine) {
      res.status(404).json({ error: "Routine not found" });
      return;
    }
    const actor = getActorInfo(req);
    await withCompanyRls(db, routine.companyId, async (scopedDb) => {
      const scopedSvc = routineService(scopedDb, {
        pluginWorkerManager: options.pluginWorkerManager,
      });
      await scopedSvc.deleteTrigger(trigger.id);
      await logActivity(scopedDb, {
        companyId: routine.companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "routine.trigger_deleted",
        entityType: "routine_trigger",
        entityId: trigger.id,
        details: { routineId: routine.id, kind: trigger.kind },
      });
    });
    res.status(204).end();
  });

  router.post(
    "/routine-triggers/:id/rotate-secret",
    validate(rotateRoutineTriggerSecretSchema),
    async (req, res) => {
      const trigger = await svc.getTrigger(req.params.id as string);
      if (!trigger) {
        res.status(404).json({ error: "Routine trigger not found" });
        return;
      }
      const routine = await assertCanManageExistingRoutine(req, trigger.routineId);
      if (!routine) {
        res.status(404).json({ error: "Routine not found" });
        return;
      }
      const actor = getActorInfo(req);
      const rotated = await withCompanyRls(db, routine.companyId, async (scopedDb) => {
        const scopedSvc = routineService(scopedDb, {
          pluginWorkerManager: options.pluginWorkerManager,
        });
        const next = await scopedSvc.rotateTriggerSecret(trigger.id, {
          agentId: req.actor.type === "agent" ? req.actor.agentId : null,
          userId: req.actor.type === "board" ? req.actor.userId ?? "board" : null,
        });
        await logActivity(scopedDb, {
          companyId: routine.companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "routine.trigger_secret_rotated",
          entityType: "routine_trigger",
          entityId: trigger.id,
          details: { routineId: routine.id },
        });
        return next;
      });
      res.json(rotated);
    },
  );

  router.post("/routines/:id/run", validate(runRoutineSchema), async (req, res) => {
    const routine = await assertCanManageExistingRoutine(req, req.params.id as string);
    if (!routine) {
      res.status(404).json({ error: "Routine not found" });
      return;
    }
    await assertBoardCanAssignTasks(req, routine.companyId);
    const actor = getActorInfo(req);
    const run = await withCompanyRls(db, routine.companyId, async (scopedDb) => {
      const scopedSvc = routineService(scopedDb, {
        pluginWorkerManager: options.pluginWorkerManager,
      });
      const next = await scopedSvc.runRoutine(routine.id, req.body);
      await logActivity(scopedDb, {
        companyId: routine.companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "routine.run_triggered",
        entityType: "routine_run",
        entityId: next.id,
        details: { routineId: routine.id, source: next.source, status: next.status },
      });
      return next;
    });
    res.status(202).json(run);
  });

  router.post("/routine-triggers/public/:publicId/fire", async (req, res) => {
    const result = await svc.firePublicTrigger(req.params.publicId as string, {
      authorizationHeader: req.header("authorization"),
      signatureHeader: req.header("x-paperclip-signature"),
      hubSignatureHeader: req.header("x-hub-signature-256"),
      timestampHeader: req.header("x-paperclip-timestamp"),
      idempotencyKey: req.header("idempotency-key"),
      rawBody: (req as { rawBody?: Buffer }).rawBody ?? null,
      payload: typeof req.body === "object" && req.body !== null ? req.body as Record<string, unknown> : null,
    });
    res.status(202).json(result);
  });

  return router;
}
