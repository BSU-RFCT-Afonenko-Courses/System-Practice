local file = assert(io.open(pandoc.path.join({pandoc.path.directory(debug.getinfo(1, "S").source:sub(2)), "vocabulary.json"}), "r"))
local raw = pandoc.json.decode(file:read("*a"), false); file:close()
---@class CoursePresentationVocabulary
---@field roles table<string,{label:string,activity?:boolean}>
---@field difficulty table<string,string>
---@field workMode table<string,string>
---@field requirement table<string,string>
---@field pedagogyAttributes string[]
---@field presentationAnswers string[]
assert(type(raw)=="table", "PRESENTATION.VOCABULARY_INVALID: нужна карта")
---@cast raw table<string|integer,CourseJsonValue>
---@type table<string|integer,CourseJsonValue>
local vocabulary=raw
---@param value CourseJsonValue
local function string_map(value)
  assert(type(value)=="table", "PRESENTATION.VOCABULARY_INVALID: нужна карта строк")
  for key,text in pairs(value) do assert(type(key)=="string" and type(text)=="string", "PRESENTATION.VOCABULARY_INVALID: нужна строка") end
end
---@param value CourseJsonValue
local function string_list(value)
  assert(type(value)=="table", "PRESENTATION.VOCABULARY_INVALID: нужен список строк")
  for key,text in pairs(value) do assert(type(key)=="number" and key>=1 and key%1==0 and type(text)=="string", "PRESENTATION.VOCABULARY_INVALID: неверный список") end
end
assert(type(vocabulary.roles)=="table", "PRESENTATION.VOCABULARY_INVALID: нужна карта ролей")
local roles=vocabulary.roles
---@cast roles table<string|integer,CourseJsonValue>
for key,role in pairs(roles) do
  assert(type(key)=="string" and type(role)=="table", "PRESENTATION.VOCABULARY_INVALID: неверная роль")
  ---@cast role table<string|integer,CourseJsonValue>
  assert(type(role.label)=="string" and (role.activity==nil or type(role.activity)=="boolean"), "PRESENTATION.VOCABULARY_INVALID: неверная роль")
end
string_map(vocabulary.difficulty); string_map(vocabulary.workMode); string_map(vocabulary.requirement)
string_list(vocabulary.pedagogyAttributes); string_list(vocabulary.presentationAnswers)
---@cast vocabulary CoursePresentationVocabulary
return vocabulary
