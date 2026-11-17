"use client";

import { ErroTela } from "@/components/ErroTela";

export default function Erro({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErroTela erro={error} tentarDeNovo={reset} />;
}
