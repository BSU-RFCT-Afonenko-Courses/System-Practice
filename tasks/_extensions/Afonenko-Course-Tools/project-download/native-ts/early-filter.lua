-- Ранняя owner-фаза: reserved Attr и начало buffer; shortcode исполняет Quarto.
local dir=pandoc.path.directory(debug.getinfo(1,'S').source:gsub('^@',''))
local metrics=dofile(pandoc.path.join({pandoc.path.directory(dir),'observability/bridge.lua'})).create_metrics('project-download',1)
local walk=metrics.wrap_walk({id='project-download.early.walk',kind='ast_walk',scope='full-document'},function(node,filter)return node:walk(filter)end)
local transport=dofile(pandoc.path.join({pandoc.path.directory(dir),'request-transport.lua'}))
local reserved={['project-download-request']=true,['project-download-raw-request']=true}
local fields={['project-download-native-batch']=true,['project-download-native-result']=true,['data-project-download-ordinal']=true,['data-project-download-in-callout']=true}
local function fail()assert(false,'DOWNLOAD.DELIVERY_PHASE_UNSUPPORTED: Авторский reserved Download transport')end
return {{Pandoc=function(doc)
 local context=transport.context();transport.begin(context.key)
 local function metadata(value)
  if type(value)~='table' then return end
  for key,child in pairs(value) do if fields[key] then fail() end;metadata(child) end
 end
 metadata(doc.meta)
 local function attribute(node)
  if node.classes then for _,c in ipairs(node.classes) do if reserved[c] then fail() end end end
  if node.attributes then for key in pairs(node.attributes) do if fields[key] then fail() end end end
 end
 local filters={Span=attribute}
 for _,name in ipairs({'Div','Code','CodeBlock','Header','Link','Image','Figure','Table','TableHead','TableBody','TableFoot','Row','Cell'}) do filters[name]=attribute end
 walk(doc,filters)
 return doc
end}}
