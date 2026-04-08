import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  // Base styles shared by all variants
  'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 disabled:pointer-events-none disabled:bg-gray-300 disabled:text-gray-500 disabled:border-gray-300',
  {
    variants: {
      variant: {
        // Primary: solid black fill with white text; hover lightens slightly to zinc-800
        default: 'bg-black text-white border border-black hover:bg-zinc-800 hover:border-zinc-800',

        // Outline / secondary: white background, black border, black text; hover adds a subtle gray tint
        outline: 'bg-white text-black border border-black hover:bg-gray-100',

        // Ghost: no background or border; hover shows a light gray fill with black text
        ghost:
          'bg-transparent text-black border border-transparent hover:bg-gray-100 hover:text-black',

        // Link: looks like a hyperlink — no background, black text, underline on hover
        link: 'bg-transparent text-black border-0 underline-offset-4 hover:underline',

        // Destructive: retained as a distinct semantic danger variant (e.g., confirm-delete actions)
        // Uses deep red so the user clearly understands the irreversible nature of the action.
        destructive:
          'bg-red-600 text-white border border-red-600 hover:bg-red-700 hover:border-red-700',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-md px-3',
        lg: 'h-11 rounded-md px-8',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
