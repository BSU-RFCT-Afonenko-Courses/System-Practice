local __metrics=require("./observability/bridge").create_metrics("course-presentation",1)
---@param node pandoc.Blocks
---@param filter CourseNativeWalkFilter
---@return pandoc.Blocks
local function walk_blocks(node,filter) return node:walk(filter) end
---@param node pandoc.Pandoc
---@param filter table<string,function>
---@return pandoc.Pandoc
local function walk_document(node,filter) return node:walk(filter) end
local __perfWalk1=__metrics.wrap_walk({id="course-presentation.filter.walk.1",kind='ast_walk',scope="unknown"},walk_blocks)
local __perfWalk2=__metrics.wrap_walk({id="course-presentation.filter.walk.2",kind='ast_walk',scope="full-document"},walk_document)
-- Фильтр выполняется после course-core на этапе pre-ast. Ядро отбирает данные
-- по профилю и проверяет их смысл; этот модуль оформляет их в штатных форматах.
local config = require("./modules/config")
local metadata = require("./modules/metadata")
local answers = require("./modules/answers")

---@param blocks pandoc.Blocks
---@param owner? string
---@param cfg CoursePresentationConfig
---@return pandoc.Blocks
local function transform(blocks, owner, cfg)
  return __perfWalk1(blocks,{traverse = "topdown", Div =
  ---@param div pandoc.Div
  ---@return pandoc.Div, boolean
  function(div)
    local current = div.identifier:match("^exr%-") and div.identifier or owner
    local related=owner or cfg.solutionOwners[div.identifier]
    local kind = answers.kind(div, related)
    -- Native Div гарантирует Blocks; не копируем его ради неточного List typing.
    local content=div.content
    ---@cast content pandoc.Blocks
    div.content = transform(content, current, cfg)
    div = metadata.decorate(div, cfg)
    return answers.wrap(div, kind, cfg), false
  end})
end

---@param doc pandoc.Pandoc
---@return pandoc.Pandoc
local function present(doc)
  assert(not doc.meta.course or doc.meta["course-core-processed"] == true,
    "PRESENTATION.FILTER_ORDER_INVALID: Фильтр course-core должен предшествовать course-presentation при наличии метаданных course; источник="..quarto.doc.input_file.."; поле=filters")
  local cfg = config.read(doc.meta)
  ---@type table<string,boolean>
  local identities={}
  __perfWalk2(doc,{Div=---@param div pandoc.Div
  function(div) identities[div.identifier]=true end})
  cfg.solutionOwners={}
  for id,_ in pairs(identities) do
    if id:match("^sol%-") then
      local suffix=id:sub(5)
      local exercise,example=identities["exr-"..suffix],identities["exm-"..suffix]
      if exercise and not example then cfg.solutionOwners[id]="exr-"..suffix end
      if example and not exercise and not cfg.bank then cfg.solutionOwners[id]="exm-"..suffix end
    end
  end
  doc.blocks = transform(doc.blocks, nil, cfg)
  if cfg.html then
    -- Public producer declaration; these exact attribs witness current native tags.
    local descriptor=assert(io.open(quarto.utils.resolve_path("html-dependency.json"),'r'))
    local dependency=pandoc.json.decode(descriptor:read('*a'),false);descriptor:close()
    assert(type(dependency)=='table','PRESENTATION.DEPENDENCY_INVALID: неверный descriptor')
    ---@cast dependency table<string|integer,CourseJsonValue>
    assert(type(dependency.name)=='string','PRESENTATION.DEPENDENCY_INVALID: неверный descriptor')
    quarto.doc.add_html_dependency(dependency)
  end
  return doc
end
---@param doc pandoc.Pandoc
---@return pandoc.Pandoc
local function handler(doc)
  return __metrics.wrap_sync({id="course-presentation.filter.handler.Pandoc",kind='phase',document_id=quarto.doc.input_file},present)(doc)
end
local mode=os.getenv('COURSE_PERF_MODE')
return {{Pandoc=mode and mode~='off' and handler or present}}
