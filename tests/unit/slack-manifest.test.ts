import { describe, expect, it } from "vitest";
import { slackCommandUrl, slackCreateAppUrl, slackManifest } from "@/modules/slack/slack.manifest";

// La app de Slack de Omni se crea en un clic: el manifiesto viaja en la URL de «Create New App».

describe("app de Slack en un clic", () => {
  it("apunta el comando /omni a la URL pública de esta instalación", () => {
    expect(slackCommandUrl("https://omniagent-app.netlify.app")).toBe("https://omniagent-app.netlify.app/api/v1/slack/commands");
    expect(slackCommandUrl(" https://omniagent-app.netlify.app/ ")).toBe("https://omniagent-app.netlify.app/api/v1/slack/commands");
  });

  it("pide solo el permiso de comandos y nada de tokens", () => {
    const manifest = slackManifest("https://omniagent-app.netlify.app");
    expect(manifest.oauth_config.scopes.bot).toEqual(["commands"]);
    expect(manifest.features.slash_commands).toEqual([
      expect.objectContaining({ command: "/omni", url: "https://omniagent-app.netlify.app/api/v1/slack/commands", should_escape: false }),
    ]);
    expect(manifest.settings).toMatchObject({ socket_mode_enabled: false, org_deploy_enabled: false });
    // Slack limita el nombre a 35 caracteres y la descripción corta a 140.
    expect(manifest.display_information.name.length).toBeLessThanOrEqual(35);
    expect(manifest.display_information.description.length).toBeLessThanOrEqual(140);
  });

  it("lleva el manifiesto completo en la URL de Slack", () => {
    const url = new URL(slackCreateAppUrl("https://omniagent-app.netlify.app/"));
    expect(`${url.origin}${url.pathname}`).toBe("https://api.slack.com/apps");
    expect(url.searchParams.get("new_app")).toBe("1");
    expect(JSON.parse(url.searchParams.get("manifest_json") ?? "{}")).toEqual(slackManifest("https://omniagent-app.netlify.app"));
  });
});
