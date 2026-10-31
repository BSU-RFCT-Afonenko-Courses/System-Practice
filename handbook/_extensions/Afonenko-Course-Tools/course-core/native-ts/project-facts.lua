-- Reuse the existing Core domain exactly once after the SAME early TS JSON filter.
local M={}
function M.capture(original,request,context)
  if not request.assignment then return end
  local file=assert(io.open(request.capture..'.early.json','rb'))
  local early=pandoc.json.decode(file:read('*a'));file:close()
  assert(early.context.operation==context.operation and early.context.captureWitness==context.captureWitness and early.context.input==context.input and early.context.format==context.format,'DOCUMENT_BINDING: foreign project facts')
  local root=assert(quarto.project.directory)
  local source=pandoc.path.make_relative(context.input,root)
  local facts={}
  for _,item in ipairs(assert(early.release).declarations) do
    if item.project then
      assert(item.project:sub(1,1)=='/' and item.project:sub(1,2)~='//','BODY.PROJECT_FACTS_UNQUALIFIED: relative project parity unsupported')
      local definition=assert(early.definitions[item.id])
      facts[#facts+1]={id=item.id,source=source,project=item.project,projectCheck=item.check,banked=context.exerciseBank,purpose=definition['course-role'],statementVisibility=definition['statement-visibility']}
    end
  end
  local dir=pandoc.path.directory(debug.getinfo(1,'S').source:gsub('^@',''))
  local projects=dofile(pandoc.path.join({dir,'../projects.lua'}))
  local materializations=projects.materialization(original.meta) or {}
  local normalized=projects.collect(original,facts,materializations)
  local path=request.capture..'.project-facts.json'
  local exists=io.open(path,'rb');if exists then exists:close();error('DOCUMENT_BINDING: duplicate project facts producer') end
  local out=assert(io.open(path,'wb'));out:write(pandoc.json.encode({schema='course-native-project-facts-v1',context=context,source=source,projects=normalized,projectMaterializations=materializations,collectCalls=1}));out:close()
end
return M
