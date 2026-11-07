local __metrics=require("./observability/bridge").create_metrics("course-navigation",1)

-- Native post-render resolves this request from completed canonical Core facts.
---@param args pandoc.List
---@param kwargs table<string,pandoc.Inlines>
---@param meta pandoc.Meta
---@return pandoc.RawBlock
local function index(args,kwargs,meta)
 if #args>0 then error('course-exercise-index requires named parameters') end
 for key,_ in pairs(kwargs) do if key~='role' and key~='group-by' then error('Unknown course-exercise-index parameter: '..key) end end
 ---@type {groupBy:string[],role?:string}
 local request={groupBy={'semester','difficulty'}}
 if rawget(kwargs,'role')~=nil then
  request.role=pandoc.utils.stringify(kwargs.role)
  if not ({demonstration=true,discussion=true,['independent-study']=true,control=true})[request.role] then error('Unknown course-exercise-index role') end
 end
 if rawget(kwargs,'group-by')~=nil then
  local raw=pandoc.utils.stringify(kwargs['group-by'])
  ---@type table<string,boolean>
  local seen={}
  request.groupBy={}
  for item in (raw..','):gmatch('(.-),') do
   ---@cast item string
   item=item:gsub('^%s+',''):gsub('%s+$','')
   if (item~='semester' and item~='difficulty') or seen[item] then error('Invalid course-exercise-index group-by') end
   seen[item]=true;table.insert(request.groupBy,item)
  end
 end
 return pandoc.RawBlock('html','<!--course-exercise-index:'..pandoc.json.encode(request)..'-->')
end
---@param args pandoc.List
---@param kwargs table<string,pandoc.Inlines>
---@param meta pandoc.Meta
---@return pandoc.RawBlock
local function handler(args,kwargs,meta)
 return __metrics.wrap_sync({id="course-navigation.shortcodes.handler.course-exercise-index",kind='function',document_id=quarto.doc.input_file},index)(args,kwargs,meta)
end
local mode=os.getenv('COURSE_PERF_MODE')
return {['course-exercise-index']=mode and mode~='off' and handler or index}
