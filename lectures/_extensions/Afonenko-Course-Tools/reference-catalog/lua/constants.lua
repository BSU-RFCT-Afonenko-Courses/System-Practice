-- Словарь публичных элементов разметки Quarto и представлений ссылок.
-- Таблица не содержит обработчиков; обход и instrumentation ей не требуются.
return {
  target_types = {
    "fig",
    "tbl",
    "lst",
    "eq",
    "sec",
    "thm",
    "lem",
    "cor",
    "prp",
    "cnj",
    "def",
    "exm",
    "exr",
    "sol",
    "rem",
    "alg",
    "nte",
    "tip",
    "wrn",
    "imp",
    "cau",
  },
  probe_styles = { "default", "number" },
  reference_styles = require("./generated/reference-styles"),
}
