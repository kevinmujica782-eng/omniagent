"use client";

import { CircleAlert, CircleCheck, FileText, FileUp, Loader, Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition, type DragEvent, type ReactNode } from "react";
import { Dialog } from "@/components/dialog";
import { INPUT_CLASS, buttonClass, type ButtonSize, type ButtonVariant } from "@/components/ui";
import { ApiError, apiFetch, apiUpload, errorMessage } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { money, plural, shortDate } from "@/lib/format";
import type {
  AccountView,
  StatementColumnRole,
  StatementImportResultView,
  StatementPreviewView,
} from "@/types/cards";

/**
 * "Subir estado de cuenta" (PDF o CSV) para bancos que no se pueden conectar. Primero muestra lo que se va a
 * importar (sin guardar nada); el usuario corrige columnas, fechas o signos si hace falta y confirma.
 */

const MAX_BYTES = 4 * 1024 * 1024;
const NEW_ACCOUNT = "new";
const CURRENCIES = ["MXN", "USD", "COP", "CLP", "ARS", "PEN", "EUR"];
const ACCOUNT_TYPES = [
  { value: "CHECKING", label: "Cuenta de débito" },
  { value: "CREDIT_CARD", label: "Tarjeta de crédito" },
  { value: "SAVINGS", label: "Cuenta de ahorro" },
  { value: "WALLET", label: "Monedero o billetera" },
] as const;

type Step = "upload" | "columns" | "preview" | "done";
type Mapping = Partial<Record<StatementColumnRole, number>>;
type DateOrder = StatementPreviewView["detected"]["dateOrder"];
type SignConvention = NonNullable<StatementPreviewView["detected"]["signConvention"]>;

const TITLES: Record<Step, string> = {
  upload: "Subir estado de cuenta",
  columns: "Elige las columnas",
  preview: "Revisa antes de importar",
  done: "Estado de cuenta importado",
};

function accountLabel(account: AccountView): string {
  return `${account.institutionName} · ${account.name}${account.mask ? ` ••${account.mask}` : ""}`;
}

/** Las fechas de la vista previa son días (YYYY-MM-DD): se muestran en UTC para no cambiar de día. */
const day = (iso: string | null) => (iso ? shortDate(`${iso}T00:00:00Z`, "UTC") : "");

/** Las columnas que se detectaron solas, para empezar desde ahí al corregirlas. */
function detectedMapping(preview: StatementPreviewView | null): Mapping {
  const columns = preview?.detected.columns;
  const headers = preview?.detected.headers;
  if (!columns || !headers) return {};
  const mapping: Mapping = {};
  for (const [role, label] of Object.entries(columns) as [StatementColumnRole, string][]) {
    const index = headers.indexOf(label);
    if (index >= 0) mapping[role] = index;
  }
  return mapping;
}

export function ImportStatementButton({
  label = "Subir estado de cuenta",
  variant = "secondary",
  size = "md",
  icon = true,
  className,
  accounts = [],
  defaultCurrency = "USD",
  presetAccountId,
  demo = false,
}: {
  label?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: boolean;
  className?: string;
  /** Cuentas manuales donde se puede importar. */
  accounts?: AccountView[];
  defaultCurrency?: string;
  /** Abre el diálogo con esta cuenta elegida ("Subir otro" desde la cuenta). */
  presetAccountId?: string;
  demo?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();

  function onClose(imported: boolean) {
    setOpen(false);
    if (imported) startTransition(() => router.refresh());
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" className={cn(buttonClass(variant, size), className)}>
        {icon ? <FileUp className="size-4" aria-hidden /> : null}
        {label}
      </button>
      {open ? (
        <ImportStatementDialog
          onClose={onClose}
          accounts={accounts}
          defaultCurrency={defaultCurrency}
          presetAccountId={presetAccountId}
          demo={demo}
        />
      ) : null}
    </>
  );
}

/**
 * La acción principal siempre a la vista: queda fija al pie del diálogo mientras la lista se desplaza.
 * Los márgenes y el `bottom` negativos compensan el relleno del contenido del Dialog (px-5 pb-6): sin eso, el pie
 * se queda a 1.5rem del borde y la lista asoma por debajo.
 */
function StickyActions({ children }: { children: ReactNode }) {
  return (
    <div className="sticky -bottom-6 -mx-5 -mb-6 flex flex-col gap-3 border-t border-line bg-surface px-5 pb-6 pt-3">{children}</div>
  );
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

/** Dos opciones excluyentes: radios nativos con el aspecto del selector de tema (Cuenta → Apariencia). */
function Toggle<T extends string>({
  legend,
  value,
  options,
  onChange,
  disabled,
}: {
  legend: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const name = useId();
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="mb-1.5 text-sm font-medium text-ink">{legend}</legend>
      <div className="grid grid-cols-2 gap-1 rounded-2xl border border-line bg-surface-2 p-1">
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              "flex cursor-pointer items-center justify-center rounded-xl px-2 py-2 text-center text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary",
              value === option.value ? "bg-surface font-semibold text-ink shadow-card" : "text-muted hover:text-ink",
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function ImportStatementDialog({
  onClose,
  accounts,
  defaultCurrency,
  presetAccountId,
  demo,
}: {
  onClose: (imported: boolean) => void;
  accounts: AccountView[];
  defaultCurrency: string;
  presetAccountId?: string;
  demo: boolean;
}) {
  const router = useRouter();
  const ids = { account: useId(), bank: useId(), type: useId(), currency: useId(), file: useId(), password: useId() };
  const [step, setStep] = useState<Step>("upload");
  const [accountId, setAccountId] = useState(presetAccountId ?? accounts[0]?.id ?? NEW_ACCOUNT);
  const [bank, setBank] = useState("");
  const [accountType, setAccountType] = useState<(typeof ACCOUNT_TYPES)[number]["value"]>("CHECKING");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState("");
  /** Sube cada vez que el servidor pide la contraseña (o la rechaza): lleva el foco al campo. */
  const [passwordAsks, setPasswordAsks] = useState(0);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [headers, setHeaders] = useState<string[] | null>(null);
  const [sample, setSample] = useState<string[][] | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [dateOrder, setDateOrder] = useState<DateOrder | null>(null);
  const [signConvention, setSignConvention] = useState<SignConvention | null>(null);
  const [preview, setPreview] = useState<StatementPreviewView | null>(null);
  const [result, setResult] = useState<StatementImportResultView | null>(null);
  const [busy, setBusy] = useState<"preview" | "import" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const input = passwordRef.current;
    if (passwordAsks === 0 || !input) return;
    input.focus({ preventScroll: true });
    input.select();
    // Centrado: el pie fijo (aviso y botón) tapa la parte de abajo del diálogo.
    input.scrollIntoView({ block: "center" });
  }, [passwordAsks]);

  const isNew = accountId === NEW_ACCOUNT;
  const currencies = CURRENCIES.includes(defaultCurrency) ? CURRENCIES : [defaultCurrency, ...CURRENCIES];

  function pickFile(next: File | undefined) {
    setError(null);
    if (!next) return;
    if (!/\.(csv|pdf|txt)$/i.test(next.name)) {
      setError("Elige un archivo PDF o CSV. Si tienes un Excel, guárdalo como CSV.");
      return;
    }
    if (next.size > MAX_BYTES) {
      setError("El archivo supera los 4 MB. Descarga un periodo más corto.");
      return;
    }
    if (next.size === 0) {
      setError("El archivo está vacío.");
      return;
    }
    // Archivo nuevo: lo que se ajustó para el anterior ya no aplica.
    setFile(next);
    setNeedsPassword(false);
    setPassword("");
    setHeaders(null);
    setSample(null);
    setMapping({});
    setDateOrder(null);
    setSignConvention(null);
    setPreview(null);
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    pickFile(event.dataTransfer.files[0]);
  }

  function formData(overrides: { mapping?: Mapping; dateOrder?: DateOrder | null; signConvention?: SignConvention | null } = {}): FormData {
    const chosenMapping = overrides.mapping ?? mapping;
    const chosenOrder = overrides.dateOrder !== undefined ? overrides.dateOrder : dateOrder;
    const chosenSign = overrides.signConvention !== undefined ? overrides.signConvention : signConvention;
    const options = {
      ...(isNew
        ? { newAccount: { institutionName: bank.trim(), type: accountType, currency } }
        : { accountId }),
      ...(Object.keys(chosenMapping).length > 0 ? { mapping: chosenMapping } : {}),
      ...(chosenOrder ? { dateOrder: chosenOrder } : {}),
      ...(chosenSign ? { signConvention: chosenSign } : {}),
      ...(password ? { password } : {}),
    };
    const form = new FormData();
    form.append("file", file!);
    form.append("options", JSON.stringify(options));
    return form;
  }

  async function review(overrides: Parameters<typeof formData>[0] = {}) {
    if (!file) return;
    if (isNew && !bank.trim()) {
      setError("Escribe el banco o la tarjeta de este estado de cuenta.");
      return;
    }
    if (demo) {
      setError("En la vista previa no se suben archivos. Inicia sesión para importar tu estado de cuenta.");
      return;
    }
    setBusy("preview");
    setError(null);
    try {
      const data = await apiUpload<StatementPreviewView>("/api/v1/finance/statements/preview", formData(overrides));
      // Las opciones nuevas se guardan solo si la vista previa con ellas llegó: si falló, la pantalla sigue mostrando
      // la anterior y "Importar" no debe mandar algo distinto de lo que se ve.
      if (overrides.mapping !== undefined) setMapping(overrides.mapping);
      if (overrides.dateOrder !== undefined) setDateOrder(overrides.dateOrder);
      if (overrides.signConvention !== undefined) setSignConvention(overrides.signConvention);
      setPreview(data);
      setStep("preview");
    } catch (caught) {
      const code = caught instanceof ApiError ? caught.code : null;
      const details = caught instanceof ApiError ? (caught.details as { headers?: string[]; sample?: string[][] } | null) : null;
      if (code === "pdf_password_required" || code === "pdf_password_incorrect") {
        setNeedsPassword(true);
        setPasswordAsks((count) => count + 1);
        setStep("upload");
      } else if (
        (code === "columns_not_found" || code === "invalid_mapping" || code === "no_transactions_found") &&
        details?.headers?.length
      ) {
        // CSV sin movimientos válidos: casi siempre es una columna equivocada, así que se ofrece elegirlas.
        setHeaders(details.headers);
        setSample(details.sample ?? null);
        setStep("columns");
        // El paso de columnas ya pide elegirlas: el aviso solo hace falta si lo elegido no sirvió.
        if (code === "columns_not_found") return;
      }
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function confirmImport() {
    setBusy("import");
    setError(null);
    try {
      const data = await apiUpload<StatementImportResultView>("/api/v1/finance/statements/import", formData());
      setResult(data);
      setStep("done");
      if (data.imported > 0) {
        // Movimientos nuevos: Omni rehace el análisis en segundo plano y la página se actualiza al terminar.
        void apiFetch("/api/v1/finance/analysis?origen=conexion", { method: "POST" })
          .catch(() => undefined)
          .finally(() => router.refresh());
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  function changeOption(next: { dateOrder?: DateOrder; signConvention?: SignConvention }) {
    void review(next);
  }

  const back =
    step === "columns" || step === "preview"
      ? () => {
          setError(null);
          setStep("upload");
        }
      : undefined;

  return (
    <Dialog title={TITLES[step]} onClose={() => onClose(step === "done" && (result?.imported ?? 0) > 0)} onBack={back} closable={busy === null}>
      {step === "upload" ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm leading-relaxed text-muted">
            ¿Tu banco no se puede conectar? Descarga el estado de cuenta desde tu banca en línea y súbelo aquí.
          </p>

          {accounts.length > 0 ? (
            <Field label="Cuenta" htmlFor={ids.account}>
              <select id={ids.account} value={accountId} onChange={(e) => setAccountId(e.target.value)} className={INPUT_CLASS}>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {accountLabel(account)}
                  </option>
                ))}
                <option value={NEW_ACCOUNT}>Otra cuenta…</option>
              </select>
            </Field>
          ) : null}

          {isNew ? (
            <div className="grid grid-cols-[minmax(0,1fr)_6.5rem] gap-3">
              <div className="col-span-2">
                <Field label="Banco o tarjeta" htmlFor={ids.bank}>
                  <input
                    id={ids.bank}
                    value={bank}
                    onChange={(e) => setBank(e.target.value)}
                    placeholder="Ej. BBVA, Banorte, Nu"
                    maxLength={60}
                    autoComplete="off"
                    className={INPUT_CLASS}
                  />
                </Field>
              </div>
              <Field label="Tipo de cuenta" htmlFor={ids.type}>
                <select
                  id={ids.type}
                  value={accountType}
                  onChange={(e) => setAccountType(e.target.value as typeof accountType)}
                  className={INPUT_CLASS}
                >
                  {ACCOUNT_TYPES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Moneda" htmlFor={ids.currency}>
                <select id={ids.currency} value={currency} onChange={(e) => setCurrency(e.target.value)} className={INPUT_CLASS}>
                  {currencies.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          ) : null}

          <label
            htmlFor={ids.file}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn(
              "flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-4 py-7 text-center transition-colors focus-within:border-primary",
              dragging ? "border-primary bg-primary-soft" : "border-line-strong bg-surface-2 hover:border-primary",
            )}
          >
            {file ? <FileText className="size-7 text-primary" aria-hidden /> : <FileUp className="size-7 text-muted" aria-hidden />}
            <span className="text-sm font-semibold text-ink">{file ? file.name : "Arrastra tu estado de cuenta o elige un archivo"}</span>
            <span className="text-xs text-muted">{file ? `${Math.max(1, Math.round(file.size / 1024))} KB · cambiar archivo` : "PDF o CSV, hasta 4 MB"}</span>
            <input
              id={ids.file}
              type="file"
              accept=".csv,.pdf,.txt,text/csv,application/pdf"
              onChange={(event) => pickFile(event.target.files?.[0])}
              className="sr-only"
            />
          </label>

          {needsPassword ? (
            <Field label="Contraseña del PDF" htmlFor={ids.password} hint="Solo se usa para abrir el archivo; no se guarda.">
              <input
                ref={passwordRef}
                id={ids.password}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="off"
                className={INPUT_CLASS}
              />
            </Field>
          ) : null}

          <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted">
            <Lock className="size-3.5 shrink-0" aria-hidden />
            Leemos el archivo y guardamos solo los movimientos; el archivo no se guarda.
          </p>

          <StickyActions>
            {error ? <ErrorNote>{error}</ErrorNote> : null}
            <button
              type="button"
              onClick={() => review()}
              disabled={!file || busy !== null || (needsPassword && !password)}
              className={buttonClass("primary", "md")}
            >
              {busy === "preview" ? <Loader className="size-4 animate-spin" aria-hidden /> : null}
              {busy === "preview" ? "Leyendo el archivo…" : "Revisar movimientos"}
            </button>
          </StickyActions>
        </div>
      ) : null}

      {step === "columns" && headers ? (
        <ColumnsStep
          headers={headers}
          sample={sample}
          initial={Object.keys(mapping).length > 0 ? mapping : detectedMapping(preview)}
          busy={busy !== null}
          error={error}
          onSubmit={(next) => void review({ mapping: next })}
        />
      ) : null}

      {step === "preview" && preview ? (
        <PreviewStep
          preview={preview}
          busy={busy}
          error={error}
          onChange={changeOption}
          onEditColumns={
            preview.detected.headers
              ? () => {
                  setHeaders(preview.detected.headers);
                  setSample(preview.detected.sample);
                  setError(null);
                  setStep("columns");
                }
              : undefined
          }
          onImport={confirmImport}
        />
      ) : null}

      {step === "done" && result ? <DoneStep result={result} onClose={() => onClose(result.imported > 0)} /> : null}
    </Dialog>
  );
}

function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="flex items-start gap-2 rounded-xl bg-danger-soft px-3 py-2.5 text-sm text-danger">
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

const ROLE_FIELDS: { role: StatementColumnRole; label: string; optional?: boolean }[] = [
  { role: "date", label: "Fecha" },
  { role: "description", label: "Descripción" },
  { role: "amount", label: "Monto (con signo)", optional: true },
  { role: "debit", label: "Cargos o retiros", optional: true },
  { role: "credit", label: "Abonos o depósitos", optional: true },
];

/** "Operación · 05/01/2024": el título de la columna con un valor de ejemplo del archivo. */
function columnOption(header: string, index: number, sample: string[][] | null): string {
  const title = header.trim() || `Columna ${index + 1}`;
  const example = sample?.map((row) => row[index]?.trim()).find(Boolean);
  if (!example || example === title) return title;
  return `${title} · ${example.length > 28 ? `${example.slice(0, 27)}…` : example}`;
}

function ColumnsStep({
  headers,
  sample,
  initial,
  busy,
  error,
  onSubmit,
}: {
  headers: string[];
  sample: string[][] | null;
  initial: Mapping;
  busy: boolean;
  error: string | null;
  onSubmit: (mapping: Mapping) => void;
}) {
  const baseId = useId();
  const [mapping, setMapping] = useState<Mapping>(initial);
  const hasMoney = mapping.amount !== undefined || mapping.debit !== undefined || mapping.credit !== undefined;
  const ready = mapping.date !== undefined && mapping.description !== undefined && hasMoney;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm leading-relaxed text-muted">
        Dinos qué columna es cada dato. Usa <strong className="font-semibold text-ink">monto</strong> si los gastos vienen en
        negativo, o <strong className="font-semibold text-ink">cargos y abonos</strong> si vienen en columnas separadas.
      </p>
      {ROLE_FIELDS.map(({ role, label, optional }) => (
        <Field key={role} label={label} htmlFor={`${baseId}-${role}`}>
          <select
            id={`${baseId}-${role}`}
            value={mapping[role] ?? ""}
            onChange={(e) => {
              const value = e.target.value === "" ? undefined : Number(e.target.value);
              setMapping((prev) => {
                const next = { ...prev, [role]: value };
                if (value === undefined) delete next[role];
                // Monto único o cargos/abonos: elegir uno descarta el otro.
                if (role === "amount" && value !== undefined) {
                  delete next.debit;
                  delete next.credit;
                }
                if ((role === "debit" || role === "credit") && value !== undefined) delete next.amount;
                return next;
              });
            }}
            className={INPUT_CLASS}
          >
            <option value="">{optional ? "No aplica" : "Elige una columna"}</option>
            {headers.map((header, index) => (
              <option key={index} value={index}>
                {columnOption(header, index, sample)}
              </option>
            ))}
          </select>
        </Field>
      ))}
      <StickyActions>
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        <button type="button" disabled={!ready || busy} onClick={() => onSubmit(mapping)} className={buttonClass("primary", "md")}>
          {busy ? <Loader className="size-4 animate-spin" aria-hidden /> : null}
          Revisar de nuevo
        </button>
      </StickyActions>
    </div>
  );
}

function PreviewStep({
  preview,
  busy,
  error,
  onChange,
  onEditColumns,
  onImport,
}: {
  preview: StatementPreviewView;
  busy: "preview" | "import" | null;
  error: string | null;
  onChange: (next: { dateOrder?: DateOrder; signConvention?: SignConvention }) => void;
  onEditColumns?: () => void;
  onImport: () => void;
}) {
  const { detected } = preview;
  const fresh = preview.count - (preview.duplicates ?? 0);
  const period = preview.periodStart && preview.periodEnd ? `${day(preview.periodStart)} – ${day(preview.periodEnd)}` : "—";
  const stats = [
    { label: "Movimientos", value: String(preview.count) },
    { label: "Periodo", value: period },
    { label: "Gastos", value: money(preview.spending, preview.currency, { cents: true }) },
    { label: "Ingresos", value: money(preview.income, preview.currency, { cents: true }) },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 text-sm text-muted">
        <FileText className="size-4 shrink-0" aria-hidden />
        <span className="truncate">{preview.fileName}</span>
        <span aria-hidden>·</span>
        <span className="shrink-0 uppercase">{preview.format}</span>
        {detected.pages ? <span className="shrink-0">· {plural(detected.pages, "página", "páginas")}</span> : null}
      </div>

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line">
        {stats.map((stat) => (
          <div key={stat.label} className="bg-surface px-3.5 py-3">
            <dt className="text-xs text-muted">{stat.label}</dt>
            <dd className="mt-0.5 text-sm font-semibold tabular-nums text-ink">{stat.value}</dd>
          </div>
        ))}
      </dl>

      {preview.duplicates ? (
        <p className="rounded-xl bg-surface-2 px-3 py-2.5 text-sm text-muted">
          {preview.duplicates === preview.count
            ? "Todos estos movimientos ya estaban importados."
            : `${plural(preview.duplicates, "movimiento ya estaba importado", "movimientos ya estaban importados")}: no se duplican.`}
        </p>
      ) : null}

      {preview.warnings.length > 0 ? (
        <ul className="flex flex-col gap-1.5 rounded-xl bg-attention-soft px-3 py-2.5 text-sm text-attention">
          {preview.warnings.map((warning) => (
            <li key={warning} className="flex items-start gap-2">
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{warning}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {detected.dateOrderAmbiguous ? (
        <Toggle
          legend="Las fechas están en formato"
          value={detected.dateOrder === "MDY" ? "MDY" : "DMY"}
          options={[
            { value: "DMY", label: "Día/mes" },
            { value: "MDY", label: "Mes/día" },
          ]}
          onChange={(value) => onChange({ dateOrder: value })}
          disabled={busy !== null}
        />
      ) : null}
      {detected.signConvention ? (
        <Toggle
          legend="Los montos negativos son"
          value={detected.signConvention}
          options={[
            { value: "negative_is_debit", label: "Gastos" },
            { value: "positive_is_debit", label: "Ingresos o pagos" },
          ]}
          onChange={(value) => onChange({ signConvention: value })}
          disabled={busy !== null}
        />
      ) : null}

      <div>
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-ink">
            {preview.count > preview.sample.length ? `Primeros ${preview.sample.length} de ${preview.count}` : "Movimientos"}
          </p>
          {onEditColumns ? (
            <button type="button" onClick={onEditColumns} disabled={busy !== null} className="text-sm font-semibold text-primary hover:underline">
              Cambiar columnas
            </button>
          ) : null}
        </div>
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
          {preview.sample.map((row, index) => (
            <li key={`${row.date}-${index}`} className="flex items-center gap-3 px-3.5 py-2.5">
              <span className="w-14 shrink-0 text-xs tabular-nums text-muted">{day(row.date)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-ink">{row.merchantName}</span>
                <span className="block truncate text-xs text-muted">{row.category}</span>
              </span>
              <span className={cn("shrink-0 text-sm font-semibold tabular-nums", row.direction === "CREDIT" ? "text-primary" : "text-ink")}>
                {row.direction === "CREDIT" ? "+" : "−"}
                {money(row.amount, preview.currency, { cents: true })}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {preview.skippedCount > 0 ? (
        <details className="rounded-xl border border-line px-3.5 py-2.5 text-sm">
          <summary className="cursor-pointer font-medium text-ink">
            {plural(preview.skippedCount, "fila no se importará", "filas no se importarán")}
          </summary>
          <ul className="mt-2 flex flex-col gap-1.5 text-xs text-muted">
            {preview.skipped.map((row, index) => (
              <li key={`${row.source}-${index}`}>
                <span className="font-medium text-ink">{row.source}:</span> {row.reason}
                {row.text ? <span className="block truncate">{row.text}</span> : null}
              </li>
            ))}
            {preview.skippedCount > preview.skipped.length ? <li>…y {preview.skippedCount - preview.skipped.length} más.</li> : null}
          </ul>
        </details>
      ) : null}

      <StickyActions>
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        <button type="button" onClick={onImport} disabled={busy !== null || fresh === 0} className={buttonClass("primary", "md")}>
          {busy ? <Loader className="size-4 animate-spin" aria-hidden /> : null}
          {busy === "import"
            ? "Importando…"
            : busy === "preview"
              ? "Actualizando…"
              : fresh === 0
                ? "Nada nuevo que importar"
                : `Importar ${plural(fresh, "movimiento", "movimientos")}`}
        </button>
      </StickyActions>
    </div>
  );
}

function DoneStep({ result, onClose }: { result: StatementImportResultView; onClose: () => void }) {
  const details = [
    result.duplicates > 0 ? plural(result.duplicates, "ya estaba importado", "ya estaban importados") : null,
    result.skipped > 0 ? plural(result.skipped, "fila omitida", "filas omitidas") : null,
  ].filter(Boolean);
  return (
    <div className="flex flex-col items-center gap-3 py-2 text-center">
      <CircleCheck className="size-10 text-primary" aria-hidden />
      <p className="text-base font-semibold text-ink">
        {result.imported > 0 ? `Importamos ${plural(result.imported, "movimiento", "movimientos")}` : "Todo ya estaba importado"}
      </p>
      {details.length > 0 ? <p className="text-sm text-muted">{details.join(" · ")}</p> : null}
      {result.imported > 0 ? (
        <p className="max-w-xs text-sm leading-relaxed text-muted">
          Omni está actualizando tu análisis con estos movimientos: gastos hormiga, suscripciones y cuánto puedes ahorrar.
        </p>
      ) : null}
      <button type="button" onClick={onClose} className={cn(buttonClass("primary", "md"), "mt-2 w-full")}>
        Listo
      </button>
    </div>
  );
}
