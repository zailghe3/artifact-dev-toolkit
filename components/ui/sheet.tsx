"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";

// Adapted from the shadcn/ui Sheet. The navigation drawer always opens from the left.
export const Sheet = Dialog.Root;
export const SheetTrigger = Dialog.Trigger;

export function SheetContent({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="adt-sheet-overlay fixed inset-0 z-50 bg-black/50" />
      <Dialog.Content aria-describedby={undefined} className="adt-sheet-content fixed inset-y-0 left-0 z-50 flex w-72 max-w-[calc(100vw-2.75rem)] flex-col border-r border-border bg-sidebar text-sidebar-foreground shadow-xl">
        <Dialog.Title className="sr-only">{title}</Dialog.Title>
        <Dialog.Close className="adt-nav-action absolute right-2 top-[max(.5rem,env(safe-area-inset-top))] size-11 justify-center" aria-label="Close navigation">
          <X aria-hidden="true" />
        </Dialog.Close>
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  );
}
