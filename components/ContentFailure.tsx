"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { buttonStyles, Panel } from "@/components/Ui";

export function ContentFailure({ title }: { title: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Panel>
      <p role="alert" className="font-medium">{title}</p>
      <button type="button" className={`${buttonStyles.secondary} mt-3`} disabled={pending} aria-busy={pending}
        onClick={() => startTransition(() => router.refresh())}>
        {pending ? "Retrying…" : "Try again"}
      </button>
    </Panel>
  );
}
