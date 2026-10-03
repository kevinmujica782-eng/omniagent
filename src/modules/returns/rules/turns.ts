// A quién pone al día cada corrida del trabajo programado de devoluciones. Pura y determinista.

const HOUR = 3_600_000;

/**
 * Los urgentes (un seguimiento vencido, un reembolso por confirmar) siempre entran; en el lugar que queda va el turno
 * que toca de los demás. Cada hora el turno empieza en otro punto de la lista (ordenada), así nadie queda siempre
 * afuera cuando hay más personas que lugares.
 */
export function pickReturnUsers(urgent: string[], others: string[], limit: number, now: Date): string[] {
  const first = [...new Set(urgent)].sort().slice(0, limit);
  const taken = new Set(first);
  const rest = [...new Set(others)].filter((id) => !taken.has(id)).sort();
  const room = limit - first.length;
  if (room <= 0 || rest.length === 0) return first;
  const start = (Math.floor(now.getTime() / HOUR) * room) % rest.length;
  return [...first, ...[...rest.slice(start), ...rest.slice(0, start)].slice(0, room)];
}
