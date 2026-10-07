"use client";

import {
  FileText,
  House,
  Lightbulb,
  Menu,
  MessageCircle,
  Plug,
  ShieldCheck,
  ShoppingBag,
  SquarePen,
  Target,
  Undo2,
  UserRound,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { AgentBar } from "@/components/agent-bar";
import { AssistantProvider, AssistantTrigger } from "@/components/assistant/assistant-provider";
import type { AssistantPreset } from "@/components/assistant/omni-assistant";
import { OmniMark } from "@/components/omni-mark";
import { UpgradeSheetHost } from "@/components/upgrade-sheet";
import { cn } from "@/lib/cn";
import type { UpgradeRequest } from "@/lib/upgrade";

export type NavKey =
  | "inicio"
  | "chat"
  | "ideas"
  | "metas"
  | "finanzas"
  | "tramites"
  | "compras"
  | "devoluciones"
  | "aprobaciones"
  | "conexiones"
  | "cuenta";

const NAV: { key: NavKey; label: string; icon: LucideIcon }[] = [
  { key: "inicio", label: "Inicio", icon: House },
  { key: "chat", label: "Chat", icon: MessageCircle },
  { key: "finanzas", label: "Finanzas", icon: Wallet },
  { key: "tramites", label: "Trámites", icon: FileText },
  { key: "compras", label: "Compras", icon: ShoppingBag },
  { key: "devoluciones", label: "Devoluciones", icon: Undo2 },
  { key: "ideas", label: "Ideas", icon: Lightbulb },
  { key: "metas", label: "Metas", icon: Target },
  { key: "aprobaciones", label: "Aprobaciones", icon: ShieldCheck },
  { key: "conexiones", label: "Conexiones", icon: Plug },
  { key: "cuenta", label: "Cuenta", icon: UserRound },
];

/** Pestañas del teléfono: las cuatro áreas y Omni al centro (el resto, en el menú). */
const TABS: { key: NavKey; label: string; icon: LucideIcon | null }[] = [
  { key: "inicio", label: "Inicio", icon: House },
  { key: "finanzas", label: "Finanzas", icon: Wallet },
  { key: "chat", label: "Omni", icon: null },
  { key: "tramites", label: "Trámites", icon: FileText },
  { key: "compras", label: "Compras", icon: ShoppingBag },
];

export interface AppShellProps {
  /** `id` es el de Supabase: la compra de Pro en Google Play lo usa para saber a quién activarlo. */
  user: { id?: string | null; name: string | null; email: string | null };
  timeZone: string;
  pendingApprovals: number;
  /** Trámites por confirmar más avisos que ya tocan. */
  proceduresBadge?: number;
  /** Ofertas nuevas y compras que esperan Permitir o Denegar. */
  conciergeBadge?: number;
  /** Pedidos retrasados y reclamos que esperan un paso del usuario. */
  returnsBadge?: number;
  status: string;
  recent: { id: string; title: string }[];
  children: ReactNode;
  /** Vista previa (/preview): la navegación cambia de pantalla de ejemplo en vez de ir a rutas reales. */
  preview?: { active: NavKey; upgrade?: UpgradeRequest | null; assistant?: AssistantPreset | null };
}

export function AppShell({
  user,
  timeZone,
  pendingApprovals,
  proceduresBadge = 0,
  conciergeBadge = 0,
  returnsBadge = 0,
  status,
  recent,
  children,
  preview,
}: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const hrefFor = (key: NavKey) => (preview ? `/preview?screen=${key}` : `/${key}`);
  const isActive = (key: NavKey) =>
    preview ? preview.active === key : pathname === `/${key}` || pathname.startsWith(`/${key}/`);

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Primera visita: guarda la zona horaria del dispositivo para que Omni hable de "mañana a las 8" correctamente.
  useEffect(() => {
    if (preview || timeZone !== "UTC") return;
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!detected || detected === "UTC") return;
    fetch("/api/v1/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timezone: detected }),
    })
      .then((res) => {
        if (res.ok) router.refresh();
      })
      .catch(() => undefined);
  }, [preview, timeZone, router]);

  const nav = (
    <div className="flex h-full flex-col">
      <div className="px-5 pb-4 pt-5">
        <p className="text-lg font-semibold tracking-tight text-ink">OmniAgent</p>
      </div>
      <Link
        href={hrefFor("chat")}
        className="mx-3 mb-3 flex items-center gap-2.5 rounded-xl border border-line bg-surface px-3 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-surface-2"
      >
        <SquarePen className="size-4 text-primary" aria-hidden />
        Nueva conversación
      </Link>
      <nav aria-label="Principal" className="flex flex-col gap-0.5 px-2">
        {NAV.map(({ key, label, icon: Icon }) => {
          const active = isActive(key);
          return (
            <Link
              key={key}
              href={hrefFor(key)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors",
                active ? "bg-primary-soft font-semibold text-primary" : "text-ink hover:bg-surface",
              )}
            >
              <Icon className="size-[18px]" aria-hidden />
              <span>{label}</span>
              {key === "aprobaciones" && pendingApprovals > 0 ? (
                <span className="ml-auto rounded-full bg-attention-soft px-2 py-0.5 text-xs font-semibold tabular-nums text-attention">
                  {pendingApprovals}
                </span>
              ) : null}
              {key === "compras" && conciergeBadge > 0 ? (
                <span
                  className="ml-auto rounded-full bg-attention-soft px-2 py-0.5 text-xs font-semibold tabular-nums text-attention"
                  aria-label={`${conciergeBadge} por revisar`}
                >
                  {conciergeBadge}
                </span>
              ) : null}
              {key === "devoluciones" && returnsBadge > 0 ? (
                <span
                  className="ml-auto rounded-full bg-attention-soft px-2 py-0.5 text-xs font-semibold tabular-nums text-attention"
                  aria-label={`${returnsBadge} por revisar`}
                >
                  {returnsBadge}
                </span>
              ) : null}
              {key === "tramites" && proceduresBadge > 0 ? (
                <span
                  className="ml-auto rounded-full bg-primary-soft px-2 py-0.5 text-xs font-semibold tabular-nums text-primary"
                  aria-label={`${proceduresBadge} por revisar`}
                >
                  {proceduresBadge}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>
      {recent.length > 0 ? (
        <div className="mt-6 min-h-0 flex-1 overflow-y-auto px-2">
          <p className="px-3 pb-1 text-xs font-medium text-muted">Recientes</p>
          {recent.map((conversation) => (
            <Link
              key={conversation.id}
              href={preview ? hrefFor("chat") : `/chat?c=${conversation.id}`}
              className="block truncate rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-surface hover:text-ink"
            >
              {conversation.title}
            </Link>
          ))}
        </div>
      ) : (
        <div className="flex-1" />
      )}
      <div className="border-t border-line px-5 py-4">
        <p className="truncate text-sm font-medium text-ink">{user.name ?? "Tu cuenta"}</p>
        {user.email ? <p className="truncate text-xs text-muted">{user.email}</p> : null}
      </div>
    </div>
  );

  const badgeFor = (key: NavKey) =>
    key === "tramites" ? proceduresBadge : key === "compras" ? conciergeBadge : key === "devoluciones" ? returnsBadge : 0;
  // En la conversación la barra de pestañas se oculta: el campo para escribir ocupa ese lugar.
  const showTabs = !isActive("chat");

  return (
    <AssistantProvider
      status={status}
      counts={{ approvals: pendingApprovals, procedures: proceduresBadge, offers: conciergeBadge, orders: returnsBadge }}
      userId={user.id ?? null}
      links={{
        chat: (conversationId) => (preview ? hrefFor("chat") : conversationId ? `/chat?c=${conversationId}` : "/chat"),
        approvals: hrefFor("aprobaciones"),
      }}
      demo={Boolean(preview)}
      preset={preview?.assistant ?? null}
    >
    <div className="flex h-dvh overflow-hidden bg-canvas">
      <aside className="hidden w-64 shrink-0 border-r border-line bg-surface-2 lg:block">{nav}</aside>

      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menú">
          <button
            type="button"
            aria-label="Cerrar menú"
            className="absolute inset-0 h-full w-full bg-black/40"
            onClick={() => setOpen(false)}
          />
          <div className="relative h-full w-[84%] max-w-xs bg-surface-2 shadow-float">
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Cerrar menú"
              className="absolute right-3 top-4 grid size-9 place-items-center rounded-full text-muted hover:bg-surface"
            >
              <X className="size-5" aria-hidden />
            </button>
            {nav}
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <AgentBar
          status={status}
          pending={pendingApprovals}
          approvalsHref={hrefFor("aprobaciones")}
          summon
          leading={
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-label="Abrir menú"
              className="grid size-10 shrink-0 place-items-center rounded-full border border-line bg-surface text-ink lg:hidden"
            >
              <Menu className="size-5" aria-hidden />
            </button>
          }
        />
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
        {showTabs ? (
          <nav
            aria-label="Secciones"
            className="shrink-0 border-t border-line bg-tabbar pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
          >
            <div className="mx-auto grid max-w-lg grid-cols-5">
              {TABS.map(({ key, label, icon: Icon }) => {
                const active = isActive(key);
                const badge = badgeFor(key);
                // La pestaña del centro es Omni: abre el asistente (el chat sigue en el menú y en el asistente).
                if (!Icon) {
                  return (
                    <AssistantTrigger
                      key={key}
                      aria-label="Hablar con Omni"
                      className="flex flex-col items-center gap-0.5 pb-1.5 pt-2 active:scale-95"
                    >
                      <span className="relative grid h-8 w-14 place-items-center rounded-full">
                        <OmniMark size={28} />
                      </span>
                      <span className="text-[11px] leading-tight text-muted">{label}</span>
                    </AssistantTrigger>
                  );
                }
                return (
                  <Link
                    key={key}
                    href={hrefFor(key)}
                    aria-current={active ? "page" : undefined}
                    aria-label={badge > 0 ? `${label}, ${badge} por revisar` : label}
                    className="flex flex-col items-center gap-0.5 pb-1.5 pt-2 active:scale-95"
                  >
                    <span
                      className={cn(
                        "relative grid h-8 w-14 place-items-center rounded-full transition-colors",
                        active ? "bg-primary-soft text-primary" : "text-muted",
                      )}
                    >
                      <Icon className="size-[21px]" aria-hidden />
                      {badge > 0 ? (
                        <span className="absolute right-1.5 top-0 min-w-4 rounded-full bg-orbit px-1 text-center text-[10px] font-bold leading-4 text-[#2a1d05] tabular-nums">
                          {badge}
                        </span>
                      ) : null}
                    </span>
                    <span className={cn("text-[11px] leading-tight", active ? "font-semibold text-primary" : "text-muted")}>{label}</span>
                  </Link>
                );
              })}
            </div>
          </nav>
        ) : null}
      </div>
      <UpgradeSheetHost preview={Boolean(preview)} initial={preview?.upgrade ?? null} userId={user.id ?? null} />
    </div>
    </AssistantProvider>
  );
}
