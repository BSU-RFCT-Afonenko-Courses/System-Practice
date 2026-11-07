-- Техническая метка custom node переживает штатный native renderer.
---@class CourseCustomExercise
---@field div pandoc.Div
---@field name? pandoc.Inlines|string
---@class CourseConditionalBlock
---@field node pandoc.Div
---@type string
local occurrence='data-course-core-occurrence'
---@param node CourseCustomExercise
---@param kind string
---@param container pandoc.Div
---@return CourseCustomExercise
local function mark(node,kind,container)
  local key=node.div.attributes[occurrence]
  if key then
    node.div.attributes['data-course-core-native-kind']=kind
    if kind=='Theorem' and node.name then
      local name=quarto.utils.as_inlines(node.name)
      if name and #name>0 then node.name=pandoc.Inlines({pandoc.Span(name,pandoc.Attr('',{}, {['data-course-core-native-title']=key}))}) end
    end
    -- Нативная custom оболочка связывает собственный payload с ConditionalBlock.
    assert(container and container.attributes,'DOCUMENT_BINDING: нет native custom container')
    container.attributes[occurrence]=key
  end
  return node
end
return {{
  Theorem=
  ---@param node CourseCustomExercise
  ---@param container pandoc.Div
  function(node,container) return mark(node,'Theorem',container) end,
  Proof=
  ---@param node CourseCustomExercise
  ---@param container pandoc.Div
  function(node,container) return mark(node,'Proof',container) end,
  ConditionalBlock=
  ---@param node CourseConditionalBlock
  function(node)
    local attributes=node.node.attributes
    if attributes and attributes[occurrence] then
      -- ConditionalBlock снимает свой Div. Немаркированная оболочка позволяет
      -- ему снять только её, сохранив собственный occurrence payload внутри.
      -- Видимость по-прежнему вычисляет renderer Quarto; hidden удаляет всё.
      node.node=pandoc.Div({node.node})
    end
    return node
  end
}}
