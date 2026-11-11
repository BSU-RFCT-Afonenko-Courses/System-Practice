-- Post-render: условия и custom nodes уже разрешил сам Quarto.
local dir=pandoc.path.directory(debug.getinfo(1,'S').source:gsub('^@',''))
---@class CourseLateOccurrence
---@field key string
---@field body CourseJsonValue[]
---@field title? CourseJsonValue[]
---@field nativeKind string
---@field anchor string
---@class CourseLateOccurrences: pandoc.List
---@field [integer] CourseLateOccurrence
---@class CourseLateIntroduction
---@field key string
---@field body CourseJsonValue[]
---@field id? string
---@class CourseLateIntroductions: pandoc.List
---@field [integer] CourseLateIntroduction
---@class CourseJsonList: pandoc.List
---@field [integer] CourseJsonValue
---@type pandoc.List
local occurrences=pandoc.List()
---@cast occurrences CourseLateOccurrences
local introductions=pandoc.List()
---@cast introductions CourseLateIntroductions
---@param value CourseJsonValue
---@return CourseJsonValue[]
local function array(value)
  assert(type(value)=='table','DOCUMENT_BINDING: нужен native JSON array')
  for key in pairs(value) do assert(type(key)=='number' and key>=1 and key%1==0,'DOCUMENT_BINDING: неверный native JSON array') end
  ---@cast value CourseJsonValue[]
  return value
end
---@param doc pandoc.Pandoc
---@return CourseJsonValue[]
local function blocks(doc)
  local value=pandoc.json.decode(pandoc.write(doc,'json'),false)
  assert(type(value)=='table','DOCUMENT_BINDING: повреждённый native writer envelope')
  ---@cast value table<string|integer,CourseJsonValue>
  assert(type(value.blocks)=='table','DOCUMENT_BINDING: повреждённый native writer envelope')
  return array(value.blocks)
end
---@param value CourseJsonValue
---@return CourseNativeContext
local function bound_context(value)
  assert(type(value)=='table','DOCUMENT_BINDING: повреждённый late context')
  ---@cast value table<string|integer,CourseJsonValue>
  assert(type(value.operation)=='string' and type(value.input)=='string' and type(value.projection)=='string' and type(value.format)=='string','DOCUMENT_BINDING: повреждённый late context')
  assert(value.captureWitness==nil or type(value.captureWitness)=='string','DOCUMENT_BINDING: повреждённый capture witness')
  assert(value.exerciseBank==nil or type(value.exerciseBank)=='boolean','DOCUMENT_BINDING: повреждённый exerciseBank')
  assert(type(value.profiles)=='table','DOCUMENT_BINDING: повреждённые profiles')
  local profiles=value.profiles
  ---@cast profiles table<string|integer,CourseJsonValue>
  for key,profile in pairs(profiles) do assert(type(key)=='number' and key>=1 and key%1==0 and type(profile)=='string','DOCUMENT_BINDING: повреждённые profiles') end
  ---@cast value CourseNativeContext
  return value
end
---@param div pandoc.Div
---@return pandoc.Div
local function clean(div)
  div.attributes['data-course-core-occurrence']=nil
  div.attributes['data-course-core-native-kind']=nil
  return div
end
---@param doc pandoc.Pandoc
---@return pandoc.Pandoc
local function clean_document(doc)
  return doc:walk({Div=clean,Span=
  ---@param span pandoc.Span
  function(span) if span.attributes['data-course-core-native-title'] then return span.content end end})
end
return {{
  Div=
  ---@param div pandoc.Div
  function(div)
    local key=div.attributes['data-course-core-occurrence']
    local assessment_key=div.attributes['data-course-core-assessment']
    -- Native Div гарантирует Blocks; bundled typing объединяет его с List.
    local content=div.content
    ---@cast content pandoc.Blocks
    if assessment_key then
      local fragment=pandoc.Pandoc(content):walk({Div=
      ---@param d pandoc.Div
      function(d)
        if d.attributes['data-course-core-occurrence'] then return {} end
        return clean(d)
      end})
      introductions[#introductions+1]={key=assessment_key,body=blocks(fragment)}
    end
    if key then
      ---@type CourseJsonValue[]|nil
      local title
      local fragment=pandoc.Pandoc(content):walk({Div=clean,Span=
  ---@param span pandoc.Span
  function(span)
        local title_key=span.attributes['data-course-core-native-title']
        if title_key then
          assert(title_key==key and not title,'DOCUMENT_BINDING: foreign/duplicate native title')
          local plain=blocks(pandoc.Pandoc(pandoc.Blocks({pandoc.Plain(span.content)})))[1]
          assert(type(plain)=='table' and plain.t=='Plain' and type(plain.c)=='table','DOCUMENT_BINDING: повреждённый native title')
          title=array(plain.c)
          return span.content
        end
      end})
      local body=blocks(fragment)
      occurrences[#occurrences+1]={key=key,body=body,title=title,nativeKind=div.attributes['data-course-core-native-kind'] or 'Div',anchor=div.identifier}
    end
  end,
  Pandoc=
  ---@param doc pandoc.Pandoc
  ---@return pandoc.Pandoc
  function(doc)
    if not doc.meta['course-core-ts-binding'] then
      error('OPERATION_INCOMPLETE: отсутствует early binding')
    end
    ---@type fun(doc:pandoc.Pandoc):CourseNativeRequest,string
    local loader=dofile(pandoc.path.join({dir,'request.lua'}))
    local request=loader(doc)
    assert(request,'OPERATION_BINDING: отсутствует late request')
    local binding=doc.meta['course-core-ts-binding']
    local context=bound_context(pandoc.json.decode(pandoc.utils.stringify(binding),false))
    local identifier=assert(quarto.format.format_identifier(),'DOCUMENT_BINDING: нет native format identifier')
    local native_format=identifier['base-format']
    assert((native_format=='html' or native_format=='revealjs') and FORMAT==native_format and context.format==native_format,'DOCUMENT_BINDING: late native format отличается')
    local expected_profiles=request.context.profiles or (os.getenv('COURSE_CORE_TS_RUN') and pandoc.List())
    assert(context.operation==request.context.operation and context.captureWitness==request.context.captureWitness and context.input==request.context.input and context.projection==request.context.projection and pandoc.json.encode(context.profiles)==pandoc.json.encode(expected_profiles),'DOCUMENT_BINDING: чужой late request')
    local output=request.capture..'.late.json'
    local exists=io.open(output,'rb');if exists then exists:close();error('DOCUMENT_BINDING: late sidecar уже существует') end
    local writer=assert(io.open(output,'wb'))
    ---@type {context:CourseNativeContext,occurrences:CourseLateOccurrences,assignment?:{introductions:CourseLateIntroductions}}
    local late={context=context,occurrences=occurrences}
    if request.assignment then
      assert(context.captureWitness, "DOCUMENT_BINDING: отсутствует assignment capture witness")
      for _,intro in ipairs(introductions) do
        ---@type string|nil
        local matched
        for _,selected in ipairs(request.assignment.assessments) do
          if selected.source==request.assignment.source and intro.key==context.operation..':'..context.captureWitness..':assessment:'..selected.id then matched=selected.id end
        end
        assert(matched,'BODY.ASSESSMENT_OCCURRENCE_MISMATCH: foreign introduction');intro.id=matched
      end
      late.assignment={introductions=introductions}
    else assert(#introductions==0,'BODY.ASSESSMENT_OCCURRENCE_MISMATCH: unexpected introduction') end
    writer:write(pandoc.json.encode(late));writer:close()
    ---@type pandoc.Pandoc|nil
    local cleaned
    if not os.getenv('COURSE_CORE_TS_RUN') then
      -- Writer observation: post связывает её с текущими перемещёнными outputs.
      local output=quarto.doc.output_file
      cleaned=clean_document(doc)
      local body=blocks(cleaned)
      local native=assert(io.open(request.capture..'.native.json','wb'))
      local observedDoc=pandoc.Pandoc(doc.blocks,{course={view=pandoc.MetaString(context.projection=='author' and 'full' or 'student')}})
      ---@type {facts:fun(raw:pandoc.Pandoc,public:pandoc.Pandoc,canonical?:{id:string,project?:string}[]):CourseResourceObservation}
      local resources=dofile(pandoc.path.join({dir,'../native-resources.lua'}))
      local observation=resources.facts(observedDoc,observedDoc,{})
      -- Virtual native sources have bytes in Pandoc's bag, not an authored file.
      -- Store only exact observed entries in this capture; never infer *_files paths.
      assert(#observation.capturedFiles<=4096,'RESOURCE_LIMIT: too many native resources')
      for index,resource in ipairs(observation.capturedFiles) do
        if resource._bytes then
          assert(#resource._bytes<=128*1024*1024,'RESOURCE_LIMIT: mediabag entry too large')
          local media_path=request.capture..'.media-'..tostring(index)
          local previous=io.open(media_path,'rb');assert(not previous,'DOCUMENT_BINDING: media sidecar already exists')
          local media=assert(io.open(media_path,'wb'));media:write(resource._bytes);media:close()
          resource._bytes=nil;resource.media=index
        end
      end
      ---@type {output:string,body:CourseJsonValue[],role:string,resources:CourseObservedResourceList,assignmentDeclarations?:CourseJsonList}
      local data={output=output,body=body,role=pandoc.utils.stringify(doc.meta['course-core-role'] or 'page'),resources=observation.capturedFiles}
      if request.assignment then
        -- Только фактические data/resource declarations Quarto, не журнал модулей.
        local path=os.getenv('QUARTO_FILTER_DEPENDENCY_FILE')
        assert(path,'BODY.PRODUCER_DEPENDENCY_UNQUALIFIED: missing declaration file')
        local file=assert(io.open(path,'rb'));local text=file:read('*a');file:close()
        assert(#text<=16*1024*1024,'BODY.PRODUCER_DEPENDENCY_UNQUALIFIED: declaration limit')
        local declarations=pandoc.List()
        ---@cast declarations CourseJsonList
        data.assignmentDeclarations=declarations
        ---@type fun():string?
        local lines=text:gmatch('[^\r\n]+')
        for line in lines do
          assert(#declarations<16384,'BODY.PRODUCER_DEPENDENCY_UNQUALIFIED: declaration count')
          declarations:insert(pandoc.json.decode(line,false))
        end
      end
      native:write(pandoc.json.encode(data));native:close()
    end
    doc.meta['course-core-ts-binding']=nil
    doc.meta['course-core-processed']=nil
    if not cleaned then return clean_document(doc) end
    cleaned.meta['course-core-ts-binding']=nil
    cleaned.meta['course-core-processed']=nil
    return cleaned
  end
}}
