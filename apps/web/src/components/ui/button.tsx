import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { useSoundEffect } from '@/lib/sound';

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-medium transition-all focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 active:scale-95',
  {
    variants: {
      variant: {
        default: 'bg-arc-500 text-white shadow-[0_0_15px_rgba(13,139,255,0.4)] hover:bg-arc-400',
        // legacy alias (pre-spatial pages used variant="primary")
        primary: 'bg-arc-500 text-white shadow-[0_0_15px_rgba(13,139,255,0.4)] hover:bg-arc-400',
        destructive: 'bg-signal-red/20 text-signal-red border border-signal-red/30 hover:bg-signal-red/30',
        outline: 'border border-border bg-transparent hover:bg-surface-overlay text-foreground',
        secondary: 'bg-surface-raised text-foreground hover:bg-surface-overlay',
        // legacy alias for secondary
        subtle: 'bg-surface-raised text-foreground hover:bg-surface-overlay',
        ghost: 'hover:bg-surface-overlay hover:text-foreground text-muted-foreground',
        glass: 'glass hover:glass-arc text-foreground',
        link: 'text-arc-400 underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2',
        // legacy alias (pre-spatial pages used size="md")
        md: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-10 rounded-lg px-8',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const soundRef = useSoundEffect('hover', 'click');
    const Comp = asChild ? Slot : 'button';
    
    // Merge provided ref with our sound ref
    const mergedRef = React.useCallback(
      (node: HTMLButtonElement) => {
        if (typeof ref === 'function') ref(node);
        else if (ref) ref.current = node;
        (soundRef as React.MutableRefObject<HTMLButtonElement>).current = node;
      },
      [ref, soundRef]
    );

    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={mergedRef}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
