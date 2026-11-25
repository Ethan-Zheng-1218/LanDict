import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

const buttonVariants = cva("ui-button", {
  variants: {
    variant: {
      default: "ui-button--primary",
      primary: "ui-button--primary",
      outline: "ui-button--secondary",
      secondary: "ui-button--secondary",
      ghost: "ui-button--ghost",
      text: "ui-button--ghost",
      destructive: "ui-button--destructive",
      "destructive-solid": "ui-button--destructive-solid",
      link: "ui-button--link",
      icon: "ui-button--ghost",
    },
    size: {
      default: "ui-button--md",
      md: "ui-button--md",
      sm: "ui-button--sm",
      xs: "ui-button--sm",
      lg: "ui-button--lg",
      icon: "ui-button--md ui-button--icon",
      "icon-xs": "ui-button--sm ui-button--icon",
      "icon-sm": "ui-button--sm ui-button--icon",
      "icon-lg": "ui-button--lg ui-button--icon",
      // Keep frozen page geometry while sharing font and interaction states.
      preserve: "ui-button--preserve",
    },
  },
  defaultVariants: { variant: "default", size: "default" },
})

function Button({ className, variant = "default", size = "default", loading = false, disabled, ...props }:
  ButtonPrimitive.Props & VariantProps<typeof buttonVariants> & { loading?: boolean }) {
  return (
    <ButtonPrimitive
      data-slot="button"
      data-size={size}
      data-variant={variant}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
