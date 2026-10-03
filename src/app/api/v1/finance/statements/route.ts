import { handle } from "@/lib/http";
import { listStatementAccounts } from "@/modules/finance/statement-import/statements.service";

/** GET /api/v1/finance/statements — cuentas manuales con sus estados de cuenta importados. */
export async function GET(request: Request) {
  return handle(request, (auth) => listStatementAccounts(auth.userId));
}
