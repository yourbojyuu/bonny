import * as React from "react"
import { createRoot, Root } from "react-dom/client"
import GlassFolder, { GlassFolderProps } from "./glass-folder-cards"

/** ผูก GlassFolder เข้ากับหน้าเว็บ JS ธรรมดา: GFMount(element, props) -> unmount() */
const roots = new WeakMap<Element, Root>()
;(window as unknown as { GFMount: (el: Element, p: GlassFolderProps) => void }).GFMount = (el, p) => {
  let r = roots.get(el)
  if (!r) { r = createRoot(el); roots.set(el, r) }
  r.render(React.createElement(GlassFolder, p))
}
;(window as unknown as { GFUnmount: (el: Element) => void }).GFUnmount = (el) => {
  const r = roots.get(el); if (r) { r.unmount(); roots.delete(el) }
}
