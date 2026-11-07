-- Только actual native args/carrier; syntax и resource semantics принадлежат TS.
local dir=pandoc.path.directory(debug.getinfo(1,'S').source:gsub('^@',''))
---@type DownloadTransport
local transport=dofile(pandoc.path.join({dir,'request-transport.lua'}))
return {['project-download']=
---@param args pandoc.Inlines[]
---@param kwargs {[string]: pandoc.Inlines}
function(args,kwargs)
 ---@type DownloadArgumentList
 local positional=pandoc.List() --[[@as DownloadArgumentList]]
 ---@type DownloadNamedArgumentList
 local named=pandoc.List() --[[@as DownloadNamedArgumentList]]
 for _,value in ipairs(args) do positional:insert(pandoc.utils.stringify(value)) end
 for key,value in pairs(kwargs) do named:insert({key=key,value=pandoc.utils.stringify(value)}) end
 table.sort(named,function(a,b)return a.key<b.key end)
 local ordinal=transport.record({positional=positional,named=named})
 local text=kwargs.text and pandoc.utils.stringify(kwargs.text) or ''
 return pandoc.Span({pandoc.Str(text)},pandoc.Attr('',{'project-download-raw-request'},{['data-project-download-ordinal']=tostring(ordinal)}))
end}
