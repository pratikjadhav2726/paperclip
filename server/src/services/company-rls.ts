import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";

type TransactionDb = Db;
type TransactionCapableDb = Pick<Db, "transaction">;

export async function withCompanyRls<T>(
  db: TransactionCapableDb,
  companyId: string,
  operation: (scopedDb: TransactionDb) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`
      select set_config('paperclip.company_id', ${companyId}, true)
    `);

    return operation(tx as unknown as TransactionDb);
  });
}
