local __metrics=require("../observability/bridge").create_metrics("reference-catalog",1)
---@param node pandoc.Span
---@param filter table<string, fun(span: pandoc.Span)>
local function walkSpan(node, filter) return node:walk(filter) end
---@param node pandoc.Span
---@param filter table<string, fun(span: pandoc.Span)>
---@return pandoc.Inline
local function __perfWalk1(node, filter)
  return __metrics.wrap_walk({id="reference-catalog.lua.targets.walk.1",kind='ast_walk',scope="block"},walkSpan)(node, filter)
end
-- Адаптер использует публичные узлы Pandoc/Quarto, не обращаясь к внутреннему индексу.
local M = {}
local constants = require("./constants")
---@type table<string, boolean>
local types = {}
---@type table<string, boolean>
local ids = {}
---@type table<string, pandoc.Inlines>
local titles = {}
---@type table<string, string>
local heading_titles = {}
---@param v pandoc.MetaValue|pandoc.Inline|pandoc.Block|nil
---@return string
local function str(v) return v and pandoc.utils.stringify(v) or "" end
---@param meta pandoc.Meta
function M.init(meta)
  for _, name in ipairs(constants.target_types) do
    types[name] = true
  end
  local crossref = meta.crossref
  if type(crossref) == "table" then
    local custom = rawget(crossref, "custom")
    if type(custom) == "table" then
      ---@type pandoc.MetaValue[]
      local items = custom
      for _, item in ipairs(items) do
        if type(item) == "table" then types[str(rawget(item, "key"))] = true end
      end
    end
  end
end
---@class QrcCustomTarget
---@field identifier? string
---@field attr? pandoc.Attr
---@field div? pandoc.Div
---@field t? "FloatRefTarget"|"Callout"|"Theorem"|"Proof"

---@alias QrcTargetNode pandoc.Header|pandoc.Div|pandoc.Span|pandoc.Figure|pandoc.Table|pandoc.Image|pandoc.CodeBlock|QrcCustomTarget

-- У custom узла принимается прежний div fallback независимо от значения t.
---@param node {div?: pandoc.Div}
---@return string|nil
local function nestedIdentifier(node)
  return node.div and node.div.identifier
end

---@param el QrcTargetNode
function M.capture(el)
  local id = el.identifier or (el.attr and el.attr.identifier)
  if not id then id = nestedIdentifier(el) end
  local prefix = id and id:match("^([^-]+)%-")
  if id and prefix and types[prefix] then
    ids[id] = true
    if el.t == "Header" then heading_titles[id] = str(el.content) end
    -- К фазе pre-ast заголовки глав первого уровня уже перенесены в metadata.title.
    -- Quarto сохраняет там явный ID и элементы chapter-title.
    if el.t == "Span" and el.classes:includes("quarto-section-identifier") then
      ---@type string|nil
      local title = nil
      __perfWalk1(el,{Span = function(span)
        if span.classes:includes("chapter-title") then title = str(span.content) end
      end})
      heading_titles[id] = title or str(el.content)
    end
    if el.t == "Header" and id:match("^sec%-") and
      (el.classes:includes("unnumbered") or not PANDOC_WRITER_OPTIONS.number_sections) then
      titles[id] = el.content
    end
  end
end
---@param block pandoc.Para|pandoc.Plain
function M.equations(block)
  -- К фазе post-ast метки формул остаются обычными строчными аннотациями.
  -- Читаем атрибуты только непосредственно после выключной формулы.
  local pending = false
  ---@type QrcInline[]
  local content = block.content
  for _, el in ipairs(content) do
    if el.t == "Math" and el.mathtype == "DisplayMath" then pending = true
    elseif pending and (el.t == "Space" or el.t == "SoftBreak") then
    elseif pending and el.t == "Str" then
      local id = el.text:match("^{#(eq%-[^}%s]+)")
      if id then ids[id] = true end
      pending = false
    else pending = false end
  end
end
---@return string[]
function M.sorted()
  ---@type string[]
  local out = {}; for id in pairs(ids) do out[#out + 1] = id end
  table.sort(out); return out
end
---@param id string
---@return pandoc.Inlines|nil
function M.title(id) return titles[id] end
-- Название — обычный текст; штатная подпись перекрёстной ссылки хранится отдельно.
-- Для ненумерованных целей M.title предоставляет название вместо номера.
---@param id string
---@return string|nil
function M.heading_title(id) return heading_titles[id] end
M.init=__metrics.wrap_sync({id="reference-catalog.lua.targets.init",kind='phase'},M.init)
M.capture=__metrics.wrap_sync({id="reference-catalog.lua.targets.capture",kind='phase'},M.capture)
M.equations=__metrics.wrap_sync({id="reference-catalog.lua.targets.equations",kind='phase'},M.equations)
M.sorted=__metrics.wrap_sync({id="reference-catalog.lua.targets.sorted",kind='phase'},M.sorted)
M.title=__metrics.wrap_sync({id="reference-catalog.lua.targets.title",kind='phase'},M.title)
M.heading_title=__metrics.wrap_sync({id="reference-catalog.lua.targets.heading_title",kind='phase'},M.heading_title)
return M
