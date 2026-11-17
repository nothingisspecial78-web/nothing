import * as Dialog from "@radix-ui/react-dialog";
import { X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface QuickActionItem {
  id: string;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  colorClass?: string | undefined;
  onClick: () => void;
}

export function QuickActionSheet({
  open,
  onOpenChange,
  actions,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  actions: QuickActionItem[];
}) {
  if (!open) return null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-background/60" />
        <Dialog.Content className="glass-strong fixed inset-x-0 bottom-0 z-50 mx-auto max-w-md rounded-t-3xl border border-glass-border p-5 shadow-2xl outline-none sm:bottom-6 sm:rounded-3xl">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <Dialog.Title className="text-base font-semibold text-foreground">
                Quick actions
              </Dialog.Title>
              <Dialog.Description className="text-xs text-muted-foreground">
                Post ledger entries or enroll students
              </Dialog.Description>
            </div>
            <Dialog.Close
              aria-label="Close quick actions"
              className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="size-4" />
            </Dialog.Close>
          </div>
          <div className="space-y-2">
            {actions.map((a) => (
              <button
                key={a.id}
                type="button"
                data-ai-id={`quick-action-${a.id}-btn`}
                onClick={() => {
                  onOpenChange(false);
                  a.onClick();
                }}
                className="flex w-full items-center gap-3 rounded-2xl border border-hairline bg-card/70 p-3 text-left transition-colors hover:bg-accent"
              >
                <span
                  className={cn(
                    "grid size-10 shrink-0 place-items-center rounded-xl border",
                    a.colorClass || "bg-primary/10 text-primary border-primary/20"
                  )}
                >
                  <a.icon className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-foreground">{a.title}</div>
                  <div className="truncate text-xs text-muted-foreground">{a.subtitle}</div>
                </div>
              </button>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
