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

// Ejemplo de Dots con los mismos textos de ayuda de la pantalla «Tus Dots».
const DOTS: { name: string; role: string; main?: boolean }[] = [
  { name: "Ahorrista", role: "Me cuida el bolsillo", main: true },
  { name: "Tramitador", role: "Me ayuda con el papeleo" },
  { name: "Cazaofertas", role: "Me avisa cuando algo baja" },
];

export function SalesPage() {
  const demo = demoData();
  const m = demo.message;

  const features: { key: string; title: string; body: string; composer: boolean; content: ReactNode }[] = [
    {
      key: "gastos",
      title: "Mira a dónde se va tu dinero",
      body: "Sube tu estado de cuenta en PDF o tómale una foto. Omni encuentra los gastos hormiga y las suscripciones que ya no usas, y te dice cuánto puedes ahorrar.",
      composer: true,
      content: (
        <ChatScreen
          messages={[
            m("g1", "user", "¿En qué se me va el dinero sin darme cuenta?"),
            m("g2", "assistant", "En compras pequeñas: **$132 al mes**. Y tienes 3 suscripciones que no usas.", [demo.ant]),
          ]}
        />
      ),
    },
    {
      key: "precios",
      title: "Te avisa cuando un precio baja de verdad",
      body: "Pega el enlace de un producto, un boleto, un vuelo o un hotel. Omni revisa el precio por ti y lo compara con el de los últimos 30 días.",
      composer: true,
      content: (
        <ChatScreen
          messages={[
            m("p1", "user", "Avísame si los audífonos Aura X2 bajan de $260"),
            m("p2", "assistant", "Listo. Reviso el precio en segundo plano y te aviso si baja 15% o llega a $260.", [demo.tracking]),
            m("p3", "assistant", "Hoy bajaron a **$247**, 24% menos de lo normal."),
          ]}
        />
      ),
    },
    {
      key: "tramites",
      title: "Tus trámites, sin olvidos",
      body: "Conecta tu correo: Omni encuentra lo pendiente, te ayuda a llenar formularios en PDF con tus datos y te recuerda las fechas.",
      composer: true,
      content: (
        <ChatScreen
          messages={[
            m("t1", "assistant", "Anoté el permiso de la excursión. ¿Agendo la salida en tu calendario?", [demo.task, demo.calendar]),
          ]}
        />
      ),
    },
    {
      key: "reclamos",
      title: "Si un pedido se atrasa, el reclamo ya está escrito",
      body: "Omni sigue tus pedidos. Si uno llega tarde o llega mal, te prepara el reclamo. Lo apruebas y lo envía desde tu correo, o te lo deja listo para pegarlo en la tienda.",
      composer: true,
      content: (
        <ChatScreen
          messages={[
            m("r1", "assistant", "Tu pedido #4821 de Tienda Nova iba a llegar el lunes y lleva 3 días de retraso."),
            m("r2", "assistant", "Te preparé el reclamo pidiendo el reembolso. Revísalo y, si está bien, apruébalo para enviarlo desde tu correo."),
          ]}
        />
      ),
    },
    {
      key: "metas",
      title: "Ahorra con un plan",
      body: "Dile cuánto quieres juntar y para cuándo. Omni te dice cuánto apartar cada mes y te muestra cómo vas.",
      composer: false,
      content: (
        <ListScreen title="Metas">
          <p className="mb-2 flex items-center gap-2 px-1 text-sm font-semibold text-ink">
            <Dot tone="attention" />
            Siguiendo
          </p>
          <Panel>
            {demo.trackingList.slice(0, 2).map((item) => (
              <TrackingRow key={item.itemId} item={item} />
            ))}
          </Panel>
          <p className="mb-2 mt-5 flex items-center gap-2 px-1 text-sm font-semibold text-ink">
            <Dot tone="primary" />
            Metas
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
      key: "pagina",
      title: "Una página web para tu negocio",
      body: "Cuéntale qué vendes, tus precios y cómo te contactan. Omni te arma una página con tu WhatsApp y tu horario, y se publica solo cuando la apruebas.",
      composer: true,
      content: (
        <ChatScreen
          messages={[
            m("w1", "user", "Hazme una página para mi barbería en La Candelaria. Corte $8, barba $5. Atiendo de lunes a sábado."),
            m("w2", "assistant", "Lista. Le puse tus precios, tu horario y un botón a tu WhatsApp. Revísala y, si te gusta, apruébala para publicarla."),
          ]}
        />
      ),
    },
    {
      key: "dots",
      title: "Arma tu equipo de asistentes",
      body: "Crea Dots: asistentes con su nombre, su forma de hablar y tus instrucciones. Uno para cuidar tu bolsillo, otro para tus trámites. Tú eliges cuál te responde.",
      composer: false,
      content: (
        <ListScreen title="Tus Dots">
          <p className="mb-3 px-1 text-xs leading-relaxed text-muted">El Dot por defecto es el que te responde en el chat.</p>
          <Panel>
            {DOTS.map((dot) => (
              <div key={dot.name} className="flex items-center gap-3 border-t border-line px-3 py-2.5 first:border-t-0">
                <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-primary-soft text-sm font-semibold text-primary">
                  {dot.name.charAt(0)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink">{dot.name}</span>
                  <span className="block truncate text-xs text-muted">{dot.role}</span>
                </span>
                {dot.main ? (
                  <span className="shrink-0 rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-medium text-primary">Por defecto</span>
                ) : null}
              </div>
            ))}
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
            Todo desde la misma conversación: revisa tus gastos, vigila precios, te recuerda tus trámites, prepara tus reclamos, te
            ayuda a ahorrar y te arma una página web. También puedes crear tus propios asistentes. Nada se paga, se envía ni se publica
            sin tu permiso.
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
