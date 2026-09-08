import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva("inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-bold transition-all duration-200 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-[.98]", {
  variants: {
    variant: { default: "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90", secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/75", outline: "border bg-card hover:bg-muted", ghost: "hover:bg-muted", destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90", success: "bg-emerald-600 text-white hover:bg-emerald-700" },
    size: { default: "h-10 px-4", sm: "h-8 rounded-lg px-3 text-xs", lg: "h-12 px-5", icon: "h-10 w-10 p-0", "icon-sm": "h-8 w-8 rounded-lg p-0" },
  },
  defaultVariants: { variant: "default", size: "default" },
});

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> { asChild?: boolean; }
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} ref={ref} {...props} />;
});
Button.displayName = "Button";
export { Button, buttonVariants };
