import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function KMenu({
  trigger,
  label,
  children,
}: {
  trigger: ReactNode;
  label?: string | undefined;
  children: ReactNode;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          aria-label={label}
          className="glass-strong z-50 min-w-[13rem] rounded-2xl border border-glass-border p-1.5 shadow-xl outline-none"
        >
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function KMenuItem({
  onSelect,
  active,
  destructive,
  children,
  ...rest
}: {
  onSelect: () => void;
  active?: boolean | undefined;
  destructive?: boolean | undefined;
  children: ReactNode;
} & Record<string, unknown>) {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      className={cn(
        "flex cursor-pointer select-none items-center gap-2.5 rounded-xl px-3 py-2 text-sm outline-none transition-colors",
        destructive
          ? "text-debit focus:bg-debit/10"
          : active
            ? "bg-primary/10 text-foreground font-medium"
            : "text-muted-foreground focus:bg-accent focus:text-foreground"
      )}
      {...rest}
    >
      {children}
    </DropdownMenu.Item>
  );
}

export function KDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  maxWidth = "max-w-md",
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: ReactNode;
  description?: ReactNode | undefined;
  children: ReactNode;
  footer?: ReactNode | undefined;
  maxWidth?: string | undefined;
}) {
  if (!open) return null;
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-background/70" />
        <Dialog.Content
          className={cn(
            "glass-strong fixed left-1/2 top-1/2 z-50 w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-glass-border p-5 shadow-2xl outline-none sm:p-6",
            maxWidth
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Dialog.Title className="text-lg font-semibold text-foreground">
                {title}
              </Dialog.Title>
              {description && (
                <Dialog.Description className="mt-1 text-xs text-muted-foreground">
                  {description}
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close
              aria-label="Close"
              className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="size-4" />
            </Dialog.Close>
          </div>
          <div className="mt-4 max-h-[68dvh] overflow-y-auto pr-1">{children}</div>
          {footer && (
            <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-hairline pt-4">
              {footer}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function KDrawer({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: ReactNode;
  description?: ReactNode | undefined;
  children: ReactNode;
  footer?: ReactNode | undefined;
}) {
  if (!open) return null;
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-background/70" />
        <Dialog.Content className="glass-strong fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-glass-border shadow-2xl outline-none sm:rounded-l-3xl">
          <div className="flex items-start justify-between gap-3 border-b border-hairline px-5 py-4">
            <div className="min-w-0">
              <Dialog.Title className="truncate text-lg font-semibold text-foreground">
                {title}
              </Dialog.Title>
              {description && (
                <Dialog.Description className="mt-0.5 truncate text-xs text-muted-foreground">
                  {description}
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close
              aria-label="Close drawer"
              className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="size-4" />
            </Dialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto p-5">{children}</div>
          {footer && (
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-hairline px-5 py-3.5">
              {footer}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
