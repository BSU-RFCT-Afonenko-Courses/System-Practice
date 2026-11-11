# Установка общих расширений

Установленные расширения в `_extensions` хранятся в Git. Обычные render и CI
используют эту поставку. Для обновления автор выбирает release и выполняет
штатные команды Quarto из каждого самостоятельного проекта.

Core — полный bundle из Core, Presentation, Navigation и Theme. Установите его и QRC
в корне, `theory`, `lectures`, `practice`, `tasks` и `handbook`:

```sh
quarto add Afonenko-Course-Tools/quarto-course@v9.4.0
quarto add Afonenko-Course-Tools/quarto-reference-catalog@v3.3.0
```

Из корня установите Site:

```sh
quarto add Afonenko-Course-Tools/quarto-project-publish@v6.1.0
```

Из `tasks` установите PrairieLearn и Download:

```sh
quarto add Afonenko-Course-Tools/quarto-course-prairielearn@v9.1.0
quarto add Afonenko-Course-Tools/quarto-project-download@v3.6.0
```

Для следующей выбранной версии повторите `quarto add` с её тегом либо
выполните `quarto update extension Afonenko-Course-Tools/quarto-course@v9.4.0`,
подставив нужный тег, в тех же проектах. Без тега команда выбирает основную
ветку репозитория. Quarto сохраняет namespace `Afonenko-Course-Tools`.
Просмотрите Git diff, проверьте сборку и сохраните полную установленную поставку.
Локальные изменения перед заменой сохраняются обычными средствами Git.

## Исходные зависимости инструментов

Platform и Performance — Git submodules в `.platform` и `.ci/performance`.
Gitlink курса выбирает их commits; URL находятся в `.gitmodules`.
Получите их при clone либо отдельно:

```sh
git clone --recurse-submodules <URL-курса>
# В уже полученном курсе:
git submodule update --init
```

`go-task bootstrap` выполняет ту же стандартную подготовку. Platform используется
через `.platform`; для отдельной разработки можно передать `PLATFORM_ROOT`.
Performance предоставляет подготовку GNU mv с требуемой no-replace capability
для Ubuntu 24.04. На локальной машине используется системный PATH.

Для обновления исходной зависимости выполните обычные Git-команды,
например `git -C .platform fetch origin`, затем `git -C .platform checkout <ref>`.
Проверьте сборку и сохраните изменённый gitlink в коммите курса.
