local metrics = require("../observability/bridge").create_metrics("reference-catalog", 1)
local diagnostics = require("./diagnostics")
local links = require("./links")

---@param args pandoc.MetaValue[]
---@param kwargs table<string, pandoc.MetaValue>
---@return pandoc.Link|pandoc.Span
local function xref(args, kwargs)
  assert(
    #args >= 2 and #args <= 3,
    diagnostics.message(
      "QRC.REFERENCE_INVALID",
      "xref принимает пространство имён, ID цели и необязательный текст",
      nil,
      "xref"
    )
  )
  local style = links.text(kwargs.style)
  return links.link(
    links.text(args[1]),
    links.text(args[2]),
    style == "" and "default" or style,
    links.text(args[3])
  )
end
---@param args pandoc.MetaValue[]
---@param kwargs table<string, pandoc.MetaValue>
---@return pandoc.Link|pandoc.Span
local function observedXref(args, kwargs)
  return metrics.wrap_sync(
    { id = "reference-catalog.lua.shortcodes.handler.xref", kind = "function" },
    xref
  )(args, kwargs)
end
return { xref = observedXref }
