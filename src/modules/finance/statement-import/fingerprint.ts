import { createHash } from "node:crypto";
import { fold } from "./text";
import type { StatementRow } from "./types";

/**
 * Identificador estable de cada movimiento importado (va en transactions.external_id, único por cuenta).
 * Volver a subir el mismo estado de cuenta, o uno que se encima con el anterior, no duplica movimientos.
 * Dos cafés iguales el mismo día son dos movimientos: el número de aparición los distingue.
 * El sentido (cargo/abono) no entra: a veces se deduce del saldo anterior, que el archivo siguiente puede no traer,
 * y el mismo movimiento quedaría dos veces con signos opuestos.
 */
export function fingerprintRows(rows: StatementRow[]): string[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const key = [row.date, row.amountCents, fold(row.description)].join("|");
    const occurrence = (seen.get(key) ?? 0) + 1;
    seen.set(key, occurrence);
    return `stmt_${createHash("sha256").update(`${key}|${occurrence}`).digest("base64url").slice(0, 32)}`;
  });
}
