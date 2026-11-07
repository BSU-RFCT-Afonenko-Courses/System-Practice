-- Extended native AST остаётся в Lua. В TS передаётся только один малый batch.
local dir=pandoc.path.directory(debug.getinfo(1,'S').source:gsub('^@',''))
---@type DownloadTransport
local transport=dofile(pandoc.path.join({dir,'request-transport.lua'}))
local metrics=require('./observability/bridge').create_metrics('project-download',1)
local walk=metrics.wrap_walk({id='project-download.filter.walk',kind='ast_walk',scope='full-document'},
---@param node pandoc.Pandoc
---@param filter DownloadFilter|DownloadAttributeFilter
function(node,filter)return (node.walk --[[@as DownloadDocumentWalk]])(node,filter)end)
---@param message string
local function fail(message)assert(false,'DOWNLOAD.REQUEST_INVALID: '..message..'\nфайл: '..tostring(quarto.doc.input_file or ''))end
---@param value pandoc.MetaValue|nil
---@return DownloadJson
local function plain(value)
 if type(value)=='boolean' or type(value)=='number' or type(value)=='string' then return value end
 local kind=pandoc.utils.type(value)
 if kind=='Inlines' or kind=='MetaInlines' or kind=='Blocks' or kind=='MetaBlocks' then return pandoc.utils.stringify(value) end
 ---@type DownloadJsonTable
 local result={};for key,child in pairs(value or {}) do result[key]=plain(child) end;return result
end
---@param span pandoc.Inline
---@return boolean
local function isRequest(span)
 return span.t=='Span' and (span --[[@as pandoc.Span]]).classes:includes('project-download-raw-request')
end
-- Quarto уже распознал авторские callout; метка живёт только до замены carrier на Link.
local inCallout='data-project-download-in-callout'
return {{Callout=
---@param node DownloadCallout
function(node)
 local mark={Span=function(span)
  if isRequest(span) then
   ---@type string
   span.attributes[inCallout]='true';return span
  end
 end}
 node.content=node.content:walk(mark) --[[@as pandoc.Blocks]]
 if node.title then node.title=node.title:walk(mark) --[[@as pandoc.Inlines]]
 end
 return node
end},{Pandoc=function(doc)
 local context=transport.context();local calls=transport.drain(context.key)
 local root=quarto.project.directory
 ---@type {[string]: DownloadJson}
 local exercises={}
 ---@type DownloadInvocationList
 local requests=pandoc.List() --[[@as DownloadInvocationList]]
 doc=walk(doc,{Div=function(div)if div.identifier~='' then exercises[div.identifier]=plain(div.attributes) end end,
 Span=function(span)
  if isRequest(span) then
   local raw=span.attributes['data-project-download-ordinal'];local ordinal=tonumber(raw)
   if not ordinal or ordinal%1~=0 or ordinal<0 or tostring(ordinal)~=raw or not calls[ordinal+1] or calls[ordinal+1].inline then fail('Чужой или повторный native ordinal') end
   local call=calls[ordinal+1];call.inline=true;requests:insert(call)
  end
 end})
 local visibleCount=#requests
 for _,call in ipairs(calls) do if not call.inline then requests:insert(call) end end
 local native=pandoc.utils.stringify(doc.meta['course-core-runtime'] or '')=='native-ts'
 local processed=doc.meta['course-core-processed']==true
 local configuration=plain(doc.meta['project-download'])
 ---@type DownloadStoredRequest
 local request={source=context.source,resources=pandoc.List(),configuration=configuration,native=native}
 if processed then request.courseProcessed=true end
 ---@type {[number]: DownloadResolvedLink|nil}
 local decisions={}
 if #requests>0 then
  local batch={source=context.source,native=native,courseProcessed=processed,configuration=configuration,exercises=exercises,artifactContext=plain(doc.meta['course-artifact-context']),requests=requests}
  if doc.meta['project-download']==nil then batch.configuration=nil end
  local course=doc.meta.course --[[@as {view?: pandoc.MetaValue}|nil]]
  if course and course.view then batch.view=pandoc.utils.stringify(course.view) end
  local carrier=pandoc.Pandoc({}, {['project-download-native-batch']=pandoc.MetaString(pandoc.json.encode(batch))})
  ---@type DownloadJsonFilter
  local runJsonFilter=pandoc.utils.run_json_filter
  local result=runJsonFilter(carrier,pandoc.path.join({dir,'native-ts/late-filter.sh'}),{FORMAT})
  local encoded=result.meta['project-download-native-result']
  if not encoded then fail('Отсутствует native Download result') end
  -- Собственный TS producer возвращает объект; поля ещё не считаются проверенными.
  local resolved=pandoc.json.decode(pandoc.utils.stringify(encoded)) --[[@as DownloadResultCandidate]]
  if resolved.source~=context.source or type(resolved.links)~='table' or type(resolved.request)~='table' or (resolved.request --[[@as {source: unknown}]]).source~=context.source or #resolved.links~=visibleCount then fail('Чужой или неполный Download result') end
  for _,link in ipairs(resolved.links --[[@as DownloadLinkCandidate[] ]]) do
   if type(link.ordinal)~='number' or decisions[link.ordinal] or type(link.href)~='string' or type(link.text)~='string' then fail('Повреждённый Download result ordinal') end
   ---@cast link DownloadResolvedLink
   decisions[link.ordinal]=link
  end
  for i=1,visibleCount do if not decisions[requests[i].ordinal] then fail('Пропущен Download result ordinal') end end
  request=resolved.request --[[@as DownloadStoredRequest]]
  ---@param span pandoc.Span
  ---@return pandoc.Link|nil
  local function replace(span)
   if not isRequest(span) then return end
   -- Ранний проход того же документа уже проверил canonical ordinal carrier.
   local ordinal=tonumber(span.attributes['data-project-download-ordinal'])
   ---@cast ordinal integer
   local link=decisions[ordinal]
   if not link then fail('Нет решения для native request') end
   ---@cast link DownloadResolvedLink
   decisions[ordinal]=nil
   return pandoc.Link({pandoc.Str(link.text)},link.href,'',pandoc.Attr('',{'project-download'},{download=''}))
  end
  ---@param block pandoc.Para|pandoc.Plain
  ---@return pandoc.RawInline|nil, boolean|nil
  local function standalone(block)
   if not quarto.doc.is_format('html') or #block.content~=1 then return end
   local span=block.content[1] --[[@as pandoc.Inline]]
   if not isRequest(span) or (span --[[@as pandoc.Span]]).attributes[inCallout]=='true' then return end
   ---@cast span pandoc.Span
   local link=replace(span)
   ---@cast link pandoc.Link
   return (quarto.Callout --[[@as DownloadCalloutConstructor]])({type='none',appearance='minimal',attr=pandoc.Attr('',{'project-download'}),content={pandoc.Para({pandoc.Str('⤓'),pandoc.Space(),link})}}),false
  end
  -- Topdown сохраняет inline и даёт обрамить только отдельный Para/Plain carrier.
  doc=walk(doc,{traverse='topdown',Para=standalone,Plain=standalone,Span=replace})
  for _ in pairs(decisions) do fail('Неиспользованный Download result') end
 end
 local source=context.source
 if type(source)~='string' or source=='' or source:find('\\',1,true) or source:match('^/') or source:match('^%a:') or source:find('//',1,true) or source:match('/$') then fail('Неканонический source заявки') end
 for part in source:gmatch('[^/]+') do if part=='.' or part=='..' then fail('Source заявки выходит из проекта') end end
 local directory=root..'/_generated/project-download/requests/'..source;pandoc.system.make_directory(directory,true)
 local file=assert(io.open(directory..'/request.json','w'));file:write(pandoc.json.encode(request));file:close()
 return doc
end}}
