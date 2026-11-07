local __metrics=require("../observability/bridge").create_metrics("course-presentation",1)

-- Компактные подписи формируются из учебных атрибутов. В course.json
-- хранятся исходные значения, без созданных элементов оформления.
local M = {}
local vocabulary = require("./vocabulary")
local roles, difficulty, modes, requirement = vocabulary.roles, vocabulary.difficulty, vocabulary.workMode, vocabulary.requirement
---@param div pandoc.Div
---@param name string
local function add_class(div, name) if not div.classes:includes(name) then div.classes:insert(name) end end
---@param div pandoc.Div
---@param cfg CoursePresentationConfig
---@return pandoc.Div
function M.decorate(div, cfg)
  local attrs = div.attributes
  local role = attrs["course-role"]
  local canonical=cfg.bank and div.identifier:match("^exr%-")
  local defaults = not canonical and (div.identifier:match("^exr%-") or (roles[role] and roles[role].activity)) and cfg.defaults or {}
  ---@type table<string,string>
  local values = {}
  for _, key in ipairs({"difficulty", "time", "work-mode", "requirement"}) do
    values[key] = attrs[key] or defaults[key]
  end
  local parts = pandoc.Inlines({})
  ---@param text? string
  ---@param kind string
  local function badge(text, kind)
    if not text then return end
    if #parts > 0 then parts:insert(pandoc.Space()) end
    parts:insert(pandoc.Span({pandoc.Str(text)}, pandoc.Attr("", {"course-meta", "course-meta-" .. kind})))
  end
  if roles[role] then
    add_class(div, "course-block")
    add_class(div, "course-role-" .. role)
    badge(roles[role].label, "role")
  end
  badge(difficulty[values.difficulty], "difficulty")
  if cfg.assessmentTime ~= false then
    badge(values.time and (values.time .. (cfg.ru and " мин" or " min")), "time")
  end
  if values["work-mode"] ~= "individual" then
    badge(modes[values["work-mode"]], "work-mode")
  end
  badge(requirement[values.requirement], "requirement")
  if #parts > 0 then
    local line = pandoc.Div({pandoc.Plain(parts)}, pandoc.Attr("", {"course-metadata"}))
    -- Quarto читает название теоремы или упражнения из первого Header.
    -- Сохраняем его положение и единственный экземпляр ID.
    local position = div.content[1] and div.content[1].t == "Header" and 2 or 1
    div.content:insert(position, line)
  end
  -- Авторские атрибуты не должны совпадать с семантикой атрибутов браузера.
  -- Ядро уже извлекло и проверило их на этапе pre-ast.
  for _, key in ipairs(vocabulary.pedagogyAttributes) do
    if attrs[key] then attrs[key == "course-role" and "data-course-role" or "data-course-" .. key] = attrs[key]; attrs[key] = nil end
  end
  return div
end
M.decorate=__metrics.wrap_sync({id="course-presentation.modules.metadata.decorate",kind='phase'},M.decorate)
return M
