import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/App";
import "./styles/app.css";
import { HoverLookupWindow } from "./features/mouseLookup/HoverLookupWindow";
import { MouseLookupBridge } from "./features/mouseLookup/MouseLookupBridge";
import "./features/mouseLookup/mouseLookup.css";

const isLookupWindow = new URLSearchParams(window.location.search).get("window") === "mouse-lookup";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isLookupWindow ? <HoverLookupWindow /> : <><MouseLookupBridge /><App /></>}
  </StrictMode>,
);
