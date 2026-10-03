import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FormReview } from "@/components/procedures/form-review";
import { requireUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { storedExtraction } from "@/modules/procedures/documents/documents.service";
import { getProcedure, userTimeZone } from "@/modules/procedures/plan";

export const metadata: Metadata = { title: "Revisar formulario" };

type Params = Promise<{ id: string }>;

/** Revisión de un formulario: lo que Omni ya leyó se muestra al instante; la lectura con IA sigue en el cliente. */
export default async function FormPage({ params }: { params: Params }) {
  const user = await requireUser();
  const { id } = await params;
  let stored: Awaited<ReturnType<typeof storedExtraction>>;
  try {
    stored = await storedExtraction(user.userId, id);
  } catch (error) {
    if (error instanceof AppError && (error.status === 404 || error.status === 400)) notFound();
    throw error;
  }
  const [timeZone, procedure] = await Promise.all([
    userTimeZone(user.userId),
    stored.extraction?.taskId ? getProcedure(user.userId, stored.extraction.taskId).catch(() => null) : null,
  ]);

  return (
    <FormReview
      key={stored.templateId}
      documentId={stored.templateId}
      initial={stored.extraction}
      aiPending={stored.aiPending}
      aiAvailable={Boolean(env().ANTHROPIC_API_KEY)}
      timeZone={timeZone}
      procedure={procedure}
    />
  );
}
