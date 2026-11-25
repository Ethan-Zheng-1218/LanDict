import type { ComponentProps } from "react"
import { cn } from "cn"
import { Button } from "./button"

type IconButtonProps = ComponentProps<typeof Button> & { label: string }
function IconButton({ label, className, variant = "ghost", size = "icon", ...props }: IconButtonProps) {
  return <Button aria-label={label} title={label} role={props.nativeButton === false ? "link" : undefined} variant={variant} size={size} className={cn("ui-icon-button", className)} {...props} />
}
export { IconButton }
