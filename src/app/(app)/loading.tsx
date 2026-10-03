import { OmniMark } from "@/components/omni-mark";

export default function Loading() {
  return (
    <div className="grid h-full place-items-center">
      <div className="flex items-center gap-2.5 text-sm text-muted" role="status">
        <OmniMark size={28} thinking />
        <span>Cargando…</span>
      </div>
    </div>
  );
}
