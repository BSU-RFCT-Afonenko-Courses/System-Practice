-- Выбранная композиция использует один канон; legacy остаётся migration gate.
local dir=pandoc.path.directory(debug.getinfo(1,'S').source:gsub('^@',''))
local legacy=dofile(pandoc.path.join({dir,'filter.lua'}))
return {{Pandoc=function(doc)
  if pandoc.utils.stringify(doc.meta['course-core-runtime'] or '')=='native-ts' then
    local filters=dofile(pandoc.path.join({dir,'native-ts/early-context.lua'}))
    return filters[1].Pandoc(doc)
  end
  for _,filter in ipairs(legacy) do if filter.Pandoc then doc=filter.Pandoc(doc) or doc end end
  return doc
end}}
