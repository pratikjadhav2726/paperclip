import { Router, type Request } from "express";
import type { Db } from "@paperclipai/db";
import {
  companySkillCreateSchema,
  companySkillFileUpdateSchema,
  companySkillImportSchema,
  companySkillProjectScanRequestSchema,
} from "@paperclipai/shared";
import { trackSkillImported } from "@paperclipai/shared/telemetry";
import { validate } from "../middleware/validate.js";
import { accessService, agentService, companySkillService, logActivity } from "../services/index.js";
import { forbidden } from "../errors.js";
import { withCompanyRls } from "../services/company-rls.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { getTelemetryClient } from "../telemetry.js";

type SkillTelemetryInput = {
  key: string;
  slug: string;
  sourceType: string;
  sourceLocator: string | null;
  metadata: Record<string, unknown> | null;
};

export function companySkillRoutes(db: Db) {
  const router = Router();

  function canCreateAgents(agent: { permissions: Record<string, unknown> | null | undefined }) {
    if (!agent.permissions || typeof agent.permissions !== "object") return false;
    return Boolean((agent.permissions as Record<string, unknown>).canCreateAgents);
  }

  function asString(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  function deriveTrackedSkillRef(skill: SkillTelemetryInput): string | null {
    if (skill.sourceType === "skills_sh") {
      return skill.key;
    }
    if (skill.sourceType !== "github") {
      return null;
    }
    const hostname = asString(skill.metadata?.hostname);
    if (hostname !== "github.com") {
      return null;
    }
    return skill.key;
  }

  async function assertCanMutateCompanySkills(req: Request, companyId: string, scopedDb: Db) {
    const access = accessService(scopedDb);
    const agents = agentService(scopedDb);

    if (req.actor.type === "board") {
      if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) return;
      const allowed = await access.canUser(companyId, req.actor.userId, "agents:create");
      if (!allowed) {
        throw forbidden("Missing permission: agents:create");
      }
      return;
    }

    if (!req.actor.agentId) {
      throw forbidden("Agent authentication required");
    }

    const actorAgent = await agents.getById(req.actor.agentId);
    if (!actorAgent || actorAgent.companyId !== companyId) {
      throw forbidden("Agent key cannot access another company");
    }

    const allowedByGrant = await access.hasPermission(companyId, "agent", actorAgent.id, "agents:create");
    if (allowedByGrant || canCreateAgents(actorAgent)) {
      return;
    }

    throw forbidden("Missing permission: can create agents");
  }

  router.get("/companies/:companyId/skills", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const result = await withCompanyRls(db, companyId, (scopedDb) => companySkillService(scopedDb).list(companyId));
    res.json(result);
  });

  router.get("/companies/:companyId/skills/:skillId", async (req, res) => {
    const companyId = req.params.companyId as string;
    const skillId = req.params.skillId as string;
    assertCompanyAccess(req, companyId);
    const result = await withCompanyRls(db, companyId, (scopedDb) =>
      companySkillService(scopedDb).detail(companyId, skillId),
    );
    if (!result) {
      res.status(404).json({ error: "Skill not found" });
      return;
    }
    res.json(result);
  });

  router.get("/companies/:companyId/skills/:skillId/update-status", async (req, res) => {
    const companyId = req.params.companyId as string;
    const skillId = req.params.skillId as string;
    assertCompanyAccess(req, companyId);
    const result = await withCompanyRls(db, companyId, (scopedDb) =>
      companySkillService(scopedDb).updateStatus(companyId, skillId),
    );
    if (!result) {
      res.status(404).json({ error: "Skill not found" });
      return;
    }
    res.json(result);
  });

  router.get("/companies/:companyId/skills/:skillId/files", async (req, res) => {
    const companyId = req.params.companyId as string;
    const skillId = req.params.skillId as string;
    const relativePath = String(req.query.path ?? "SKILL.md");
    assertCompanyAccess(req, companyId);
    const result = await withCompanyRls(db, companyId, (scopedDb) =>
      companySkillService(scopedDb).readFile(companyId, skillId, relativePath),
    );
    if (!result) {
      res.status(404).json({ error: "Skill not found" });
      return;
    }
    res.json(result);
  });

  router.post(
    "/companies/:companyId/skills",
    validate(companySkillCreateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const result = await withCompanyRls(db, companyId, async (scopedDb) => {
        await assertCanMutateCompanySkills(req, companyId, scopedDb);
        const created = await companySkillService(scopedDb).createLocalSkill(companyId, req.body);

        const actor = getActorInfo(req);
        await logActivity(scopedDb, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "company.skill_created",
          entityType: "company_skill",
          entityId: created.id,
          details: {
            slug: created.slug,
            name: created.name,
          },
        });
        return created;
      });

      res.status(201).json(result);
    },
  );

  router.patch(
    "/companies/:companyId/skills/:skillId/files",
    validate(companySkillFileUpdateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const skillId = req.params.skillId as string;
      assertCompanyAccess(req, companyId);
      const result = await withCompanyRls(db, companyId, async (scopedDb) => {
        await assertCanMutateCompanySkills(req, companyId, scopedDb);
        const updated = await companySkillService(scopedDb).updateFile(
          companyId,
          skillId,
          String(req.body.path ?? ""),
          String(req.body.content ?? ""),
        );

        const actor = getActorInfo(req);
        await logActivity(scopedDb, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "company.skill_file_updated",
          entityType: "company_skill",
          entityId: skillId,
          details: {
            path: updated.path,
            markdown: updated.markdown,
          },
        });
        return updated;
      });

      res.json(result);
    },
  );

  router.post(
    "/companies/:companyId/skills/import",
    validate(companySkillImportSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const source = String(req.body.source ?? "");
      const result = await withCompanyRls(db, companyId, async (scopedDb) => {
        await assertCanMutateCompanySkills(req, companyId, scopedDb);
        const importedResult = await companySkillService(scopedDb).importFromSource(companyId, source);

        const actor = getActorInfo(req);
        await logActivity(scopedDb, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "company.skills_imported",
          entityType: "company",
          entityId: companyId,
          details: {
            source,
            importedCount: importedResult.imported.length,
            importedSlugs: importedResult.imported.map((skill) => skill.slug),
            warningCount: importedResult.warnings.length,
          },
        });
        return importedResult;
      });
      const telemetryClient = getTelemetryClient();
      if (telemetryClient) {
        for (const skill of result.imported) {
          trackSkillImported(telemetryClient, {
            sourceType: skill.sourceType,
            skillRef: deriveTrackedSkillRef(skill),
          });
        }
      }

      res.status(201).json(result);
    },
  );

  router.post(
    "/companies/:companyId/skills/scan-projects",
    validate(companySkillProjectScanRequestSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const result = await withCompanyRls(db, companyId, async (scopedDb) => {
        await assertCanMutateCompanySkills(req, companyId, scopedDb);
        const scanned = await companySkillService(scopedDb).scanProjectWorkspaces(companyId, req.body);

        const actor = getActorInfo(req);
        await logActivity(scopedDb, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "company.skills_scanned",
          entityType: "company",
          entityId: companyId,
          details: {
            scannedProjects: scanned.scannedProjects,
            scannedWorkspaces: scanned.scannedWorkspaces,
            discovered: scanned.discovered,
            importedCount: scanned.imported.length,
            updatedCount: scanned.updated.length,
            conflictCount: scanned.conflicts.length,
            warningCount: scanned.warnings.length,
          },
        });
        return scanned;
      });

      res.json(result);
    },
  );

  router.delete("/companies/:companyId/skills/:skillId", async (req, res) => {
    const companyId = req.params.companyId as string;
    const skillId = req.params.skillId as string;
    assertCompanyAccess(req, companyId);
    const result = await withCompanyRls(db, companyId, async (scopedDb) => {
      await assertCanMutateCompanySkills(req, companyId, scopedDb);
      const deleted = await companySkillService(scopedDb).deleteSkill(companyId, skillId);
      if (!deleted) {
        return null;
      }
      const actor = getActorInfo(req);
      await logActivity(scopedDb, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "company.skill_deleted",
        entityType: "company_skill",
        entityId: deleted.id,
        details: {
          slug: deleted.slug,
          name: deleted.name,
        },
      });
      return deleted;
    });
    if (!result) {
      res.status(404).json({ error: "Skill not found" });
      return;
    }

    res.json(result);
  });

  router.post("/companies/:companyId/skills/:skillId/install-update", async (req, res) => {
    const companyId = req.params.companyId as string;
    const skillId = req.params.skillId as string;
    assertCompanyAccess(req, companyId);
    const result = await withCompanyRls(db, companyId, async (scopedDb) => {
      await assertCanMutateCompanySkills(req, companyId, scopedDb);
      const installed = await companySkillService(scopedDb).installUpdate(companyId, skillId);
      if (!installed) {
        return null;
      }
      const actor = getActorInfo(req);
      await logActivity(scopedDb, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "company.skill_update_installed",
        entityType: "company_skill",
        entityId: installed.id,
        details: {
          slug: installed.slug,
          sourceRef: installed.sourceRef,
        },
      });
      return installed;
    });
    if (!result) {
      res.status(404).json({ error: "Skill not found" });
      return;
    }

    res.json(result);
  });

  return router;
}
