import Link from "next/link";
import type { ReactNode } from "react";
import { ApprovalSlip } from "@/components/approval-slip";
import { MessageBubble } from "@/components/chat/message-bubble";
import { LegalLinks } from "@/components/legal-page";
import { OmniMark } from "@/components/omni-mark";
import { PhoneFrame } from "@/components/phone-frame";
import { PlanCard } from "@/components/plan-card";
import { DEMO_TIME_ZONE, demoData } from "@/components/preview/demo-data";
import { ButtonLink, Dot, Panel, buttonClass } from "@/components/ui";
import { GoalRow, TrackingRow } from "@/components/views/goals-view";
import { IdeaRow } from "@/components/views/ideas-view";
import { PLANS } from "@/modules/billing/plans";
import type { ChatMessageView } from "@/types/cards";

const STEPS = [
  {
    title: "Revisa",
    body: "Lee tus movimientos, tus trámites y los precios que le pidas vigilar. Solo lo que tú conectes.",
  },
  {
    title: "Propone",
    body: "Prepara la compra, la cancelación o el correo con el monto y los detalles exactos.",
  },
  {
    title: "Tú decides",
    body: "Apruebas o rechazas con un toque. Solo entonces se ejecuta, y queda registrado.",
  },
];

function ChatScreen({ messages }: { messages: ChatMessageView[] }) {
  return (
    <div className="flex h-full flex-col justify-end gap-3 px-4 py-4">
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} timeZone={DEMO_TIME_ZONE} demo />
      ))}
    </div>
  );
}

function ListScreen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="h-full px-4 pt-5">
      <h3 className="mb-3 px-1 text-xl font-semibold tracking-tight text-ink">{title}</h3>
      {children}
    </div>
  );
}

export function Landing() {
  const demo = demoData();
  const m = demo.message;

  const screens: { key: string; headline: string; composer: boolean; content: ReactNode }[] = [
    {
      key: "finanzas",
      headline: "Entiende a dónde se va tu dinero",
      composer: true,
      content: (
        <ChatScreen
          messages={[
            m("f1", "user", "¿A dónde se va mi dinero?"),
            m("f2", "assistant", "Gastas $4,212 al mes. Lo que más creció: **Restaurantes (+38%)**.", [
              demo.financeSummary,
            ]),
          ]}
        />
      ),
    },
    {
      key: "bajas",
      headline: "Da de baja lo que no usas con un toque",
      composer: true,
      content: (
        <ChatScreen
          messages={[
            m("b1", "user", "¿Qué suscripciones estoy pagando y no uso?"),
            m(
              "b2",
              "assistant",
              "Tienes 3 sin uso que suman $23.98 al mes. Empecemos por la que llevas más tiempo sin abrir:",
              [demo.cancelNews],
            ),
          ]}
        />
      ),
    },
    {
      key: "ideas",
      headline: "Ideas de lo que Omni puede resolver por ti",
      composer: false,
      content: (
        <ListScreen title="Ideas">
          <Panel>
            {demo.ideas.slice(0, 3).map((idea) => (
              <IdeaRow key={idea.id} idea={idea} dismissible={false} />
            ))}
          </Panel>
        </ListScreen>
      ),
    },
    {
      key: "precios",
      headline: "Vigila precios y compra en el mejor momento",
      composer: true,
      content: (
        <ChatScreen
          messages={[
            m("p1", "user", "Avísame si los audífonos Aura X2 bajan de $260"),
            m("p2", "assistant", "Listo. Reviso el precio en segundo plano y te aviso si baja 15% o llega a $260.", [
              demo.tracking,
            ]),
            m("p3", "assistant", "Hoy bajaron a **$247**, 24% menos de lo normal. Toca Comprar y decide con Permitir o Denegar."),
          ]}
        />
      ),
    },
    {
      key: "tramites",
      headline: "Trámites sin papeleo ni olvidos",
      composer: true,
      content: (
        <ChatScreen
          messages={[
            m("t1", "assistant", "Anoté el permiso de la excursión. ¿Agendo la salida en tu calendario?", [
              demo.task,
              demo.calendar,
            ]),
          ]}
        />
      ),
    },
    {
      key: "metas",
      headline: "Convierte tus metas en un plan",
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
  ];

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <OmniMark size={32} />
          <span className="text-lg font-semibold tracking-tight text-ink">OmniAgent</span>
        </Link>
        <ButtonLink href="/login" variant="secondary" size="sm">
          Entrar
        </ButtonLink>
      </header>

      <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-8 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:pt-14">
        <div>
          <h1 className="text-[2.6rem] font-semibold leading-[1.04] tracking-tight text-balance text-ink sm:text-6xl">
            Omni se encarga. Tú solo apruebas.
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-pretty text-muted">
            Un agente personal que revisa tus gastos, adelanta tus trámites y vigila precios. Nada se paga, se envía
            ni se cancela sin tu visto bueno.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="/login" size="lg">
              Empezar gratis
            </ButtonLink>
            <a href="#como-funciona" className={buttonClass("secondary", "lg")}>
              Cómo funciona
            </a>
          </div>
          <p className="mt-4 text-sm text-muted">En la web y en Android. Sin tarjeta para empezar.</p>
        </div>
        <div className="mx-auto w-full max-w-md">
          <MessageBubble
            message={m("h1", "assistant", "Los audífonos que sigues bajaron a $247 en SonidoMax. Te dejé la compra lista:")}
          />
          <div className="mt-3">
            <ApprovalSlip card={demo.purchase} demo />
          </div>
          <p className="mt-3 text-center text-xs text-muted">Pruébalo: es una demostración y no se cobra nada.</p>
        </div>
      </section>

      <section aria-labelledby="pantallas" className="pb-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 id="pantallas" className="max-w-2xl text-3xl font-semibold tracking-tight text-balance text-ink">
            Finanzas, trámites y compras en una sola conversación.
          </h2>
          <p className="mt-3 max-w-xl leading-relaxed text-muted">
            La misma regla para todo: Omni te muestra el detalle y espera tu decisión.
          </p>
        </div>
        <div className="no-scrollbar mt-10 flex snap-x snap-mandatory gap-6 overflow-x-auto px-4 pb-6 sm:px-6 lg:mx-auto lg:grid lg:max-w-6xl lg:grid-cols-3 lg:gap-x-8 lg:gap-y-16 lg:overflow-visible">
          {screens.map((screen) => (
            <figure key={screen.key} className="flex w-[20rem] shrink-0 snap-center flex-col items-center lg:w-auto">
              <figcaption className="mb-5 flex min-h-[3.5rem] max-w-[18rem] items-end justify-center text-center text-xl font-semibold leading-snug tracking-tight text-balance text-ink">
                {screen.headline}
              </figcaption>
              <PhoneFrame label={screen.headline} status={demo.status} pending={2} composer={screen.composer}>
                {screen.content}
              </PhoneFrame>
            </figure>
          ))}
        </div>
      </section>

      <section id="como-funciona" className="border-y border-line bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="max-w-xl text-3xl font-semibold tracking-tight text-balance text-ink">
            Un agente que trabaja por ti, con tu permiso.
          </h2>
          <ol className="mt-10 grid gap-10 md:grid-cols-3 md:gap-8">
            {STEPS.map((step, index) => (
              <li key={step.title} className="border-t-2 border-primary pt-5">
                <p className="text-sm font-semibold tabular-nums text-primary">Paso {index + 1}</p>
                <h3 className="mt-2 text-xl font-semibold text-ink">{step.title}</h3>
                <p className="mt-2 leading-relaxed text-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="max-w-2xl text-3xl font-semibold tracking-tight text-balance text-ink">
          Empieza gratis. Pásate a Pro cuando Omni te ahorre más de lo que cuesta.
        </h2>
        <div className="mt-8 grid max-w-3xl gap-4 sm:grid-cols-2">
          <PlanCard
            plan={PLANS.FREE}
            cta={
              <ButtonLink href="/login" variant="secondary" className="w-full">
                Empezar gratis
              </ButtonLink>
            }
          />
          <PlanCard
            plan={PLANS.PRO}
            cta={
              <ButtonLink href="/login" className="w-full">
                Probar Pro
              </ButtonLink>
            }
          />
        </div>
        <p className="mt-4 text-sm text-muted">En Android, Pro se paga con Google Play. Cancela cuando quieras.</p>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm text-muted sm:px-6">
          <span className="flex items-center gap-2 font-medium text-ink">
            <OmniMark size={22} />
            OmniAgent
          </span>
          <LegalLinks />
          <span>Omni propone. Tú apruebas.</span>
        </div>
      </footer>
    </div>
  );
}
