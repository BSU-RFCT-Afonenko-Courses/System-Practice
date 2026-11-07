local __metrics=require("../observability/bridge").create_metrics("reference-catalog",1)

local diagnostics = require("./diagnostics")
local targets = require("./targets")
local constants = require("./constants")
---@param doc pandoc.Pandoc
---@return pandoc.Pandoc
local function finish(doc)
  if not quarto.doc.is_format("html") then return doc end
  local config = doc.meta["reference-catalog"]
  ---@type pandoc.MetaValue|nil
  local namespace = type(config) == "table" and rawget(config, "namespace") or nil
  local ns = os.getenv("QRC_NAMESPACE") or (namespace and pandoc.utils.stringify(namespace))
  assert(ns and ns ~= "", diagnostics.message("QRC.CONFIG_INVALID", "задайте reference-catalog.namespace в конфигурации native проекта", nil, "reference-catalog.namespace"))
  local rows = pandoc.Blocks({})
  for _, id in ipairs(targets.sorted()) do
    for _, style in ipairs(constants.probe_styles) do
      local mode = style == "number" and "SuppressAuthor" or "NormalCitation"
      ---@type pandoc.Cite|pandoc.Span|pandoc.Link
      local ref = pandoc.Cite({pandoc.Str("@" .. id)}, {pandoc.Citation(id, mode)})
      local nativeTitle = targets.title(id)
      if nativeTitle then
        ref = style == "number" and pandoc.Span({}, pandoc.Attr("", {"qrc-unavailable"}))
          or pandoc.Link(nativeTitle, "#" .. id, "", pandoc.Attr("", {"qrc-anchor"}))
      end
      local attrs = {["data-qrc-id"]=id, ["data-qrc-style"]=style}
      local title = targets.heading_title(id)
      if style == "default" and title and title ~= "" then attrs["data-qrc-title"] = title end
      rows:insert(pandoc.Div({pandoc.Para({ref})}, pandoc.Attr("", {"qrc-probe"}, attrs)))
    end
  end
  doc.blocks:insert(pandoc.Div(rows, pandoc.Attr("", {"qrc-probes"},
    {["hidden"]="", ["aria-hidden"]="true", ["data-qrc-namespace"]=ns,
     ["data-qrc-source"]=quarto.doc.input_file})))
  return doc
end
---@param handler string
---@param phase? boolean
local function spec(handler, phase)
  local input = quarto.doc.input_file
  return {id="reference-catalog.lua.probes.handler." .. handler,
    kind=phase and "phase" or "function",
    document_id=type(input) == "string" and input ~= "" and input or nil}
end

---@param name string
---@return fun(el: QrcTargetNode)
local function capture(name)
  ---@param el QrcTargetNode
  local function forward(el) return __metrics.wrap_sync(spec(name), targets.capture)(el) end
  return forward
end
---@param name string
---@return fun(el: pandoc.Para|pandoc.Plain)
local function equations(name)
  ---@param el pandoc.Para|pandoc.Plain
  local function forward(el) return __metrics.wrap_sync(spec(name), targets.equations)(el) end
  return forward
end
return {
  {Meta=function(meta) return __metrics.wrap_sync(spec("Meta"), targets.init)(meta) end},
  {Header=capture("Header"), Div=capture("Div"), Span=capture("Span"),
   Figure=capture("Figure"), Table=capture("Table"), Image=capture("Image"),
   CodeBlock=capture("CodeBlock"), FloatRefTarget=capture("FloatRefTarget"),
   Callout=capture("Callout"), Theorem=capture("Theorem"), Proof=capture("Proof"),
   Para=equations("Para"), Plain=equations("Plain")},
  {Pandoc=function(doc) return __metrics.wrap_sync(spec("Pandoc", true), finish)(doc) end},
}
