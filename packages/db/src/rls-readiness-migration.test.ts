import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function readRlsMigration() {
  return readFile(new URL("./migrations/0071_company_rls_readiness.sql", import.meta.url), "utf8");
}

describe("company RLS readiness migration", () => {
  it("adds compatibility-scoped tenant helpers", async () => {
    const migration = await readRlsMigration();

    expect(migration).toContain('CREATE SCHEMA IF NOT EXISTS "paperclip_security"');
    expect(migration).toContain('"paperclip_security"."current_company_id"');
    expect(migration).toContain("current_setting('paperclip.company_id', true)");
    expect(migration).toContain('RETURNS boolean');
  });

  it("enables company-scoped policies without forcing RLS yet", async () => {
    const migration = await readRlsMigration();

    expect(migration).toContain("ALTER TABLE %I ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain('ALTER TABLE "companies" ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('"paperclip_security"."company_permitted"("company_id")');
    expect(migration).toContain('"paperclip_security"."company_permitted"("id")');
    expect(migration).not.toContain("FORCE ROW LEVEL SECURITY");
  });
});
