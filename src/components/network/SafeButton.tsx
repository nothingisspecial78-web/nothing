import * as React from 'react';
import { Loader2, WifiOff } from 'lucide-react';
import { Btn, type BtnProps } from '@/components/khazna/btn';
import { useNetworkStore } from '@/lib/network/networkStore';
import { cn } from '@/lib/utils';

export interface SafeButtonProps extends Omit<BtnProps, 'onClick'> {
  isLoading?: boolean;
  loadingText?: string;
  disableWhenOffline?: boolean;
  cooldownMs?: number;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => unknown | Promise<unknown>;
}

/**
 * Double-click & spam-click protected button wrapper.
 * Prevents duplicate async submissions using a synchronous ref lock, shows a clean spinner,
 * and optionally blocks submission when offline (e.g. for Razorpay checkout triggers).
 */
export const SafeButton = React.forwardRef<HTMLButtonElement, SafeButtonProps>(
  (
    {
      children,
      className,
      disabled,
      isLoading = false,
      loadingText,
      disableWhenOffline = false,
      cooldownMs = 350,
      onClick,
      type = 'button',
      ...props
    },
    ref
  ) => {
    const isOnline = useNetworkStore((s) => s.isOnline);
    const [pending, setPending] = React.useState(false);
    const inFlightRef = React.useRef(false);
    const mountedRef = React.useRef(true);

    React.useEffect(() => {
      mountedRef.current = true;
      return () => {
        mountedRef.current = false;
      };
    }, []);

    const offlineBlocked = disableWhenOffline && !isOnline;
    const effectiveBusy = Boolean(isLoading || pending);
    const effectiveDisabled = Boolean(disabled || effectiveBusy || offlineBlocked);

    const handleClick = async (event: React.MouseEvent<HTMLButtonElement>) => {
      if (effectiveDisabled || inFlightRef.current) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (!onClick) return;

      inFlightRef.current = true;
      setPending(true);
      try {
        await onClick(event);
      } finally {
        if (cooldownMs > 0) {
          await new Promise((r) => setTimeout(r, cooldownMs));
        }
        inFlightRef.current = false;
        if (mountedRef.current) {
          setPending(false);
        }
      }
    };

    return (
      <Btn
        ref={ref}
        type={type}
        disabled={effectiveDisabled}
        aria-busy={effectiveBusy}
        data-busy={effectiveBusy ? 'true' : 'false'}
        onClick={handleClick}
        className={cn(effectiveBusy && 'cursor-wait', className)}
        {...props}
      >
        {effectiveBusy ? (
          <>
            <Loader2 className="size-4 animate-spin shrink-0" />
            <span>{loadingText || children}</span>
          </>
        ) : offlineBlocked ? (
          <>
            <WifiOff className="size-4 shrink-0" />
            <span>Offline · Reconnect to continue</span>
          </>
        ) : (
          children
        )}
      </Btn>
    );
  }
);

SafeButton.displayName = 'SafeButton';
