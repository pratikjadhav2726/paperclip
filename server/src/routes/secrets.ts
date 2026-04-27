import { Router } from "express";
import type { Db } from "@paperclipai/db";
import {
  SECRET_PROVIDERS,
  type SecretProvider,
  createSecretSchema,
  rotateSecretSchema,
  updateSecretSchema,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { assertBoard, assertCompanyAccess } from "./authz.js";
import { logActivity, secretService } from "../services/index.js";
import { withCompanyRls } from "../services/company-rls.js";

export function secretRoutes(db: Db) {
  const router = Router();
  const configuredDefaultProvider = process.env.PAPERCLIP_SECRETS_PROVIDER;
  const defaultProvider = (
    configuredDefaultProvider && SECRET_PROVIDERS.includes(configuredDefaultProvider as SecretProvider)
      ? configuredDefaultProvider
      : "local_encrypted"
  ) as SecretProvider;

  router.get("/companies/:companyId/secret-providers", (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json(secretService(db).listProviders());
  });

  router.get("/companies/:companyId/secrets", async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const secrets = await withCompanyRls(db, companyId, (scopedDb) =>
      secretService(scopedDb).list(companyId),
    );
    res.json(secrets);
  });

  router.post("/companies/:companyId/secrets", validate(createSecretSchema), async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const created = await withCompanyRls(db, companyId, async (scopedDb) => {
      const secret = await secretService(scopedDb).create(
        companyId,
        {
          name: req.body.name,
          provider: req.body.provider ?? defaultProvider,
          value: req.body.value,
          description: req.body.description,
          externalRef: req.body.externalRef,
        },
        { userId: req.actor.userId ?? "board", agentId: null },
      );

      await logActivity(scopedDb, {
        companyId,
        actorType: "user",
        actorId: req.actor.userId ?? "board",
        action: "secret.created",
        entityType: "secret",
        entityId: secret.id,
        details: { name: secret.name, provider: secret.provider },
      });
      return secret;
    });

    res.status(201).json(created);
  });

  router.post("/secrets/:id/rotate", validate(rotateSecretSchema), async (req, res) => {
    assertBoard(req);
    const id = req.params.id as string;
    const existing = await secretService(db).getById(id);
    if (!existing) {
      res.status(404).json({ error: "Secret not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);

    const rotated = await withCompanyRls(db, existing.companyId, async (scopedDb) => {
      const rotatedSecret = await secretService(scopedDb).rotate(
        id,
        {
          value: req.body.value,
          externalRef: req.body.externalRef,
        },
        { userId: req.actor.userId ?? "board", agentId: null },
      );

      await logActivity(scopedDb, {
        companyId: rotatedSecret.companyId,
        actorType: "user",
        actorId: req.actor.userId ?? "board",
        action: "secret.rotated",
        entityType: "secret",
        entityId: rotatedSecret.id,
        details: { version: rotatedSecret.latestVersion },
      });
      return rotatedSecret;
    });

    res.json(rotated);
  });

  router.patch("/secrets/:id", validate(updateSecretSchema), async (req, res) => {
    assertBoard(req);
    const id = req.params.id as string;
    const existing = await secretService(db).getById(id);
    if (!existing) {
      res.status(404).json({ error: "Secret not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);

    const updated = await withCompanyRls(db, existing.companyId, async (scopedDb) => {
      const updatedSecret = await secretService(scopedDb).update(id, {
        name: req.body.name,
        description: req.body.description,
        externalRef: req.body.externalRef,
      });

      if (!updatedSecret) return null;

      await logActivity(scopedDb, {
        companyId: updatedSecret.companyId,
        actorType: "user",
        actorId: req.actor.userId ?? "board",
        action: "secret.updated",
        entityType: "secret",
        entityId: updatedSecret.id,
        details: { name: updatedSecret.name },
      });
      return updatedSecret;
    });

    if (!updated) {
      res.status(404).json({ error: "Secret not found" });
      return;
    }

    res.json(updated);
  });

  router.delete("/secrets/:id", async (req, res) => {
    assertBoard(req);
    const id = req.params.id as string;
    const existing = await secretService(db).getById(id);
    if (!existing) {
      res.status(404).json({ error: "Secret not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);

    const removed = await withCompanyRls(db, existing.companyId, async (scopedDb) => {
      const removedSecret = await secretService(scopedDb).remove(id);
      if (!removedSecret) return null;

      await logActivity(scopedDb, {
        companyId: removedSecret.companyId,
        actorType: "user",
        actorId: req.actor.userId ?? "board",
        action: "secret.deleted",
        entityType: "secret",
        entityId: removedSecret.id,
        details: { name: removedSecret.name },
      });
      return removedSecret;
    });
    if (!removed) {
      res.status(404).json({ error: "Secret not found" });
      return;
    }

    res.json({ ok: true });
  });

  return router;
}
