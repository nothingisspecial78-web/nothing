import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Sheet({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {children}
    </Dialog.Root>
  );
}

export const SheetTrigger = Dialog.Trigger;
export const SheetClose = Dialog.Close;

export function SheetContent({
  side = "right",
  className,
  style,
  children,
}: {
  side?: "left" | "right" | "bottom";
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const pos =
    side === "left"
      ? "inset-y-0 left-0 w-full max-w-sm rounded-r-2xl"
      : side === "bottom"
        ? "inset-x-0 bottom-0 max-h-[85dvh] rounded-t-3xl"
        : "inset-y-0 right-0 w-full max-w-md rounded-l-2xl";

  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-background/60" />
      <Dialog.Content
        style={style}
        className={cn(
          "glass-strong fixed z-50 flex flex-col p-6 shadow-2xl outline-none",
          pos,
          className
        )}
      >
        <Dialog.Close className="absolute right-4 top-4 rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
          <X className="size-4" />
        </Dialog.Close>
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  );
}

export function SheetHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col space-y-2 text-center sm:text-left", className)} {...props} />;
}

export const SheetTitle = Dialog.Title;
export const SheetDescription = Dialog.Description;
