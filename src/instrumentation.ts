// Ganchos de arranque de Next.js: revisa la configuración una vez y registra en los logs estructurados
// los errores de Server Components, Route Handlers y Server Actions (con su digest, que es lo que ve el usuario).

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const [{ checkConfig }, { log }] = await Promise.all([import("./lib/config-check"), import("./lib/log")]);
  const report = checkConfig(process.env, process.env.NODE_ENV === "production");
  if (report.critical.length) log.error("config.missing_critical", { keys: report.critical });
  if (report.recommended.length) log.warn("config.missing_recommended", { keys: report.recommended });
  for (const warning of report.warnings) log.warn("config.warning", { warning });
}

export async function onRequestError(
  error: unknown,
  request: { path: string; method: string },
  context: { routerKind: string; routePath: string; routeType: string },
) {
  const { log } = await import("./lib/log");
  log.error("next.request_error", {
    error,
    digest: (error as { digest?: string } | null)?.digest,
    method: request.method,
    path: request.path.split("?")[0],
    route: context.routePath,
    routeType: context.routeType,
  });
}
