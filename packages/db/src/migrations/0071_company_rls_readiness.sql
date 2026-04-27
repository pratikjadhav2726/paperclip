CREATE SCHEMA IF NOT EXISTS "paperclip_security";
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "paperclip_security"."current_company_id"()
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  raw_company_id text;
BEGIN
  raw_company_id := current_setting('paperclip.company_id', true);
  IF raw_company_id IS NULL OR btrim(raw_company_id) = '' THEN
    RETURN NULL;
  END IF;

  RETURN raw_company_id::uuid;
EXCEPTION
  WHEN invalid_text_representation THEN
    RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "paperclip_security"."company_permitted"(row_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT "paperclip_security"."current_company_id"() IS NULL
    OR row_company_id = "paperclip_security"."current_company_id"();
$$;
--> statement-breakpoint
DO $$
DECLARE
  target_table record;
  policy_name text;
BEGIN
  FOR target_table IN
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN information_schema.columns col
      ON col.table_schema = n.nspname
      AND col.table_name = c.relname
      AND col.column_name = 'company_id'
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
  LOOP
    policy_name := target_table.table_name || '_company_rls';
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target_table.table_name);

    IF NOT EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = target_table.table_name
        AND policyname = policy_name
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I AS PERMISSIVE FOR ALL USING ("paperclip_security"."company_permitted"("company_id")) WITH CHECK ("paperclip_security"."company_permitted"("company_id"))',
        policy_name,
        target_table.table_name
      );
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
DO $$
DECLARE
  policy_name text := 'companies_company_rls';
BEGIN
  ALTER TABLE "companies" ENABLE ROW LEVEL SECURITY;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'companies'
      AND policyname = policy_name
  ) THEN
    CREATE POLICY "companies_company_rls"
      ON "companies"
      AS PERMISSIVE
      FOR ALL
      USING ("paperclip_security"."company_permitted"("id"))
      WITH CHECK ("paperclip_security"."company_permitted"("id"));
  END IF;
END $$;
