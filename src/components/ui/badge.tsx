import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary/10 text-primary",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "border-border text-muted-foreground",
        success: "border-transparent bg-[hsl(var(--success))]/12 text-[hsl(var(--success))]",
        warning: "border-transparent bg-[hsl(var(--warning))]/15 text-[hsl(var(--warning))]",
        destructive: "border-transparent bg-destructive/12 text-destructive",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export const Badge = ({ className, variant, ...props }: BadgeProps) => (
  <span className={cn(badgeVariants({ variant }), className)} {...props} />
);

/** Maps a run/step status to its badge variant in exactly one place. */
export function statusVariant(status: string): NonNullable<BadgeProps["variant"]> {
  switch (status) {
    case "COMPLETED":
      return "success";
    case "RUNNING":
      return "default";
    case "QUEUED":
    case "PENDING":
      return "outline";
    case "FAILED":
      return "destructive";
    case "CANCELLED":
    case "SKIPPED":
      return "warning";
    default:
      return "secondary";
  }
}
