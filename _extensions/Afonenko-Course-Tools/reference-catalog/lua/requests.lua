local metrics = require("../observability/bridge").create_metrics("reference-catalog", 1)
local diagnostics = require("./diagnostics")
local links = require("./links")

---@param handler string
local function spec(handler)
  local input = quarto.doc.input_file
  return {
    id = "reference-catalog.lua.requests.handler." .. handler,
    kind = "function",
    document_id = type(input) == "string" and input ~= "" and input or nil,
  }
end

---@param meta pandoc.Meta
---@return pandoc.Meta
local function prepare(meta)
  -- Конфигурацию сборки обрабатывают проектные скрипты, без ресурсов документа.
  local config = meta["reference-catalog"]
  if config then
    assert(
      type(config) == "table",
      diagnostics.message(
        "QRC.CONFIG_INVALID",
        "reference-catalog должен быть объектом",
        nil,
        "reference-catalog"
      )
    )
    ---@type pandoc.MetaValue|nil
    local namespace = rawget(config, "namespace")
    ---@type pandoc.MetaMap
    local selected = {}
    if namespace ~= nil then
      selected.namespace = namespace
    end
    meta["reference-catalog"] = selected
  end
  return meta
end

---@param el pandoc.Cite
---@return pandoc.Inlines|nil
local function citations(el)
  ---@type {ns: string, id: string, cite: pandoc.Citation}[]
  local refs = {}
  ---@type pandoc.Citation[]
  local source = el.citations
  for _, citation in ipairs(source) do
    local ns, id = citation.id:match("^([%a][%w_-]*):([%a][^:]*%-[^:]+)$")
    if ns and id then
      refs[#refs + 1] = { ns = ns, id = id, cite = citation }
    end
  end
  if #refs == 0 then
    return nil
  end
  assert(
    #refs == #el.citations,
    diagnostics.message(
      "QRC.REFERENCE_INVALID",
      "библиографические ссылки и ссылки каталога следует записывать отдельно",
      nil,
      "citations"
    )
  )
  local out = pandoc.Inlines({})
  for index, reference in ipairs(refs) do
    if index > 1 then
      out:insert(pandoc.Str(";"))
      out:insert(pandoc.Space())
    end
    out:extend(reference.cite.prefix)
    if #reference.cite.prefix > 0 then
      out:insert(pandoc.Space())
    end
    out:insert(
      links.link(
        reference.ns,
        reference.id,
        reference.cite.mode == "SuppressAuthor" and "number" or "default",
        ""
      )
    )
    if #reference.cite.suffix > 0 then
      out:insert(pandoc.Space())
      out:extend(reference.cite.suffix)
    end
  end
  return out
end
return {
  {
    Meta = function(meta)
      return metrics.wrap_sync(spec("Meta"), prepare)(meta)
    end,
  },
  {
    Cite = function(el)
      return metrics.wrap_sync(spec("Cite"), citations)(el)
    end,
  },
}
