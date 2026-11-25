import type { ComponentProps, ReactNode } from "react"
import { cn } from "cn"

type PageHeaderProps = Omit<ComponentProps<"header">, "title"> & { title: ReactNode; headingLevel?: 1 | 2; actions?: ReactNode; actionsInline?: boolean }
function PageHeader({ title, headingLevel = 1, actions, actionsInline = false, children, className, ...props }: PageHeaderProps) {
  const Heading = headingLevel === 1 ? "h1" : "h2"
  return <header className={cn("ui-page-header", className)} {...props}><div className="ui-page-header-copy"><div className="ui-page-header-title-row"><Heading>{title}</Heading>{actionsInline && actions && <div className="ui-page-header-actions">{actions}</div>}</div>{children}</div>{!actionsInline && actions && <div className="ui-page-header-actions">{actions}</div>}</header>
}
export { PageHeader }
