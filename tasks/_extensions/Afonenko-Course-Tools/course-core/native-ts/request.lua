-- Только transport текущего Core producer; условия и metadata разрешает Quarto.
---@class CourseNativeContext
---@field operation string
---@field captureWitness? string
---@field input string
---@field projection string
---@field profiles? string[]
---@field format? string
---@field exerciseBank? boolean
---@class CourseNativeAssessment
---@field source string
---@field id string
---@class CourseNativeAssignment
---@field source string
---@field assessments CourseNativeAssessment[]
---@class CourseNativeRequest
---@field context CourseNativeContext
---@field capture string
---@field assignment? CourseNativeAssignment
---@class CourseNativeChild
---@field token string
---@field used boolean
---@field posted? boolean
---@field inputs string[]
---@class CourseNativePointer
---@field operation string
---@field directory string
---@class CourseNativeState: CourseNativePointer
---@field root string
---@field inputs string[]

---@param value CourseJsonValue|nil
---@return string[]
local function strings(value)
  assert(type(value)=='table','OPERATION_BINDING: нужен список строк')
  for key,item in pairs(value) do
    assert(type(key)=='number' and key>=1 and key%1==0 and type(item)=='string','OPERATION_BINDING: неверный список строк')
  end
  ---@cast value string[]
  return value
end
---@param value CourseJsonValue
---@return CourseNativeRequest
local function request(value)
  assert(type(value)=='table','DOCUMENT_CONTEXT: повреждённый native request')
  ---@cast value table<string|integer,CourseJsonValue>
  assert(type(value.context)=='table' and type(value.capture)=='string','DOCUMENT_CONTEXT: повреждённый native request')
  local context=value.context
  ---@cast context table<string|integer,CourseJsonValue>
  assert(type(context.operation)=='string' and type(context.input)=='string' and type(context.projection)=='string','DOCUMENT_CONTEXT: повреждённый native context')
  assert(context.captureWitness==nil or type(context.captureWitness)=='string','DOCUMENT_CONTEXT: повреждённый capture witness')
  assert(context.format==nil or type(context.format)=='string','DOCUMENT_CONTEXT: повреждённый format')
  assert(context.exerciseBank==nil or type(context.exerciseBank)=='boolean','DOCUMENT_CONTEXT: повреждённый exerciseBank')
  if context.profiles~=nil then strings(context.profiles) end
  local assignment=value.assignment
  if assignment~=nil then
    assert(type(assignment)=='table','DOCUMENT_CONTEXT: повреждённый assignment request')
    ---@cast assignment table<string|integer,CourseJsonValue>
    assert(type(assignment.source)=='string' and type(assignment.assessments)=='table','DOCUMENT_CONTEXT: повреждённый assignment request')
    local assessments=assignment.assessments
    ---@cast assessments table<string|integer,CourseJsonValue>
    for key,selected in pairs(assessments) do
      assert(type(key)=='number' and key>=1 and key%1==0 and type(selected)=='table','DOCUMENT_CONTEXT: повреждённый assessment request')
      ---@cast selected table<string|integer,CourseJsonValue>
      assert(type(selected.source)=='string' and type(selected.id)=='string','DOCUMENT_CONTEXT: повреждённый assessment request')
    end
  end
  ---@cast value CourseNativeRequest
  return value
end
---@param path string
---@return CourseJsonValue
local function read(path)
  local file=assert(io.open(path,'rb'),'OPERATION_INCOMPLETE: отсутствует '..path)
  local value=pandoc.json.decode(file:read('*a'),false);file:close();return value
end
---@param doc pandoc.Pandoc
---@return CourseNativeRequest,string
return function(doc)
  local manual=os.getenv('COURSE_CORE_TS_RUN')
  if manual then return request(read(manual)),manual end
  local route=pandoc.utils.stringify(doc.meta['course-core-runtime'] or 'native-ts')
  assert(route=='native-ts','CORE.METADATA_INVALID: неизвестный Core runtime')
  local root=assert(quarto.project.directory,'OPERATION_BINDING: нет project owner')
  local base=pandoc.path.join({root,'_generated/course-spec/native-ts'})
  local active=read(pandoc.path.join({base,'active.json'}))
  assert(type(active)=='table','OPERATION_BINDING: чужой native pointer')
  ---@cast active table<string|integer,CourseJsonValue>
  assert(type(active.operation)=='string' and active.operation:match('^[a-f0-9%-]+$') and active.directory==pandoc.path.join({base,active.operation}),'OPERATION_BINDING: чужой native pointer')
  ---@cast active CourseNativePointer
  local state=read(pandoc.path.join({active.directory,'state.json'}))
  assert(type(state)=='table' and state.operation==active.operation and state.root==root and state.directory==active.directory,'OPERATION_BINDING: чужой bound state')
  strings(state.inputs)
  ---@cast state CourseNativeState
  local reservation_file=io.open(pandoc.path.join({active.directory,'reservation.json'}),'rb')
  ---@type CourseNativeChild|nil
  local child
  if reservation_file then
    local reservation=pandoc.json.decode(reservation_file:read('*a'),false);reservation_file:close()
    assert(type(reservation)=='table','OPERATION_BINDING: повреждённый child capture')
    ---@cast reservation table<string|integer,CourseJsonValue>
    assert(type(reservation.children)=='table','OPERATION_BINDING: повреждённый child capture')
    local children=reservation.children
    ---@cast children CourseJsonValue[]
    local selected=children[#children]
    assert(type(selected)=='table' and type(selected.token)=='string' and type(selected.used)=='boolean' and (selected.posted==nil or type(selected.posted)=='boolean'),'OPERATION_BINDING: повреждённый child capture')
    strings(selected.inputs)
    ---@cast selected CourseNativeChild
    child=selected
    assert(reservation.status=='bound' and reservation.operation==state.operation and child.used and not child.posted and child.token==os.getenv('COURSE_CORE_CAPTURE_TOKEN'),'OPERATION_BINDING: чужой/завершённый child capture')
  end
  local input=quarto.doc.input_file
  if pandoc.path.is_relative(input) then input=pandoc.path.join({root,input}) end
  input=pandoc.path.normalize(input)
  for index,source in ipairs(state.inputs) do
    if pandoc.path.normalize(pandoc.path.join({root,source}))==input then
      if child then local found=false;for _,requested in ipairs(child.inputs) do if requested==source then found=true end end;assert(found,'OPERATION_BINDING: source вне active child') end
      local path=pandoc.path.join({active.directory,tostring(index-1)..'.request.json'})
      return request(read(path)),path
    end
  end
  error('OPERATION_BINDING: input отсутствует в текущей операции')
end
