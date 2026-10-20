import { Download, FileText, ShieldCheck, Trash2, Wallet } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { ChatScreen, ListScreen } from "@/components/landing";
import { LegalLinks } from "@/components/legal-page";
import { OmniMark } from "@/components/omni-mark";
import { PhoneFrame } from "@/components/phone-frame";
import { PlanCard } from "@/components/plan-card";
import { demoData } from "@/components/preview/demo-data";
import { ButtonLink, Dot, Panel, buttonClass } from "@/components/ui";
import { GoalRow, TrackingRow } from "@/components/views/goals-view";
import { PLANS, cadenceText } from "@/modules/billing/plans";

// Página de ventas para las personas que llegan por los anuncios de WhatsApp: qué hace Omni (con las pantallas de
// ejemplo de la app), cuánto cuesta, cómo se paga con Binance Pay y cómo empezar. Todo lleva a /descargar.

const FREE = PLANS.FREE;
const PRO = PLANS.PRO;
const PRO_USDT = PRO.price.replace("$", "");

const TRUST: { icon: typeof ShieldCheck; title: string; body: string }[] = [
  {
    icon: ShieldCheck,
    title: "Tú decides",
    body: "Omni te muestra el detalle y espera tu aprobación. Nada se paga, se envía ni se cancela sin tu permiso.",
  },
  {
    icon: FileText,
    title: "Sin la clave de tu banco",
    body: "Para revisar tus gastos subes tu estado de cuenta en PDF o le tomas una foto. Omni no te pide la clave del banco.",
  },
  {
    icon: Trash2,
    title: "Tus datos son tuyos",
    body: "Borras tu cuenta y todo lo que Omni guardó desde la misma app, cuando quieras.",
  },
];

const START: { title: string; body: ReactNode }[] = [
  {
    title: "Descarga la app",
    body: (
      <>
        En Android baja el archivo e instálalo. En iPhone ábrela en Safari y toca <b className="text-ink">Compartir</b> →{" "}
        <b className="text-ink">Agregar a inicio</b>. En la computadora, úsala desde el navegador.
      </>
    ),
  },
  {
    title: "Crea tu cuenta",
    body: "Con tu correo y una contraseña. El plan Gratis queda activo de una vez.",
  },
  {
    title: "Pásate a Pro si quieres",
    body: (
      <>
        En la app toca <b className="text-ink">Pro</b> → <b className="text-ink">Desbloquear Omni Pro</b>, envía {PRO_USDT} USDT
        desde Binance Pay y pega el ID de la orden. Pro se activa en el momento.
      </>
    ),
  },
];

const FAQ: { q: string; a: string }[] = [
  {
    q: "¿De verdad es gratis?",
    a: `Sí. El plan Gratis no vence: ${FREE.monthlyMessages} mensajes al mes, ${FREE.watchlistItems} precios vigilados y tu correo revisado ${cadenceText(FREE.mailCheckHours * 60)}. Pro te da más de todo y una IA más capaz.`,
  },
  {
    q: "¿Cómo pago Pro?",
    a: `Con Binance Pay. Desde tu app de Binance envías ${PRO_USDT} USDT (o USDC) a nuestro Pay ID y pegas en Omni el ID de la orden. Con un solo pago puedes cubrir varios meses.`,
  },
  {
    q: "¿Se me cobra solo cada mes?",
    a: "No. Pagas mes a mes, cuando tú quieras. Tres días antes de vencer, Omni te avisa. Si no renuevas, vuelves al plan Gratis.",
  },
  {
    q: "¿Funciona en mi teléfono?",
    a: "Sí: en Android con la app, en iPhone desde Safari y en cualquier computadora desde el navegador. Es la misma cuenta en todos.",
  },
  {
    q: "¿Qué tan seguro es?",
    a: "Omni solo revisa lo que tú le das y te pide permiso antes de enviar o pagar algo. No necesita la clave de tu banco, y puedes borrar tu cuenta y tus datos cuando quieras.",
  },
];

export function SalesPage() {
  const demo = demoData();
  const m = demo.message;

  const features: { key: string; title: string; body: string; composer: boolean; content: ReactNode }[] = [
    {
      key: "finanzas",
      title: "Analiza tu dinero automáticamente",
      body: "Sube un estado de cuenta en PDF o foto. Omni encuentra gastos hormiga, suscripciones que no usas, y te dice dónde ahorrar.",
      composer: true,
      content: (
        <ChatScreen
          messages={[
            m("f1", "user", "¿A dónde se va mi dinero?"),
            m("f2", "assistant", "Gastas $4,212 al mes. Encontré 5 suscripciones inactivas y $340 en compras innecesarias.", [demo.financeSummary]),
          ]}
        />
      ),
    },
    {
      key: "precios",
      title: "Vigila precios y boletos",
      body: "Pega enlaces de productos, vuelos o hoteles. Omni avisa cuando bajan y te muestra la gráfica de precios.",
      composer: true,
      content: (
        <ChatScreen
          messages={[
            m("p1", "user", "Avísame si los audífonos bajan de $260 o si hay vuelos baratos a Miami"),
            m("p2", "assistant", "Listo. Reviso en segundo plano cada hora.", [
              demo.tracking,
            ]),
            m("p3", "assistant", "Los audífonos bajaron a **$247**, 24% menos."),
          ]}
        />
      ),
    },
    {
      key: "tramites",
      title: "Trámites sin olvidos, formularios automáticos",
      body: "Conecta tu correo: Omni detecta qué tienes pendiente, llena formularios en PDF, te avisa de fechas límite.",
      composer: true,
      content: (
        <ChatScreen
          messages={[
            m("t1", "assistant", "Encontré 2 trámites: el permiso de escuela (vence en 5 días) y tu afiliación dental.", [
              demo.task,
            ]),
            m("t2", "assistant", "¿Lleno el formulario de permiso con tus datos guardados?", [
              demo.calendar,
            ]),
          ]}
        />
      ),
    },
    {
      key: "compras",
      title: "Compras sin sorpresas",
      body: "Omni vigila tus pedidos, detecta retrasos, y reclama automáticamente si algo va mal o no llega.",
      composer: true,
      content: (
        <ChatScreen
          messages={[
            m("c1", "assistant", "Tu pedido de Amazon llegaba hoy. Aún no ha llegado. ¿Preparo un reclamo?", []),
            m("c2", "user", "Sí, por favor"),
            m("c3", "assistant", "Listo. Envié el reclamo a Amazon. Te aviso cuando respondan.", []),
          ]}
        />
      ),
    },
    {
      key: "metas",
      title: "Metas y planes de ahorro",
      body: "Dile cuánto quieres ahorrar y para cuándo. Omni te arma el plan mensual y te dice cómo vas.",
      composer: false,
      content: (
        <ListScreen title="Metas">
          <p className="mb-2 flex items-center gap-2 px-1 text-sm font-semibold text-ink">
            <Dot tone="primary" />
            Mis metas
          </p>
          <Panel>
            {demo.goals.slice(0, 2).map((goal) => (
              <GoalRow key={goal.goalId} goal={goal} />
            ))}
          </Panel>
        </ListScreen>
      ),
    },
    {
      key: "documentos",
      title: "Tus documentos organizados",
      body: "Guarda datos personales cifrados (teléfono, dirección, CURP). Omni los usa para rellenar formularios en segundos.",
      composer: false,
      content: (
        <ListScreen title="Mis datos">
          <p className="mb-2 flex items-center gap-2 px-1 text-sm font-semibold text-ink">
            <FileText className="size-4" />
            Guardados
          </p>
          <Panel>
            <div className="space-y-3 px-4 py-3">
              <p className="flex items-center justify-between text-sm"><span>Teléfono</span><span className="text-muted">•••••5420</span></p>
              <p className="flex items-center justify-between text-sm"><span>Correo</span><span className="text-muted">tu@correo.com</span></p>
              <p className="flex items-center justify-between text-sm"><span>Dirección</span><span className="text-muted">Guardada</span></p>
            </div>
          </Panel>
        </ListScreen>
      ),
    },
  ];

  return (
    <div className="min-h-dvh bg-canvas pb-24 sm:pb-0">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
        <Link href="/conoce" className="flex items-center gap-2.5">
          <OmniMark size={30} />
          <span className="text-lg font-semibold tracking-tight text-ink">OmniAgent</span>
        </Link>
        <ButtonLink href="/descargar" size="sm">
          Descargar
        </ButtonLink>
      </header>

      <section className="mx-auto grid max-w-5xl items-center gap-10 px-4 pb-16 pt-4 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:pt-12">
        <div>
          <h1 className="text-[2.45rem] font-semibold leading-[1.05] tracking-tight text-balance text-ink sm:text-6xl">
            Tu asistente con IA para ahorrar y no olvidar nada.
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-pretty text-muted">
            Le escribes a Omni como en un chat. Revisa tus gastos, vigila precios y te recuerda tus trámites. Nada se paga ni
            se envía sin tu permiso.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <ButtonLink href="/descargar" size="lg">
              <Download className="size-5" aria-hidden />
              Descargar gratis
            </ButtonLink>
            <a href="#precios" className={buttonClass("secondary", "lg")}>
              Ver precios
            </a>
          </div>
          <p className="mt-4 text-sm text-muted">Para Android, iPhone y computadora. Empiezas gratis, sin tarjeta.</p>
        </div>
        <figure className="mx-auto w-full max-w-[20rem]">
          <PhoneFrame label="Omni revisa tus gastos" status={demo.status} pending={2}>
            <ChatScreen
              messages={[
                m("f1", "user", "¿A dónde se va mi dinero?"),
                m("f2", "assistant", "Gastas $4,212 al mes. Lo que más creció: **Restaurantes (+38%)**.", [demo.financeSummary]),
              ]}
            />
          </PhoneFrame>
          <figcaption className="mt-3 text-center text-xs text-muted">Ejemplo con datos de muestra.</figcaption>
        </figure>
      </section>

      <section aria-labelledby="que-hace" className="pb-16">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <h2 id="que-hace" className="max-w-2xl text-3xl font-semibold tracking-tight text-balance text-ink">
            Lo que Omni hace por ti
          </h2>
          <p className="mt-3 max-w-2xl leading-relaxed text-muted">
            Todo desde un chat. Omni analiza tus gastos y suscripciones, vigila precios y boletos, llena tus formularios automáticamente,
            recuerda tus trámites, rastrea tus compras y reclamos, te ayuda a ahorrar, y guarda tus datos de forma segura. Nada se paga,
            se envía ni se cancela sin tu aprobación.
          </p>
        </div>
        <div className="no-scrollbar mt-8 flex snap-x snap-mandatory gap-6 overflow-x-auto px-4 pb-4 sm:px-6 lg:mx-auto lg:grid lg:max-w-5xl lg:grid-cols-3 lg:gap-8 lg:overflow-visible">
          {features.map((feature) => (
            <figure key={feature.key} className="flex w-[19rem] shrink-0 snap-center flex-col lg:w-auto">
              <PhoneFrame label={feature.title} status={demo.status} pending={2} composer={feature.composer}>
                {feature.content}
              </PhoneFrame>
              <figcaption className="mt-5 px-1">
                <h3 className="text-lg font-semibold tracking-tight text-ink">{feature.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{feature.body}</p>
              </figcaption>
            </figure>
          ))}
        </div>
        <p className="mx-auto mt-2 max-w-5xl px-4 text-xs text-muted sm:px-6">Ejemplos con datos de muestra.</p>
      </section>

      <section aria-labelledby="confianza" className="border-y border-line bg-surface">
        <div className="mx-auto max-w-5xl px-4 py-14 sm:px-6">
          <h2 id="confianza" className="max-w-xl text-3xl font-semibold tracking-tight text-balance text-ink">
            Omni propone. Tú apruebas.
          </h2>
          <ul className="mt-8 grid gap-8 md:grid-cols-3">
            {TRUST.map(({ icon: Icon, title, body }) => (
              <li key={title}>
                <Icon className="size-6 text-primary" aria-hidden />
                <h3 className="mt-3 text-lg font-semibold text-ink">{title}</h3>
                <p className="mt-1.5 leading-relaxed text-muted">{body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="precios" aria-labelledby="precios-titulo" className="mx-auto max-w-5xl scroll-mt-4 px-4 py-16 sm:px-6">
        <h2 id="precios-titulo" className="max-w-2xl text-3xl font-semibold tracking-tight text-balance text-ink">
          Empieza gratis. Pásate a Pro cuando quieras.
        </h2>
        <div className="mt-8 grid max-w-3xl gap-4 sm:grid-cols-2">
          <PlanCard
            plan={FREE}
            cta={
              <ButtonLink href="/descargar" variant="secondary" className="w-full">
                Descargar gratis
              </ButtonLink>
            }
          />
          <PlanCard
            plan={PRO}
            cta={
              <ButtonLink href="/descargar" className="w-full">
                Empezar con Pro
              </ButtonLink>
            }
          />
        </div>
        <div className="mt-4 flex max-w-3xl gap-3 rounded-2xl border border-line bg-surface p-5">
          <Wallet className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
          <p className="text-sm leading-relaxed text-muted">
            <b className="text-ink">Pro cuesta {PRO_USDT} USDT al mes y se paga con Binance Pay</b>, con el saldo de tu cuenta
            Binance, el mismo de tu tarjeta Binance Visa. Pagas mes a mes y no se renueva solo.
          </p>
        </div>
      </section>

      <section aria-labelledby="empezar" className="border-y border-line bg-surface">
        <div className="mx-auto max-w-5xl px-4 py-14 sm:px-6">
          <h2 id="empezar" className="max-w-xl text-3xl font-semibold tracking-tight text-balance text-ink">
            Empieza en tres pasos
          </h2>
          <ol className="mt-8 grid gap-8 md:grid-cols-3">
            {START.map((step, index) => (
              <li key={step.title} className="border-t-2 border-primary pt-4">
                <p className="text-sm font-semibold tabular-nums text-primary">Paso {index + 1}</p>
                <h3 className="mt-1.5 text-lg font-semibold text-ink">{step.title}</h3>
                <p className="mt-1.5 leading-relaxed text-muted">{step.body}</p>
              </li>
            ))}
          </ol>
          <ButtonLink href="/descargar" size="lg" className="mt-10">
            <Download className="size-5" aria-hidden />
            Descargar gratis
          </ButtonLink>
        </div>
      </section>

      <section aria-labelledby="preguntas" className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <h2 id="preguntas" className="text-3xl font-semibold tracking-tight text-ink">
          Preguntas frecuentes
        </h2>
        <div className="mt-6 divide-y divide-line border-y border-line">
          {FAQ.map((item) => (
            <details key={item.q} className="group py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-semibold text-ink [&::-webkit-details-marker]:hidden">
                {item.q}
                <span aria-hidden className="text-xl leading-none text-primary transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="mt-2 leading-relaxed text-muted">{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
        <div className="rounded-3xl border border-line bg-surface px-6 py-10 text-center sm:px-10">
          <OmniMark size={44} className="mx-auto block" />
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-balance text-ink">Pruébala gratis hoy</h2>
          <p className="mx-auto mt-3 max-w-md leading-relaxed text-muted">
            Descárgala, crea tu cuenta y pregúntale a Omni a dónde se va tu dinero.
          </p>
          <ButtonLink href="/descargar" size="lg" className="mt-6">
            <Download className="size-5" aria-hidden />
            Descargar gratis
          </ButtonLink>
          <p className="mx-auto mt-5 max-w-md text-sm text-muted">
            ¿Tienes dudas? Respóndeme en el chat de WhatsApp donde te llegó este enlace.
          </p>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm text-muted sm:px-6">
          <span className="flex items-center gap-2 font-medium text-ink">
            <OmniMark size={22} />
            OmniAgent
          </span>
          <LegalLinks />
        </div>
      </footer>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-canvas px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:hidden">
        <ButtonLink href="/descargar" size="lg" className="w-full">
          <Download className="size-5" aria-hidden />
          Descargar gratis
        </ButtonLink>
      </div>
    </div>
  );
}
