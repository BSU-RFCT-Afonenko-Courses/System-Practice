-- Постоянные выходы Reveal используют авторскую конфигурацию native проекта.
local metrics=require('./observability/bridge').create_metrics('course-navigation',1)
---@param value? pandoc.MetaValue
---@return string|nil
local function text(value) return value and pandoc.utils.stringify(value) or nil end
---@param field string
---@param detail string
local function fail(field,detail)
 assert(false,'NAVIGATION.CONFIG_INVALID: '..detail..'; источник='..quarto.doc.input_file..'; поле='..field)
end
---@param value string
---@param field string
---@return string
local function public_url(value,field)
 if not value:match('^https?://[^/]+') then fail(field,'Требуется публичный HTTP(S) URL') end
 return value
end
---@param value string
---@param field string
---@return string
local function local_path(value,field)
 if value:match('^[\\/]') or value:match('^[%a][%w+.-]*:') or value:find('\\',1,true) then fail(field,'Требуется относительный публичный путь') end
 for part in value:gmatch('[^/]+') do if part=='..' or part=='.' then fail(field,'Путь не должен выходить за корень публикации') end end
 return value
end
---@param value? pandoc.MetaValue
---@return pandoc.MetaMap
local function map(value)
 value=value or {}
 assert(type(value)=='table','NAVIGATION.CONFIG_INVALID: нужен словарь metadata')
 for key in pairs(value) do assert(type(key)=='string','NAVIGATION.CONFIG_INVALID: нужен словарь metadata') end
 ---@cast value pandoc.MetaMap
 return value
end
---@class CourseNavigationLink
---@field text string
---@field href string
---@field scope string
---@field path? string
---@class CourseNavigationLinks: pandoc.List
---@field [integer] CourseNavigationLink
---@param doc pandoc.Pandoc
---@return pandoc.Pandoc
local function transform(doc)
 local cfg=map(doc.meta['course-navigation'])
 if not quarto.format.is_format('revealjs') then
  if quarto.format.is_format('html') and cfg.enabled==true then
   quarto.doc.add_html_dependency({name='course-navigation-header',stylesheets={'html/header.css'}})
  end
  return doc
 end
 local input=quarto.doc.input_file
 if not pandoc.path.is_relative(input) then input=pandoc.path.make_relative(input,assert(quarto.project.directory)) end
 input=input:gsub('\\','/')
 local dir=pandoc.path.directory(input)
 local offset=''
 if dir~='.' then for _ in dir:gmatch('[^/]+') do offset=offset..'../' end end
 local links=pandoc.List()
 ---@cast links CourseNavigationLinks
 local courseUrl=text(cfg['course-url'])
 if courseUrl then courseUrl=public_url(courseUrl,'course-navigation.course-url'):gsub('/+$','')..'/' end
 local configuredLinks=cfg.links or {}
 assert(type(configuredLinks)=='table','NAVIGATION.CONFIG_INVALID: нужен список ссылок')
 ---@cast configuredLinks table<string|integer,pandoc.MetaValue>
 for key in pairs(configuredLinks) do assert(type(key)=='number' and key>=1 and key%1==0,'NAVIGATION.CONFIG_INVALID: нужен список ссылок') end
 ---@cast configuredLinks pandoc.MetaValue[]
 for _,rawLink in ipairs(configuredLinks) do
  local link=map(rawLink)
  local href,label,scope=text(link.href),text(link.text),text(link.scope) or 'project'
  if not href or not label or label=='' then fail('course-navigation.links','Укажите href и text для каждой ссылки') end
  if scope~='project' and scope~='course' then fail('course-navigation.links.scope','Допустимы project и course') end
  href=assert(href);label=assert(label)
 if not href:match('^/[^/]') then fail('course-navigation.links.href','Укажите URL-путь от корня области, например /index.html') end
  href=local_path(href:sub(2),'course-navigation.links.href')
  if scope=='course' and not courseUrl then fail('course-navigation.course-url','Для выхода к курсу укажите адрес самостоятельной публикации') end
  links:insert({text=label,href=scope=='course' and assert(courseUrl)..href or offset..href,scope=scope,path=href})
 end
 -- HTML остаётся у штатных repo-actions; эквивалент добавляется только в Reveal.
 local repository=map(doc.meta.book or doc.meta.website or doc.meta)
 ---@param key string
 ---@return string|nil
 local function repo(key) return text(repository[key] or doc.meta[key]) end
 local repoUrl=repo('repo-url')
 local actions=repository['repo-actions'] or doc.meta['repo-actions'] or {}
 if pandoc.utils.type(actions)=='Inlines' then actions={actions} end
 assert(type(actions)=='table','NAVIGATION.CONFIG_INVALID: нужен список repo-actions')
 ---@cast actions pandoc.MetaValue[]
 ---@type table<string,boolean>
 local requested={}
 for _,action in ipairs(actions) do local name=text(action);if name then requested[name]=true end end
 local issue=repo('issue-url')
 if issue then requested.issue=true end
 if repoUrl then
  repoUrl=public_url(repoUrl,'repo-url'):gsub('/+$','')..'/'
  local subdir=repo('repo-subdir') or ''
  if subdir~='' then subdir=local_path(subdir:gsub('/+$',''),'repo-subdir')..'/' end
  local branch=repo('repo-branch') or 'main'
  local_path(branch,'repo-branch')
  if requested.source then links:insert({text='Исходный код',href=repoUrl..'blob/'..branch..'/'..subdir..input,scope='repository'}) end
  if requested.issue and not issue then issue=repoUrl..'issues/new' end
 end
 if issue and requested.issue then links:insert({text='Сообщить об ошибке',href=public_url(issue,'issue-url'),scope='repository'}) end
 if #links>0 then
  local payload=pandoc.json.encode({links=links}):gsub('<','\\u003c')
  quarto.doc.include_text('in-header','<script id="course-navigation-context" type="application/json">'..payload..'</script>')
 end
 return doc
end
---@param doc pandoc.Pandoc
---@return pandoc.Pandoc
local function handler(doc)
 return metrics.wrap_sync({id='course-navigation.filter.handler.Pandoc',kind='phase',document_id=quarto.doc.input_file},transform)(doc)
end
return {{Pandoc=(os.getenv('COURSE_PERF_MODE') and os.getenv('COURSE_PERF_MODE')~='off') and handler or transform}}
