import { ensureProfile } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { handle } from "@/lib/http";
import { getLatestInsights, runFinancialAnalysis } from "@/modules/finance/insights/analysis.service";

// Claude puede tardar unos segundos en redactar el informe.
export const maxDuration = 60;

export async function GET(request: Request) {
  return handle(request, (auth) => getLatestInsights(auth.userId));
}

/**
 * Genera un análisis nuevo de los últimos 3 meses. Tiene límite de frecuencia según el plan,
 * salvo justo después de conectar una cuenta o importar un estado de cuenta (?origen=conexion), cuando hay
 * datos nuevos.
 */
export async function POST(request: Request) {
  return handle(request, async (auth) => {
    await ensureProfile(auth);
    let trigger: "MANUAL" | "CONNECTION" = "MANUAL";
    if (new URL(request.url).searchParams.get("origen") === "conexion") {
      const since = new Date(Date.now() - 10 * 60_000);
      const [justLinked, justImported] = await Promise.all([
        prisma.integrationConnection.findFirst({ where: { userId: auth.userId, updatedAt: { gte: since } }, select: { id: true } }),
        prisma.statementImport.findFirst({
          where: { userId: auth.userId, status: "PARSED", createdAt: { gte: since } },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        }),
      ]);
      // Un estado de cuenta nuevo da derecho a un análisis, no a varios: si ya hubo uno después, cuenta el límite del plan.
      const analyzedSinceImport = justImported
        ? await prisma.financialAnalysis.findFirst({
            where: { userId: auth.userId, createdAt: { gte: justImported.createdAt } },
            select: { id: true },
          })
        : null;
      if (justLinked || (justImported && !analyzedSinceImport)) trigger = "CONNECTION";
    }
    const { card } = await runFinancialAnalysis(auth.userId, { trigger, force: trigger === "CONNECTION" });
    return card;
  });
}
