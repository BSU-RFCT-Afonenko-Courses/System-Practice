local __metrics=require("./observability/bridge").create_metrics("course-core",1)
---@class CourseStringList: pandoc.List
---@field [integer] string
---@class CourseObservedResource
---@field source string
---@field output string
---@field _bytes? string
---@field media? integer
---@class CourseObservedResourceList: pandoc.List
---@field [integer] CourseObservedResource
---@class CourseResourceObservation
---@field source string
---@field format string
---@field view? string
---@field rawProjectRoots CourseStringList
---@field effectiveBase string
---@field outputDirectory string
---@field outputFile string
---@field rawUses CourseStringList
---@field projectedUses CourseStringList
---@field capturedFiles CourseObservedResourceList
---@param node pandoc.Pandoc
---@param filter table<string,function>
---@return pandoc.Pandoc
local function walk(node,filter) return node:walk(filter) end
local __perfWalk1=__metrics.wrap_walk({id="course-core.native-resources.walk.1",kind='ast_walk',scope="full-document"},walk)
local diagnostics = require("./diagnostics")
local M={}
---@param doc pandoc.Pandoc
---@return CourseStringList
function M.uses(doc)
  local result=pandoc.List()
  ---@cast result CourseStringList
  ---@type table<string,boolean>
  local seen={}
  ---@param target string
  local function add(target)
    if not target:match('^[%a][%w+.-]*:') and not target:match('^//') and target:sub(1,1)~='#' then
      target=target:gsub('[?#].*$','')
      if target~='' and not seen[target] then result:insert(target);seen[target]=true end
    end
  end
  __perfWalk1(doc,{
    Image=---@param image pandoc.Image
    function(image) add(image.src) end,
    Link=---@param link pandoc.Link
    function(link) add(link.target) end,
  });return result
end
-- Служебный cache не является предметным ресурсом даже при прямой ссылке.
---@param root string
---@param source string
---@return boolean
local function tool_cache(root,source)
  local name=pandoc.path.make_relative(source,root):gsub('\\','/')
  if name=='..' or name:match('^%.%./') or pandoc.path.is_absolute(name) then return false end
  if ('/'..name..'/'):find('/.cache/codex-tools/',1,true) then return true end
  local configured=os.getenv('XDG_CACHE_HOME')
  if not configured or not pandoc.path.is_absolute(configured) then return false end
  configured=pandoc.path.normalize(configured)
  local local_cache=pandoc.path.make_relative(configured,root)
  if local_cache=='.' or local_cache=='..' or local_cache:match('^%.%./') or pandoc.path.is_absolute(local_cache) then return false end
  return source==configured or source:sub(1,#configured+1)==configured..'/'
end
---@param raw pandoc.Pandoc
---@param public pandoc.Pandoc
---@param canonical? {id:string,project?:string}[]
---@return CourseResourceObservation
function M.facts(raw,public,canonical)
  local root=assert(quarto.project.directory)
  local rawProjectRoots=pandoc.List()
  ---@cast rawProjectRoots CourseStringList
  ---@type table<string,boolean>
  local seenProjects={}
  -- Reuse pre-projection validation facts; retain paths only, never private bodies.
  for _,fact in ipairs(canonical or {}) do
    if fact.project then
      if fact.project:sub(1,1)~='/' or fact.project:sub(1,2)=='//' then diagnostics.fail('RESOURCE.PROJECT_PATH_INVALID','Путь проекта должен начинаться с /: '..fact.project,{id=fact.id,field='project'}) end
      local path=pandoc.path.normalize(pandoc.path.join({root,fact.project:sub(2)}))
      if not seenProjects[path] then rawProjectRoots:insert(path);seenProjects[path]=true end
    end
  end
  local input=quarto.doc.input_file;if pandoc.path.is_relative(input) then input=pandoc.path.join({root,input}) end
  local outputRoot=quarto.project.output_directory or root;if pandoc.path.is_relative(outputRoot) then outputRoot=pandoc.path.join({root,outputRoot}) end
  local rawUses=M.uses(raw)
  local projectedUses=rawUses
  if not rawequal(raw,public) then projectedUses=M.uses(public) end
  local capturedFiles=pandoc.List()
  ---@cast capturedFiles CourseObservedResourceList
  ---@type table<string,boolean>
  local publicUses={};for _,uri in ipairs(projectedUses) do publicUses[uri]=true end
  ---@type string|nil
  local view
  local course=raw.meta.course
  if course then
    assert(type(course)=='table','CORE.METADATA_INVALID: course требует карту')
    for key in pairs(course) do assert(type(key)=='string','CORE.METADATA_INVALID: course требует карту') end
    ---@cast course pandoc.MetaMap
    view=course.view and pandoc.utils.stringify(course.view) or nil
  end
  local generatedPrefix=input:gsub('%.[^./]+$','')..'_files/'
  -- Наблюдаем пути до переноса generated файлов native writer в outputRoot.
  for _,uri in ipairs(rawUses) do
    local decoded=uri:gsub('%%(%x%x)',function(h) return string.char(assert(tonumber(h,16))) end)
    local source=decoded:sub(1,1)=='/' and pandoc.path.join({root,decoded:sub(2)}) or pandoc.path.join({pandoc.path.directory(input),decoded})
    source=pandoc.path.normalize(source)
    local _,media=pandoc.mediabag.lookup(decoded)
    local file=not tool_cache(root,source) and io.open(source,'rb')
    if file or (media and not tool_cache(root,source)) then
      ---@type CourseObservedResource
      local observed={source=source,output=pandoc.path.join({outputRoot,pandoc.path.make_relative(source,root)})}
      -- PDF читает generated figures до native relocation.
      if media then observed._bytes=media end
      if file and not media and FORMAT=='latex' and source:sub(1,#generatedPrefix)==generatedPrefix and (view=='full' or publicUses[uri]) then observed._bytes=file:read('*a') end
      if file then file:close() end
      capturedFiles:insert(observed)
    end
  end
  return {source=pandoc.path.make_relative(input,root),format=FORMAT,view=view,
    rawProjectRoots=rawProjectRoots,effectiveBase=pandoc.path.directory(input),outputDirectory=outputRoot,outputFile=quarto.doc.output_file,rawUses=rawUses,projectedUses=projectedUses,capturedFiles=capturedFiles}
end
M.uses=__metrics.wrap_sync({id="course-core.native-resources.uses",kind='phase'},M.uses)
M.facts=__metrics.wrap_sync({id="course-core.native-resources.facts",kind='phase'},M.facts)
return M
