"use client";

import { CircleAlert, CircleCheck, FileText, FileUp, Images, Loader, Lock, ScanText, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition, type DragEvent, type ReactNode } from "react";
import { Dialog } from "@/components/dialog";
import { INPUT_CLASS, buttonClass, type ButtonSize, type ButtonVariant } from "@/components/ui";
import { ApiError, apiFetch, apiUpload, errorMessage, sleep } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { money, plural, shortDate } from "@/lib/format";
import { compressPhoto } from "@/lib/image-compress";
import type {
  AccountView,
  StatementColumnRole,
  StatementImportResultView,
  StatementPreviewView,
  StatementScanPageView,
  StatementScanView,
} from "@/types/cards";

/**
 * "Subir estado de cuenta" para bancos que no se pueden conectar: PDF o CSV, o fotos y PDF escaneados que Omni lee
 * con IA página por página. Primero muestra lo que se va a importar (sin guardar nada); el usuario corrige columnas,
 * fechas o signos si hace falta y confirma.
 */

const MAX_BYTES = 4 * 1024 * 1024;
const MAX_PHOTOS = 10;
/** Entre todas las fotos ya reducidas (el tope de la subida es 4 MB; se deja margen para el formulario). */
const PHOTOS_BUDGET = 3_800_000;
/** Páginas que se leen a la vez (cada una es una petición de hasta un minuto). */
const SCAN_WORKERS = 2;
/** Una página que otra petición está leyendo se vuelve a preguntar cada tanto, hasta unos 3 minutos. */
const READING_POLL_MS = 4_000;
const MAX_POLLS_PER_PAGE = 45;
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

const isImageFile = (file: File) => file.type.startsWith("image/") || /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(file.name);
const isPdfFile = (file: File) => file.type === "application/pdf" || /\.pdf$/i.test(file.name);
const pageFinished = (page: StatementScanPageView) => page.status === "DONE" || (page.status === "FAILED" && !page.canRetry);

class ScanCancelled extends Error {}

/**
 * Lee las páginas que faltan, de a SCAN_WORKERS a la vez. Una página que falla con intentos por delante se reintenta
 * con espera; una que otra petición está leyendo se vuelve a preguntar.
 */
async function readScanPages(
  scan: StatementScanView,
  signal: AbortSignal,
  onChange: (scan: StatementScanView) => void,
): Promise<StatementScanView> {
  let pages = [...scan.pages];
  const publish = () => onChange({ ...scan, pages, ready: pages.every(pageFinished) });
  const queue = pages.filter((page) => !pageFinished(page)).map((page) => page.page);

  async function worker() {
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      const page = next;
      for (let round = 0; ; round++) {
        if (signal.aborted) throw new ScanCancelled();
        const view = await apiFetch<StatementScanPageView>(`/api/v1/finance/statements/scans/${scan.id}/pages/${page}`, {
          method: "POST",
          signal,
        });
        pages = pages.map((item) => (item.page === view.page ? view : item));
        publish();
        if (pageFinished(view) || round >= MAX_POLLS_PER_PAGE) break;
        await sleep(view.status === "READING" ? READING_POLL_MS : 2_500 * (round + 1));
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(SCAN_WORKERS, queue.length) }, () => worker()));
  return { ...scan, pages, ready: pages.every(pageFinished) };
}

const FORMAT_LABEL: Record<StatementPreviewView["format"], string> = { csv: "CSV", pdf: "PDF", scan: "Leído con IA" };

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
  /** Fotos del estado de cuenta: se leen con IA, página por página. */
  const [photos, setPhotos] = useState<File[]>([]);
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
  const [busy, setBusy] = useState<"preview" | "import" | "scan" | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Lectura con IA en curso (avance por página) y, cuando terminó, su id para la vista previa y la importación. */
  const [scan, setScan] = useState<StatementScanView | null>(null);
  const [scanId, setScanId] = useState<string | null>(null);
  /** El PDF tiene texto pero no se encontró la tabla: se ofrece leerlo con IA. */
  const [canScanPdf, setCanScanPdf] = useState(false);
  const scanAbort = useRef<AbortController | null>(null);
  /** La lectura que hay que descartar al cerrar o cambiar de archivo (si no se importó). */
  const scanRef = useRef<string | null>(null);

  useEffect(() => {
    const input = passwordRef.current;
    if (passwordAsks === 0 || !input) return;
    input.focus({ preventScroll: true });
    input.select();
    // Centrado: el pie fijo (aviso y botón) tapa la parte de abajo del diálogo.
    input.scrollIntoView({ block: "center" });
  }, [passwordAsks]);

  // Al cerrar el diálogo se corta la lectura que siga en curso.
  useEffect(() => () => scanAbort.current?.abort(), []);

  const isNew = accountId === NEW_ACCOUNT;
  const currencies = CURRENCIES.includes(defaultCurrency) ? CURRENCIES : [defaultCurrency, ...CURRENCIES];
  const hasSelection = file !== null || photos.length > 0;

  /** Descarta la lectura con IA anterior (en el servidor se borra lo transcrito). */
  function discardScan() {
    scanAbort.current?.abort();
    scanAbort.current = null;
    const previous = scanRef.current;
    scanRef.current = null;
    setScan(null);
    setScanId(null);
    if (previous && !demo) {
      void apiFetch(`/api/v1/finance/statements/scans/${previous}`, { method: "DELETE" }).catch(() => undefined);
    }
  }

  function close(imported: boolean) {
    // Importado: el servidor ya borró la lectura; si no, se descarta aquí.
    if (imported) {
      scanAbort.current?.abort();
      scanRef.current = null;
    } else {
      discardScan();
    }
    onClose(imported);
  }

  function resetSelection() {
    discardScan();
    setNeedsPassword(false);
    setPassword("");
    setHeaders(null);
    setSample(null);
    setMapping({});
    setDateOrder(null);
    setSignConvention(null);
    setPreview(null);
    setCanScanPdf(false);
  }

  function pickFiles(list: FileList | null | undefined) {
    setError(null);
    const picked = Array.from(list ?? []);
    if (picked.length === 0) return;
    const images = picked.filter(isImageFile);
    if (images.length > 0) {
      if (images.length !== picked.length) {
        setError("Sube fotos o un archivo PDF o CSV, no los dos a la vez.");
        return;
      }
      if (images.length > MAX_PHOTOS) {
        setError(`Sube hasta ${MAX_PHOTOS} fotos a la vez.`);
        return;
      }
      if (images.some((image) => image.size === 0)) {
        setError("Una de las fotos está vacía.");
        return;
      }
      resetSelection();
      setFile(null);
      setPhotos(images);
      return;
    }
    if (picked.length > 1) {
      setError("Sube un solo archivo PDF o CSV (o varias fotos).");
      return;
    }
    const next = picked[0];
    if (!/\.(csv|pdf|txt)$/i.test(next.name)) {
      setError("Elige un archivo PDF o CSV, o fotos de tu estado de cuenta. Si tienes un Excel, guárdalo como CSV.");
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
    resetSelection();
    setPhotos([]);
    setFile(next);
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    pickFiles(event.dataTransfer.files);
  }

  type Overrides = { mapping?: Mapping; dateOrder?: DateOrder | null; signConvention?: SignConvention | null; scanId?: string };

  function formData(overrides: Overrides = {}): FormData {
    const chosenScan = overrides.scanId ?? scanId;
    const chosenMapping = overrides.mapping ?? mapping;
    const chosenOrder = overrides.dateOrder !== undefined ? overrides.dateOrder : dateOrder;
    const chosenSign = overrides.signConvention !== undefined ? overrides.signConvention : signConvention;
    const options = {
      ...(isNew
        ? { newAccount: { institutionName: bank.trim(), type: accountType, currency } }
        : { accountId }),
      // Con una lectura con IA, lo transcrito reemplaza al archivo (las columnas son cosa del CSV).
      ...(chosenScan ? { scanId: chosenScan } : {}),
      ...(!chosenScan && Object.keys(chosenMapping).length > 0 ? { mapping: chosenMapping } : {}),
      ...(chosenOrder ? { dateOrder: chosenOrder } : {}),
      ...(chosenSign ? { signConvention: chosenSign } : {}),
      ...(!chosenScan && password ? { password } : {}),
    };
    const form = new FormData();
    if (!chosenScan && file) form.append("file", file);
    form.append("options", JSON.stringify(options));
    return form;
  }

  function accountReady(): boolean {
    if (isNew && !bank.trim()) {
      setError("Escribe el banco o la tarjeta de este estado de cuenta.");
      return false;
    }
    if (demo) {
      setError("En la vista previa no se suben archivos. Inicia sesión para importar tu estado de cuenta.");
      return false;
    }
    return true;
  }

  async function review(overrides: Overrides = {}) {
    const chosenScan = overrides.scanId ?? scanId;
    if (!chosenScan && !file) {
      // Las fotos se leen primero con IA.
      if (photos.length > 0) void startScan(photos);
      return;
    }
    if (!accountReady()) return;
    setBusy("preview");
    setError(null);
    let scanInstead = false;
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
      if (!chosenScan && (code === "scanned_pdf" || code === "scan_required")) {
        // PDF escaneado (sin texto): se lee con IA, página por página.
        scanInstead = true;
      } else if (code === "pdf_password_required" || code === "pdf_password_incorrect") {
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
      } else if (code === "no_transactions_found" && !chosenScan && file && isPdfFile(file)) {
        // Un PDF con texto cuya tabla no se reconoce: la IA puede leerlo como si fuera una foto.
        setCanScanPdf(true);
      } else if (code === "scan_not_found") {
        // La lectura venció: hay que volver a leer.
        scanRef.current = null;
        setScanId(null);
        setScan(null);
        setStep("upload");
      }
      if (!scanInstead) setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
    if (scanInstead && file) await startScan([file]);
  }

  /** Lectura con IA: sube las fotos o el PDF escaneado, lee cada página y muestra la vista previa con lo transcrito. */
  async function startScan(sources: File[]) {
    if (!accountReady()) return;
    discardScan();
    const controller = new AbortController();
    scanAbort.current = controller;
    setBusy("scan");
    setError(null);
    setCanScanPdf(false);
    try {
      const photosOnly = sources.every(isImageFile);
      const uploads = photosOnly
        ? await Promise.all(sources.map((source) => compressPhoto(source, Math.floor(PHOTOS_BUDGET / sources.length))))
        : sources;
      const form = new FormData();
      for (const upload of uploads) form.append("file", upload);
      const created = await apiUpload<StatementScanView>("/api/v1/finance/statements/scans", form, { signal: controller.signal });
      scanRef.current = created.id;
      setScan(created);
      const finished = await readScanPages(created, controller.signal, (next) => {
        if (!controller.signal.aborted) setScan(next);
      });
      if (!finished.pages.some((page) => page.status === "DONE")) {
        const reason = finished.pages.find((page) => page.error)?.error ?? "Toma fotos más nítidas y vuelve a intentarlo.";
        setError(`No pude leer ${finished.pageCount === 1 ? (photosOnly ? "la foto" : "el PDF") : "ninguna página"}. ${reason}`);
        return;
      }
      setScanId(finished.id);
      setBusy(null);
      await review({ scanId: finished.id });
    } catch (caught) {
      if (caught instanceof ScanCancelled || controller.signal.aborted) return;
      setError(errorMessage(caught));
    } finally {
      if (scanAbort.current === controller) scanAbort.current = null;
      setBusy((current) => (current === "scan" ? null : current));
    }
  }

  async function confirmImport() {
    setBusy("import");
    setError(null);
    try {
      const data = await apiUpload<StatementImportResultView>("/api/v1/finance/statements/import", formData());
      // El servidor borra la lectura con IA al importar.
      scanRef.current = null;
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
    (step === "columns" || step === "preview") && busy === null
      ? () => {
          setError(null);
          setStep("upload");
        }
      : undefined;

  const scanDone = scan ? scan.pages.filter(pageFinished).length : 0;
  const primaryLabel =
    busy === "scan"
      ? scan
        ? `Leyendo con IA… página ${Math.min(scanDone + 1, scan.pageCount)} de ${scan.pageCount}`
        : "Preparando la lectura…"
      : busy === "preview"
        ? "Leyendo el archivo…"
        : photos.length > 0 && !scanId
          ? photos.length === 1
            ? "Leer la foto con IA"
            : `Leer ${photos.length} fotos con IA`
          : "Revisar movimientos";

  return (
    <Dialog
      title={TITLES[step]}
      onClose={() => close(step === "done" && (result?.imported ?? 0) > 0)}
      onBack={back}
      // Una lectura con IA puede tardar: se puede cerrar y se corta.
      closable={busy === null || busy === "scan"}
    >
      {step === "upload" ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm leading-relaxed text-muted">
            ¿Tu banco no se puede conectar? Sube el estado de cuenta en PDF o CSV desde tu banca en línea, o tómale fotos:
            Omni las lee con IA.
          </p>

          {accounts.length > 0 ? (
            <Field label="Cuenta" htmlFor={ids.account}>
              <select
                id={ids.account}
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                disabled={busy !== null}
                className={INPUT_CLASS}
              >
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
                    disabled={busy !== null}
                    className={INPUT_CLASS}
                  />
                </Field>
              </div>
              <Field label="Tipo de cuenta" htmlFor={ids.type}>
                <select
                  id={ids.type}
                  value={accountType}
                  onChange={(e) => setAccountType(e.target.value as typeof accountType)}
                  disabled={busy !== null}
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
                <select
                  id={ids.currency}
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  disabled={busy !== null}
                  className={INPUT_CLASS}
                >
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
              busy !== null && "pointer-events-none opacity-60",
            )}
          >
            {photos.length > 0 ? (
              <Images className="size-7 text-primary" aria-hidden />
            ) : file ? (
              <FileText className="size-7 text-primary" aria-hidden />
            ) : (
              <FileUp className="size-7 text-muted" aria-hidden />
            )}
            <span className="text-sm font-semibold text-ink">
              {photos.length > 0
                ? plural(photos.length, "foto del estado de cuenta", "fotos del estado de cuenta")
                : file
                  ? file.name
                  : "Arrastra tu estado de cuenta o elige un archivo"}
            </span>
            <span className="text-xs text-muted">
              {hasSelection
                ? photos.length > 0
                  ? "Cambiar fotos"
                  : `${Math.max(1, Math.round((file?.size ?? 0) / 1024))} KB · cambiar archivo`
                : `PDF o CSV hasta 4 MB, o hasta ${MAX_PHOTOS} fotos`}
            </span>
            <input
              id={ids.file}
              type="file"
              multiple
              accept=".csv,.pdf,.txt,text/csv,application/pdf,image/*"
              disabled={busy !== null}
              onChange={(event) => {
                pickFiles(event.target.files);
                // Elegir el mismo archivo otra vez también avisa.
                event.target.value = "";
              }}
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

          {busy === "scan" && scan ? <ScanProgress scan={scan} /> : null}

          <p className="flex items-start justify-center gap-1.5 text-center text-xs leading-relaxed text-muted">
            <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              Guardamos solo los movimientos. Las fotos y los PDF escaneados se guardan cifrados mientras Omni los lee y se
              borran al terminar.
            </span>
          </p>

          <StickyActions>
            {error ? <ErrorNote>{error}</ErrorNote> : null}
            {canScanPdf && file ? (
              <button
                type="button"
                onClick={() => void startScan([file])}
                disabled={busy !== null}
                className={buttonClass("secondary", "md")}
              >
                <ScanText className="size-4" aria-hidden />
                Leer el PDF con IA
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void review()}
              disabled={!hasSelection || busy !== null || (needsPassword && !password)}
              className={buttonClass("primary", "md")}
            >
              {busy === "preview" || busy === "scan" ? <Loader className="size-4 animate-spin" aria-hidden /> : null}
              {primaryLabel}
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

      {step === "done" && result ? <DoneStep result={result} onClose={() => close(result.imported > 0)} /> : null}
    </Dialog>
  );
}

/** Avance de la lectura con IA: una barra y el estado de cada página. */
function ScanProgress({ scan }: { scan: StatementScanView }) {
  const done = scan.pages.filter(pageFinished).length;
  const failed = scan.pages.filter((page) => page.status === "FAILED").length;
  const percent = scan.pageCount > 0 ? Math.round((done / scan.pageCount) * 100) : 0;
  return (
    <div className="rounded-2xl border border-line px-3.5 py-3" aria-live="polite">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium text-ink">Leyendo con IA</span>
        <span className="tabular-nums text-muted">
          {done} de {scan.pageCount}
        </span>
      </div>
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={scan.pageCount}
        aria-valuenow={done}
        aria-label="Páginas leídas"
      >
        <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted">
        {failed > 0
          ? `${plural(failed, "página no se pudo leer", "páginas no se pudieron leer")}; sigo con las demás.`
          : "Cada página tarda unos segundos. Si cierras esto, la lectura se cancela."}
      </p>
    </div>
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
  busy: "preview" | "import" | "scan" | null;
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
        <span className="shrink-0">{FORMAT_LABEL[preview.format]}</span>
        {detected.pages ? <span className="shrink-0">· {plural(detected.pages, "página", "páginas")}</span> : null}
      </div>

      {preview.scan ? <ScanNote scan={preview.scan} /> : null}

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

const CHECK_LABEL: Record<NonNullable<StatementPreviewView["scan"]>["checks"][number], string> = {
  closing: "el saldo final",
  running: "el saldo de cada movimiento",
  totals: "los totales del resumen",
};

const ACCOUNT_TYPE_SEEN: Record<NonNullable<NonNullable<StatementPreviewView["scan"]>["accountType"]>, string> = {
  checking: "cuenta de débito",
  savings: "cuenta de ahorro",
  credit_card: "tarjeta de crédito",
  other: "otra cuenta",
};

/** Lo que dice la lectura con IA: si los montos cuadran con el propio documento y qué cuenta vio. */
function ScanNote({ scan }: { scan: NonNullable<StatementPreviewView["scan"]> }) {
  const seen = [
    scan.institution,
    scan.accountType ? ACCOUNT_TYPE_SEEN[scan.accountType] : null,
    scan.last4 ? `••${scan.last4}` : null,
    scan.currency,
  ].filter(Boolean);
  const checks = scan.checks.map((check) => CHECK_LABEL[check]);
  const checked = checks.length > 1 ? `${checks.slice(0, -1).join(", ")} y ${checks[checks.length - 1]}` : checks[0];
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm",
        scan.verified === true ? "bg-primary-soft text-ink" : "bg-surface-2 text-muted",
      )}
    >
      {scan.verified === true ? (
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
      ) : (
        <ScanText className="mt-0.5 size-4 shrink-0" aria-hidden />
      )}
      <span>
        {scan.verified === true
          ? `Leído con IA y comprobado: cuadra con ${checked} del documento.`
          : scan.verified === false
            ? "Leído con IA, pero algunos montos no cuadran con el documento: revisa los avisos antes de importar."
            : "Leído con IA. El documento no trae saldos ni totales para comprobar los montos: revísalos antes de importar."}
        {seen.length > 0 ? <span className="mt-0.5 block text-xs text-muted">Se ve en el documento: {seen.join(" · ")}</span> : null}
      </span>
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
