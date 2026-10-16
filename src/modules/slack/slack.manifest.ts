// La app de Slack de Omni, lista para crear en un clic: Slack acepta un manifiesto en la URL de «Create New App»
// (https://api.slack.com/apps?new_app=1&manifest_json=…) y deja todo configurado: el comando /omni apuntando a esta
// instalación y el único permiso que hace falta (commands). Omni no guarda tokens de Slack: responde por el
// response_url de cada comando. Puro: sin red ni variables de entorno (la URL pública llega como argumento).

const SLACK_NEW_APP = "https://api.slack.com/apps";

/** La URL pública de Omni sin barra final (https://omniagent-app.netlify.app). */
export function publicBase(appUrl: string): string {
  return appUrl.trim().replace(/\/+$/, "");
}

/** Dónde recibe Slack el comando /omni. */
export function slackCommandUrl(appUrl: string): string {
  return `${publicBase(appUrl)}/api/v1/slack/commands`;
}

export function slackManifest(appUrl: string) {
  return {
    _metadata: { major_version: 2, minor_version: 1 },
    display_information: {
      name: "Omni",
      description: "Tu agente de finanzas, trámites y compras, desde Slack.",
      background_color: "#0f766e",
    },
    features: {
      bot_user: { display_name: "Omni", always_online: false },
      slash_commands: [
        {
          command: "/omni",
          url: slackCommandUrl(appUrl),
          description: "Pregúntale a Omni o pídele algo",
          usage_hint: "¿cuánto gasté este mes?",
          should_escape: false,
        },
      ],
    },
    oauth_config: { scopes: { bot: ["commands"] } },
    settings: { org_deploy_enabled: false, socket_mode_enabled: false, token_rotation_enabled: false },
  };
}

/** «Create New App» de Slack con el manifiesto ya puesto: solo falta elegir el espacio de trabajo. */
export function slackCreateAppUrl(appUrl: string): string {
  return `${SLACK_NEW_APP}?new_app=1&manifest_json=${encodeURIComponent(JSON.stringify(slackManifest(appUrl)))}`;
}
