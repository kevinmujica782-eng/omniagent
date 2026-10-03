"use client";

import { CircleAlert, Loader, PackagePlus, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { Dialog } from "@/components/dialog";
import { INPUT_CLASS, buttonClass, type ButtonSize, type ButtonVariant } from "@/components/ui";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { toLocalInput } from "@/modules/procedures/time/tz";
import type { TrackedOrderView } from "@/types/cards";

// Agregar a mano un pedido hecho fuera de OmniAgent, o corregir los datos de uno (la tienda, su correo de atención,
// la fecha prometida). Con `demo` no llama a la API (vista previa).

const day = (iso: string | null, timeZone: string) => (iso ? toLocalInput(new Date(iso), timeZone).slice(0, 10) : "");

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-ink">{label}</span>
      <span className="mt-1.5 block">{children}</span>
      {hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export function OrderFormDialog({
  mode,
  order,
  timeZone,
  currency,
  onClose,
  demo = false,
}: {
  mode: "add" | "edit";
  order?: TrackedOrderView;
  timeZone: string;
  currency: string;
  onClose: () => void;
  demo?: boolean;
}) {
  const router = useRouter();
  const today = toLocalInput(new Date(), timeZone).slice(0, 10);
  const [merchant, setMerchant] = useState(order?.merchant ?? "");
  const [title, setTitle] = useState(order?.title ?? "");
  const [orderNumber, setOrderNumber] = useState(order?.orderNumber ?? "");
  const [orderedOn, setOrderedOn] = useState(order ? day(order.orderedAt, timeZone) : today);
  const [expectedOn, setExpectedOn] = useState(order ? day(order.expectedBy, timeZone) : "");
  const [delivered, setDelivered] = useState(false);
  const [total, setTotal] = useState(order?.total ? String(order.total) : "");
  const [supportEmail, setSupportEmail] = useState(order?.supportEmail ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const amount = total.trim() ? Number(total.replace(",", ".")) : null;
    if (amount !== null && !(amount > 0)) {
      setError("Escribe el total como un número mayor que cero.");
      return;
    }
    if (demo) {
      setDone(mode === "add" ? "Pedido agregado. (Vista previa: no se guarda.)" : "Datos guardados. (Vista previa: no se guardan.)");
      return;
    }
    setBusy(true);
    try {
      if (mode === "add") {
        await apiFetch("/api/v1/returns/orders", {
          method: "POST",
          body: {
            merchant,
            title,
            orderNumber: orderNumber.trim() || null,
            orderedOn: orderedOn || null,
            expectedOn: delivered ? null : expectedOn || null,
            deliveredOn: delivered ? today : null,
            total: amount,
            currency,
            supportEmail: supportEmail.trim() || null,
          },
        });
      } else if (order) {
        await apiFetch(`/api/v1/returns/orders/${order.id}`, {
          method: "PATCH",
          body: {
            action: "edit",
            merchant,
            title,
            orderNumber: orderNumber.trim() || null,
            expectedOn: expectedOn || null,
            supportEmail: supportEmail.trim() || null,
            total: amount,
          },
        });
      }
      router.refresh();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={mode === "add" ? "Agregar un pedido" : "Datos del pedido"} onClose={onClose} closable={!busy}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        {mode === "add" ? (
          <p className="flex items-start gap-1.5 rounded-xl bg-surface-2 px-3 py-2 text-xs leading-relaxed text-muted">
            <Sparkles className="mt-px size-3.5 shrink-0 text-primary" aria-hidden />
            Los pedidos que haces en Compras y los avisos de envío de tu correo se agregan solos. Aquí van los demás.
          </p>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tienda">
            <input required minLength={2} maxLength={80} value={merchant} onChange={(e: ChangeEvent<HTMLInputElement>) => setMerchant(e.target.value)} placeholder="Mercado Libre" className={INPUT_CLASS} />
          </Field>
          <Field label="N.º de pedido (opcional)">
            <input maxLength={40} value={orderNumber} onChange={(e: ChangeEvent<HTMLInputElement>) => setOrderNumber(e.target.value)} placeholder="2000004567891234" className={INPUT_CLASS} />
          </Field>
        </div>
        <Field label="Qué compraste">
          <input required minLength={2} maxLength={160} value={title} onChange={(e: ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)} placeholder="Lámpara LED de escritorio" className={INPUT_CLASS} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          {mode === "add" ? (
            <Field label="Fecha de compra">
              <input type="date" max={today} value={orderedOn} onChange={(e: ChangeEvent<HTMLInputElement>) => setOrderedOn(e.target.value)} className={INPUT_CLASS} />
            </Field>
          ) : null}
          <Field label="Llega el" hint="La fecha que prometió la tienda: así Omni sabe si se atrasa.">
            <input
              type="date"
              value={expectedOn}
              disabled={delivered}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setExpectedOn(e.target.value)}
              className={cn(INPUT_CLASS, delivered && "opacity-50")}
            />
          </Field>
          <Field label={`Total (${currency}, opcional)`}>
            <input inputMode="decimal" value={total} onChange={(e: ChangeEvent<HTMLInputElement>) => setTotal(e.target.value)} placeholder="35.00" className={INPUT_CLASS} />
          </Field>
        </div>
        <Field label="Correo de atención de la tienda (opcional)" hint="Si lo tienes, Omni puede enviarle los reclamos desde tu correo, siempre con tu aprobación.">
          <input type="email" maxLength={200} value={supportEmail} onChange={(e: ChangeEvent<HTMLInputElement>) => setSupportEmail(e.target.value)} placeholder="ayuda@tienda.com" className={INPUT_CLASS} />
        </Field>
        {mode === "add" ? (
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={delivered} onChange={(e: ChangeEvent<HTMLInputElement>) => setDelivered(e.target.checked)} className="size-4 accent-primary" />
            Ya me llegó (para seguir el plazo de devolución)
          </label>
        ) : null}

        {error ? (
          <p role="alert" className="flex items-start gap-2 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {error}
          </p>
        ) : null}
        {done ? (
          <p role="status" className="rounded-xl bg-primary-soft px-3 py-2 text-sm text-primary">
            {done}
          </p>
        ) : null}

        <div className="mt-2 flex flex-col gap-2">
          <button type="submit" disabled={busy} className={cn(buttonClass("primary", "lg"), "w-full")}>
            {busy ? <Loader className="size-4 animate-spin" aria-hidden /> : null}
            {mode === "add" ? "Agregar pedido" : "Guardar"}
          </button>
          <button type="button" onClick={onClose} disabled={busy} className={buttonClass("ghost")}>
            {done ? "Cerrar" : "Cancelar"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function AddOrderButton({
  timeZone,
  currency,
  demo = false,
  variant = "secondary",
  size = "sm",
  className,
}: {
  timeZone: string;
  currency: string;
  demo?: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cn(buttonClass(variant, size), className)}>
        <PackagePlus className="size-4" aria-hidden />
        Agregar un pedido
      </button>
      {open ? <OrderFormDialog mode="add" timeZone={timeZone} currency={currency} onClose={() => setOpen(false)} demo={demo} /> : null}
    </>
  );
}

/** "Probar con pedidos de ejemplo": tres pedidos en tiendas de prueba para ver el ciclo completo. */
export function ExampleOrdersButton({ demo = false, className }: { demo?: boolean; className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (demo) {
    return (
      <div className={className}>
        <Link href="/preview?screen=devoluciones" className={cn(buttonClass("secondary", "lg"), "w-full sm:w-auto")}>
          Probar con pedidos de ejemplo
        </Link>
      </div>
    );
  }
  return (
    <div className={className}>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await apiFetch("/api/v1/returns/examples", { method: "POST" });
            router.refresh();
          } catch (err) {
            setError(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
        className={cn(buttonClass("secondary", "lg"), "w-full sm:w-auto")}
      >
        {busy ? <Loader className="size-4 animate-spin" aria-hidden /> : null}
        Probar con pedidos de ejemplo
      </button>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
