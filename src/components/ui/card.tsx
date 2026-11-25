import type { ComponentProps } from "react"
import { cn } from "cn"

function Card({ className, size = "default", ...props }: ComponentProps<"div"> & { size?: "default" | "sm" }) {
  return <div data-slot="card" data-size={size} className={cn("ui-card", className)} {...props} />
}
function CardHeader(props: ComponentProps<"div">) { return <div data-slot="card-header" {...props} /> }
function CardTitle(props: ComponentProps<"div">) { return <div data-slot="card-title" {...props} /> }
function CardDescription(props: ComponentProps<"div">) { return <div data-slot="card-description" {...props} /> }
function CardAction(props: ComponentProps<"div">) { return <div data-slot="card-action" {...props} /> }
function CardContent(props: ComponentProps<"div">) { return <div data-slot="card-content" {...props} /> }
function CardFooter(props: ComponentProps<"div">) { return <div data-slot="card-footer" {...props} /> }
export { Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent, CardFooter }
