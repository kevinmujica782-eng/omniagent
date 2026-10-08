import "server-only";
import type { PlaybookId } from "@/types/engine";
import { isPlaybookId } from "../engine.rules";
import type { PlaybookDefinition } from "../engine.types";
import { dailySweep } from "./daily-sweep";
import { financeAnalysis } from "./finance-analysis";
import { websiteCreate, websiteUpdate } from "./website";

/** Lo que el motor sabe hacer de principio a fin. Un playbook nuevo se registra aquí y en PLAYBOOK_IDS. */
export const PLAYBOOKS: Readonly<Record<PlaybookId, PlaybookDefinition>> = {
  "finance.analyze": financeAnalysis,
  "daily.sweep": dailySweep,
  "website.create": websiteCreate,
  "website.update": websiteUpdate,
};

export function findPlaybook(id: string): PlaybookDefinition | undefined {
  return isPlaybookId(id) ? PLAYBOOKS[id] : undefined;
}

export { dailySweep, financeAnalysis, websiteCreate, websiteUpdate };
