import { Check, ChevronRight, FileText, Lock, LogOut, Mail, ShieldCheck, Sparkles, UserX, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { ActionButton } from "@/components/action-button";
import { ModelPicker } from "@/components/ai/model-picker";
import { BinanceRenewButton, BinanceReturn } from "@/components/binance-pay";
import { UpgradeButton } from "@/components/upgrade-sheet";
import { CheckoutReturn } from "@/components/checkout-return";
import { DeleteAccountSection } from "@/components/delete-account";
import { MemoryPanel } from "@/components/memory/memory-panel";
import { PlanCard } from "@/components/plan-card";
import { AppAndNotifications } from "@/components/push/app-and-notifications";
import { ThemeSelector } from "@/components/theme-toggle";
import { Notice, PageBody, PageHeader, Panel, Progress, Section, buttonClass } from "@/components/ui";
import { meterTone } from "@/lib/dashboard-copy";
import { shortDate } from "@/lib/format";
import { SUPPORT_EMAIL } from "@/lib/legal";
import { PLANS } from "@/modules/billing/plans";
import type { AIModelsView } from "@/types/ai";
import type { BillingOverview } from "@/types/billing";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
      <span className="text-muted">{label}</span>
      <span className="min-w-0 truncate text-right text-ink">{value}</span>
    </div>
  );
}

function LinkRow({
  href,
  icon: Icon,
  label,
  detail,
  external = false,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  detail?: string;
  /** mailto: y enlaces fuera de la app: <a> normal en vez del enrutador. */
  external?: boolean;
}) {
  const body = (
    <>
      <Icon className="size-4 shrink-0 text-primary" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-ink">{label}</span>
        {detail ? <span className="block truncate text-muted">{detail}</span> : null}
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
    </>
  );
  const className = "flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-surface-2";
  return external ? (
    <a href={href} className={className}>
      {body}
    </a>
  ) : (
    <Link href={href} className={className}>
      {body}
    </Link>
  );
}

function Usage({ label, used, limit }: { label: string; used: number; limit: number }) {
  return (
    <div>
      <div className="mb-1.5 flex justify-between gap-3 text-sm">
        <span className="text-muted">{label}</span>
        <span className="tabular-nums text-ink">
          {used.toLocaleString("es-US")} de {limit.toLocaleString("es-US")}
        </span>
      </div>
      <Progress value={used} max={limit} label={label} tone={meterTone(used, limit)} />
    </div>
  );
}

export function AccountView({
  profile,
  billing,
  models,
  notice = null,
  checkoutSessionId = null,
  binanceOrder = null,
  preview = false,
  deleteOpen = false,
}: {
  profile: { name: string | null; email: string | null; timezone: string; currency: string };
  billing: BillingOverview;
  /** Modelos de IA disponibles y el que eligió la persona (Cuenta → Modelo de IA). */
  models: AIModelsView;
  notice?: "success" | "cancel" | null;
  checkoutSessionId?: string | null;
  /** Orden de Binance Pay al volver del pago (?binance=<orden>). */
  binanceOrder?: string | null;
  preview?: boolean;
  /** Solo la vista previa: abre la hoja de eliminar cuenta. */
  deleteOpen?: boolean;
}) {
  const pro = billing.plan === "PRO";
  const limits = PLANS[billing.plan];
  // Si el servidor trae otra vista de modelos (otra elección, otra llave, otro plan), el selector arranca con ella.
  const modelsKey = [models.plan, models.preference ?? "auto", ...models.providers.map((p) => `${p.id}:${p.configured}`)].join("|");
  return (
    <PageBody>
      <PageHeader title="Cuenta" />
      {notice === "success" ? <CheckoutReturn sessionId={checkoutSessionId} alreadyPro={pro} /> : null}
      {binanceOrder ? <BinanceReturn order={binanceOrder} alreadyPro={pro} /> : null}
      {notice === "cancel" ? <Notice tone="attention">No se hizo ningún cobro. Puedes pasarte a Pro cuando quieras.</Notice> : null}

      <Panel>
        <Row label="Nombre" value={profile.name ?? "Sin nombre"} />
        <Row label="Correo" value={profile.email ?? "Sin correo"} />
        <Row label="Zona horaria" value={profile.timezone} />
        <Row label="Moneda" value={profile.currency} />
      </Panel>

      <Section title="Tu plan">
        <div id="planes" className="rounded-2xl border border-line bg-surface p-5">
          <div className="flex items-baseline justify-between gap-3">
            <p className="flex items-center gap-2 text-lg font-semibold text-ink">
              {pro ? <Sparkles className="size-4 text-orbit" aria-hidden /> : null}
              Plan {limits.name}
            </p>
            <p className="text-sm tabular-nums text-muted">{limits.priceLabel}</p>
          </div>
          {billing.notice === "past_due" ? (
            <p className="mt-3 rounded-xl bg-danger-soft px-3 py-2.5 text-sm font-medium text-danger">
              No pudimos cobrar la renovación. Mantienes Pro mientras se reintenta: actualiza tu tarjeta para no perderlo.
            </p>
          ) : billing.notice === "canceling" && billing.renewsAt ? (
            <p className="mt-3 rounded-xl bg-attention-soft px-3 py-2.5 text-sm font-medium text-attention">
              Cancelaste la renovación: Pro sigue hasta el {shortDate(billing.renewsAt)}.
            </p>
          ) : pro && billing.source === "BINANCE" && billing.renewsAt ? (
            <p className="mt-2 text-sm text-muted">
              Pagado con Binance Pay hasta el {shortDate(billing.renewsAt)}. No se renueva solo: te avisamos antes de que venza.
            </p>
          ) : pro && billing.renewsAt ? (
            <p className="mt-2 text-sm text-muted">Se renueva el {shortDate(billing.renewsAt)}.</p>
          ) : null}
          <div className="mt-4 flex flex-col gap-3">
            <Usage label="Mensajes con Omni este mes" used={billing.usage.messages.used} limit={billing.usage.messages.limit} />
            <Usage label="Precios vigilados" used={billing.usage.watching.used} limit={billing.usage.watching.limit} />
            <Usage label="Formularios leídos con IA" used={billing.usage.formReads.used} limit={billing.usage.formReads.limit} />
            <Usage label="Páginas de tiendas leídas con IA" used={billing.usage.pageReads.used} limit={billing.usage.pageReads.limit} />
          </div>
          <div className="mt-5">
            {!pro ? (
              // La pantalla de Pro compara los planes y cobra con Binance Pay, Stripe (web) o Google Play (Android).
              <UpgradeButton>Desbloquear Omni Pro</UpgradeButton>
            ) : billing.source === "BINANCE" ? (
              <BinanceRenewButton preview={preview} />
            ) : billing.source === "STRIPE" ? (
              preview ? (
                <span className={buttonClass("secondary")}>Administrar suscripción</span>
              ) : (
                <ActionButton
                  endpoint="/api/v1/billing/portal"
                  label={billing.notice === "past_due" ? "Actualizar tarjeta" : "Administrar suscripción"}
                  pendingLabel="Abriendo…"
                  variant={billing.notice === "past_due" ? "primary" : "secondary"}
                  nativeNotice="Administra esta suscripción desde la web."
                />
              )
            ) : (
              <p className="text-sm text-muted">Administra tu suscripción desde Google Play.</p>
            )}
          </div>
        </div>
      </Section>

      <Section title="Modelo de IA">
        <ModelPicker key={modelsKey} initial={models} demo={preview} />
      </Section>

      <Section title="Lo que tus agentes hacen solos">
        <Panel>
          {billing.features.map((feature) => (
            <div key={feature.id} className="flex items-start gap-3 px-4 py-3">
              <span
                className={
                  feature.enabled
                    ? "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-primary text-on-primary"
                    : "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-surface-2 text-muted"
                }
              >
                {feature.enabled ? <Check className="size-3.5" aria-hidden /> : <Lock className="size-3" aria-hidden />}
              </span>
              <div className="min-w-0 text-sm">
                <p className="font-semibold text-ink">
                  {feature.title}
                  {!feature.enabled ? <span className="ml-2 text-xs font-medium text-primary">Pro</span> : null}
                </p>
                <p className="text-muted">{feature.detail}</p>
              </div>
            </div>
          ))}
        </Panel>
      </Section>

      <Section title="Qué incluye cada plan">
        <div className="grid gap-4 sm:grid-cols-2">
          <PlanCard plan={PLANS.FREE} current={!pro} />
          <PlanCard plan={PLANS.PRO} current={pro} />
        </div>
      </Section>

      <Section title="Lo que Omni recuerda">
        <MemoryPanel demo={preview} />
      </Section>

      <Section title="App y notificaciones">
        <AppAndNotifications />
      </Section>

      <Section title="Apariencia">
        <ThemeSelector />
      </Section>

      <Section title="Ayuda y privacidad">
        <Panel>
          <LinkRow href={`mailto:${SUPPORT_EMAIL}`} icon={Mail} label="Escríbenos" detail={SUPPORT_EMAIL} external />
          <LinkRow href="/privacidad" icon={ShieldCheck} label="Política de privacidad" />
          <LinkRow href="/terminos" icon={FileText} label="Términos de uso" />
          <LinkRow href="/eliminar-cuenta" icon={UserX} label="Cómo se borra tu cuenta" />
        </Panel>
      </Section>

      <form action="/auth/signout" method="post" className="mt-8">
        <button type="submit" className={buttonClass("secondary")} disabled={preview}>
          <LogOut className="size-4" aria-hidden />
          Cerrar sesión
        </button>
      </form>

      <DeleteAccountSection billingSource={billing.source} pro={pro} preview={preview} initialOpen={deleteOpen} />
    </PageBody>
  );
}
