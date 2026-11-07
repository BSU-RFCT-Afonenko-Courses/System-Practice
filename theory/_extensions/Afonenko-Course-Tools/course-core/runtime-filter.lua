-- Только native техническая передача раннему TS-канону.
local dir=pandoc.path.directory(debug.getinfo(1,'S').source:gsub('^@',''))
---@type {Pandoc:fun(doc:pandoc.Pandoc):pandoc.Pandoc}[]
local filters=dofile(pandoc.path.join({dir,'native-ts/early-context.lua'}))
return filters
