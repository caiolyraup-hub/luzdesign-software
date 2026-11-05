import { classeStatus, rotuloStatus } from "@/lib/orcamento/status";

export function BadgeStatus({ status }: { status: string }) {
  return (
    <span
      className={`inline-block rounded-full px-3 py-1 text-base font-medium ${classeStatus(status)}`}
    >
      {rotuloStatus(status)}
    </span>
  );
}
