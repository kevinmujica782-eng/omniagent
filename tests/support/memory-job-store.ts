import type { JobPatch, JobRow, JobStore, NewJob } from "@/modules/engine/job-store";

// Almacén del motor en memoria para las pruebas: las mismas reglas que prisma-job-store.ts (turno atómico, escrituras
// solo con el turno, llave de "ya estoy en eso" única mientras el trabajo está activo).

const ACTIVE = new Set(["QUEUED", "RUNNING", "WAITING"]);

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class MemoryJobStore implements JobStore {
  readonly rows = new Map<string, JobRow>();
  private seq = 0;

  constructor(private readonly clock: () => Date) {}

  /** Cambia una fila a mano (para simular un ejecutor que se cayó, por ejemplo). */
  patchRow(id: string, patch: Partial<JobRow>): void {
    const row = this.rows.get(id);
    if (row) Object.assign(row, clone(patch));
  }

  row(id: string): JobRow {
    const row = this.rows.get(id);
    if (!row) throw new Error(`No existe el trabajo ${id}`);
    return clone(row);
  }

  private apply(row: JobRow, patch: JobPatch): void {
    const { activeKey, ...rest } = clone(patch);
    Object.assign(row, rest);
    if (activeKey === null) row.activeKey = null;
    row.updatedAt = this.clock();
  }

  async create(job: NewJob): Promise<JobRow | null> {
    const taken = [...this.rows.values()].some((row) => row.userId === job.userId && row.activeKey === job.activeKey);
    if (taken) return null;
    const now = this.clock();
    this.seq += 1;
    const row: JobRow = {
      id: `00000000-0000-4000-8000-${String(this.seq).padStart(12, "0")}`,
      userId: job.userId,
      playbook: job.playbook,
      module: job.module,
      title: job.title,
      status: "QUEUED",
      input: clone(job.input),
      steps: clone(job.steps),
      currentStep: 0,
      result: null,
      errorMessage: null,
      source: job.source,
      conversationId: job.conversationId,
      activeKey: job.activeKey,
      waitingFor: [],
      runAfter: now,
      lockedBy: null,
      lockedUntil: null,
      cancelRequestedAt: null,
      startedAt: null,
      finishedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(row.id, row);
    return clone(row);
  }

  async findActive(userId: string, activeKey: string): Promise<JobRow | null> {
    const row = [...this.rows.values()].find((r) => r.userId === userId && r.activeKey === activeKey && ACTIVE.has(r.status));
    return row ? clone(row) : null;
  }

  async countRunning(userId: string): Promise<number> {
    return [...this.rows.values()].filter((r) => r.userId === userId && (r.status === "QUEUED" || r.status === "RUNNING")).length;
  }

  async find(id: string): Promise<JobRow | null> {
    const row = this.rows.get(id);
    return row ? clone(row) : null;
  }

  async findForUser(userId: string, id: string): Promise<JobRow | null> {
    const row = this.rows.get(id);
    return row && row.userId === userId ? clone(row) : null;
  }

  async listForUser(userId: string, opts: { activeOnly: boolean; take: number }): Promise<JobRow[]> {
    return [...this.rows.values()]
      .filter((r) => r.userId === userId && (!opts.activeOnly || ACTIVE.has(r.status)))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, opts.take)
      .map(clone);
  }

  async claim(id: string, worker: string, now: Date, leaseMs: number): Promise<JobRow | null> {
    const row = this.rows.get(id);
    if (!row) return null;
    const due = (row.status === "QUEUED" || row.status === "WAITING") && row.runAfter.getTime() <= now.getTime();
    const abandoned = row.status === "RUNNING" && row.lockedUntil !== null && row.lockedUntil.getTime() < now.getTime();
    if (!due && !abandoned) return null;
    row.status = "RUNNING";
    row.lockedBy = worker;
    row.lockedUntil = new Date(now.getTime() + leaseMs);
    row.startedAt ??= now;
    row.updatedAt = now;
    return clone(row);
  }

  async update(id: string, worker: string, patch: JobPatch): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || row.lockedBy !== worker) return false;
    this.apply(row, patch);
    return true;
  }

  async release(id: string, worker: string, patch: JobPatch): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || row.lockedBy !== worker) return false;
    this.apply(row, patch);
    row.lockedBy = null;
    row.lockedUntil = null;
    return true;
  }

  async cancelIdle(userId: string, id: string, now: Date, steps: JobRow["steps"]): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || row.userId !== userId || (row.status !== "QUEUED" && row.status !== "WAITING")) return false;
    if (row.lockedBy !== null && row.lockedUntil !== null && row.lockedUntil.getTime() >= now.getTime()) return false;
    Object.assign(row, {
      status: "CANCELED",
      steps: clone(steps),
      activeKey: null,
      waitingFor: [],
      cancelRequestedAt: now,
      finishedAt: now,
      lockedBy: null,
      lockedUntil: null,
    });
    return true;
  }

  async requestCancel(userId: string, id: string, now: Date): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || row.userId !== userId || row.status !== "RUNNING" || row.cancelRequestedAt) return false;
    row.cancelRequestedAt = now;
    return true;
  }

  async due(now: Date, limit: number): Promise<string[]> {
    return [...this.rows.values()]
      .filter(
        (r) =>
          ((r.status === "QUEUED" || r.status === "WAITING") && r.runAfter.getTime() <= now.getTime()) ||
          (r.status === "RUNNING" && r.lockedUntil !== null && r.lockedUntil.getTime() < now.getTime()),
      )
      .sort((a, b) => a.runAfter.getTime() - b.runAfter.getTime())
      .slice(0, limit)
      .map((r) => r.id);
  }

  async wake(actionId: string, now: Date): Promise<string[]> {
    const ids: string[] = [];
    for (const row of this.rows.values()) {
      if (row.status === "WAITING" && row.waitingFor.includes(actionId)) {
        row.runAfter = now;
        ids.push(row.id);
      }
    }
    return ids;
  }
}
