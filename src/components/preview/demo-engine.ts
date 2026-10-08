// Trabajos de ejemplo del motor y una página web de ejemplo (vista previa: chat, asistente y capturas). Sin API.
import type { SiteContent } from "@/modules/sites/sites.types";
import type { ChatMessageView } from "@/types/cards";
import type { JobStepView, JobView } from "@/types/engine";

type DemoKind = "website" | "sweep" | "finance";

const STEPS: Record<DemoKind, { title: string; playbook: JobView["playbook"]; steps: Omit<JobStepView, "status" | "note">[] }> = {
  website: {
    title: "Crear la página de Dulce Hogar",
    playbook: "website.create",
    steps: [
      { key: "sites.write", title: "Escribir tu página" },
      { key: "sites.review", title: "Revisar que sea segura" },
      { key: "sites.preview", title: "Armar la vista previa" },
      { key: "sites.publish", title: "Esperar tu aprobación para publicar" },
      { key: "sites.memory", title: "Guardarla en tu memoria" },
    ],
  },
  sweep: {
    title: "Poner todo al día",
    playbook: "daily.sweep",
    steps: [
      { key: "finance.sync_accounts", title: "Actualizar tus cuentas" },
      { key: "procedures.mail", title: "Revisar tu correo" },
      { key: "concierge.prices", title: "Revisar tus precios" },
      { key: "returns.orders", title: "Revisar tus pedidos" },
      { key: "summary.today", title: "Resumirte lo nuevo" },
    ],
  },
  finance: {
    title: "Analizar tus finanzas",
    playbook: "finance.analyze",
    steps: [
      { key: "finance.sync_accounts", title: "Actualizar tus cuentas" },
      { key: "finance.subscriptions", title: "Revisar tus suscripciones" },
      { key: "finance.ant_expenses", title: "Buscar gastos hormiga" },
      { key: "finance.report", title: "Preparar tu informe con IA" },
    ],
  },
};

const NOTES: Record<DemoKind, (string | null)[]> = {
  website: [
    "Texto listo, solo con lo que me contaste.",
    "Sin datos inventados, sin enlaces ajenos y sin pedir claves.",
    "Vista previa lista: por ahora solo la ves tú.",
    "Aprobada y publicada.",
    "La recordaré con su enlace.",
  ],
  sweep: ["2 bancos al día, 14 movimientos nuevos.", "6 correos nuevos, 2 trámites sugeridos.", null, null, null],
  finance: [
    "2 bancos al día, 9 movimientos nuevos.",
    "8 suscripciones; 2 parecen sin uso ($20.99 al mes).",
    "$84 al mes en compras pequeñas.",
    "Gastas un 12% más que en agosto: delivery y suscripciones explican casi todo.",
  ],
};

/**
 * Un trabajo de ejemplo con `done` pasos hechos y el siguiente en curso (o esperando una aprobación, con `waiting`).
 * Con `done` igual al total, terminado.
 */
export function demoJob(kind: DemoKind, done: number, opts: { waiting?: boolean; now?: Date } = {}): JobView {
  const now = opts.now ?? new Date();
  const spec = STEPS[kind];
  const total = spec.steps.length;
  const finished = done >= total;
  const waiting = Boolean(opts.waiting) && !finished;
  const steps: JobStepView[] = spec.steps.map((step, i) => ({
    ...step,
    status: i < done ? "SUCCEEDED" : i === done ? (waiting ? "WAITING" : "RUNNING") : "PENDING",
    note: i < done ? NOTES[kind][i] : i === done && waiting ? "Mira la vista previa y apruébala para publicarla." : null,
  }));
  return {
    id: `demo-job-${kind}`,
    playbook: spec.playbook,
    title: spec.title,
    status: finished ? "SUCCEEDED" : waiting ? "WAITING" : "RUNNING",
    steps,
    done: Math.min(done, total),
    total,
    result: finished
      ? kind === "finance"
        ? { summary: "Gastas un 12% más que en agosto. Puedes liberar $146 al mes.", href: "/finanzas", linkLabel: "Ver tu informe", warnings: [] }
        : kind === "sweep"
          ? { summary: "Todo al día: 3 cosas esperan tu aprobación, 2 trámites nuevos en tu correo y 1 precio bajó.", href: "/aprobaciones", linkLabel: "Revisar aprobaciones", warnings: [] }
          : { summary: "La página de Dulce Hogar ya está en línea.", href: "/s/dulce-hogar-demo", linkLabel: "Abrir tu página", warnings: [] }
      : null,
    error: null,
    waitingHref: waiting ? "/aprobaciones" : null,
    retryAt: null,
    cancellable: !finished,
    createdAt: new Date(now.getTime() - 40_000).toISOString(),
    finishedAt: finished ? now.toISOString() : null,
  };
}

/** El chat donde Omni pone todo al día y arma una página web (la tarjeta de cada trabajo, en vivo). */
export function demoEngineConversation(now = new Date()): ChatMessageView[] {
  const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000).toISOString();
  return [
    { id: "demo-engine-1", role: "user", text: "Ponme al día con todo", cards: [], createdAt: at(6) },
    {
      id: "demo-engine-2",
      role: "assistant",
      text: "Listo, ya revisé todo uno por uno. Tienes 3 cosas por aprobar y bajó el precio de los audífonos.",
      cards: [{ kind: "job", job: demoJob("sweep", 5, { now }) }],
      createdAt: at(6),
    },
    {
      id: "demo-engine-3",
      role: "user",
      text: "Créame una página web para mi repostería Dulce Hogar: tortas por encargo y postres para eventos. Mi WhatsApp es +58 414 555 0101",
      cards: [],
      createdAt: at(2),
    },
    {
      id: "demo-engine-4",
      role: "assistant",
      text: "Ya la armé. Mírala en la vista previa: se publica cuando la apruebes.",
      cards: [{ kind: "job", job: demoJob("website", 3, { waiting: true, now }) }],
      suggestions: ["Cambia los colores a verde", "Agrega mi Instagram"],
      createdAt: at(2),
    },
  ];
}

/** Página web de ejemplo (la plantilla pública /s/{slug}, con la paleta que se pida). */
export function demoSiteContent(palette: SiteContent["palette"] = "atardecer"): SiteContent {
  return {
    name: "Dulce Hogar",
    tagline: "Repostería casera en Caracas",
    hero: {
      headline: "Tortas por encargo, hechas en casa",
      subheadline: "Postres para cumpleaños, bodas y reuniones. Los preparamos el mismo día que los entregamos.",
      ctaLabel: "Haz tu pedido por WhatsApp",
    },
    sections: [
      {
        kind: "features",
        title: "Lo que hacemos",
        items: [
          { title: "Tortas por encargo", text: "De chocolate, vainilla o tres leches, con el diseño que quieras.", icon: "corazon" },
          { title: "Postres para eventos", text: "Mesas dulces, cupcakes y galletas decoradas para tu celebración.", icon: "regalo" },
          { title: "Entrega a domicilio", text: "Llevamos tu pedido en Caracas el día acordado.", icon: "envio" },
          { title: "Hechas el mismo día", text: "Sin congelar: cada torta se hornea para tu fecha.", icon: "hoja" },
        ],
      },
      {
        kind: "steps",
        title: "Cómo pedir",
        items: [
          { title: "Escríbenos", text: "Cuéntanos la fecha, el sabor y para cuántas personas." },
          { title: "Confirma tu pedido", text: "Te enviamos el precio y apartamos tu fecha." },
          { title: "Recíbelo", text: "Lo llevamos a tu casa o lo retiras en El Cafetal." },
        ],
      },
      {
        kind: "pricing",
        title: "Precios",
        items: [
          { name: "Torta de 1 kg", price: "$25", detail: "Chocolate, vainilla o tres leches" },
          { name: "Docena de cupcakes", price: "$15", detail: "" },
          { name: "Mesa dulce", price: "Desde $80", detail: "Para 20 personas" },
        ],
        note: "Los precios pueden cambiar según el diseño.",
      },
      {
        kind: "faq",
        title: "Preguntas frecuentes",
        items: [
          { question: "¿Con cuánto tiempo pido?", answer: "Con tres días de anticipación aseguras tu fecha." },
          { question: "¿Hacen tortas sin azúcar?", answer: "Sí, pregúntanos por WhatsApp y te contamos las opciones." },
        ],
      },
    ],
    closing: { title: "¿Celebras algo pronto?", text: "Escríbenos y apartamos tu fecha." },
    contact: {
      whatsapp: "584145550101",
      phone: null,
      email: null,
      instagram: "dulcehogar.ccs",
      website: null,
      address: "El Cafetal, Caracas",
      hours: "Lunes a sábado, de 9:00 a 18:00",
    },
    palette,
  };
}
