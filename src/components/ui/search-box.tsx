import type { ComponentProps } from "react"
import { cn } from "cn"
import { Search } from "./icon"

function SearchBox({ className, children, multiline = false, ...props }: ComponentProps<"form"> & { multiline?: boolean }) {
  return <form className={cn("ui-search-box", multiline && "is-multiline", className)} {...props}><Search />{children}</form>
}
export { SearchBox }
