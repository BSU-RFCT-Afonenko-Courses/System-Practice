# System Practice

Короткий практикум по терминалу, файлам, потокам, сравнению текстов и Git —
общая подготовка к Java. Выбирается один маршрут: **180 минут** или **360 минут**.
Банк сохраняет 26 согласованных карточек от 10 октября 2026 года:
25 коротких задач и проект SPP-01.

Опубликованный курс: [портал System Practice](https://bsu-rfct-afonenko-courses.github.io/System-Practice/).

Портал ведёт к четырём самостоятельным нативным проектам Quarto:
`theory/`, `tasks/`, `practice/`, `handbook/`. Теория и справочник состоят из
согласованных заголовков и выбранных ссылок. Каждое каноническое условие
хранится в `tasks/_cards/`; тематическая глава включает его штатным `include`
один раз. Страницы занятий используют ссылки QRC на канонические условия.

Структура сверена только с открытыми PR [Java #7](https://github.com/BSU-RFCT-Afonenko-Courses/Java/pull/7)
и [Cybersecurity #4](https://github.com/BSU-RFCT-Afonenko-Courses/Cybersecurity/pull/4)
на точных SHA, записанных в [UPSTREAM.md](UPSTREAM.md).

## Локальная сборка

Требуются Quarto **1.11.5**, CUE **0.17.1** и Task **3.54.0**. В `Taskfile.yml`
закреплены совместимые опубликованные выпуски: Core/Presentation/Navigation
**v5.0.2**, Publisher **v5.0.0**, QRC **v3.0.0**.
Установленные `_extensions/` сохраняются вместе с исходниками курса.

Команды в fish из корня репозитория:

```fish
quarto --version
cue version
task install
task render
task render:full
task preview
```

Эквивалентная нативная сборка без Task:

```fish
quarto render --profile student
or exit $status
quarto render --profile full
or exit $status
quarto preview --profile student --no-watch-inputs
```

Результаты student и full находятся соответственно в `_site-student/`
и `_site-full/`; каждый подпроект имеет отдельные `_output/student/`
и `_output/full/`. Публичный каталог ссылок —
`_site-student/reference-catalog.json`. Частичный локальный просмотр
подпроекта не подтверждает полную сборку курса.

CI повторяет `task install`, `task render` и `task render:full` при push
в `main` и в pull request с теми же версиями инструментов. Публикация сайта
выполняется отдельно.

## Маршруты и замены

Первое занятие: SP01-01–05, **180 минут**. SP01-06 заменяет SP01-02
с сохранением 35 минут. Второе занятие: SP02-01–04, **180 минут**;
SP02-05 заменяет SP02-01 с сохранением 45 минут, но закрепляет amend
вместо restore. Если нужен именно restore, сохраняется SP02-01.

SPP-01 заменяет второе занятие целиком, сохраняя **180 минут**.
Проект и четыре короткие задачи не складываются. Дополнительный пул
двухдневного маршрута — **630 минут**. Для однодневного варианта отдельно
предусмотрен дополнительный маршрут **270 минут**; эти варианты не суммируются.
Время включает чтение, выполнение и самостоятельную проверку, предполагая
подготовленную среду.

## Содержание, среда и оценивание

| Результат | Статус первой версии |
|---|---|
| Содержание курса | Перенесены 26 принятых карточек; теория и справочник содержат заголовки и ссылки |
| Локальная сборка | Student и full собраны: по 21 странице, 26 канонических задач, все ссылки разрешены |
| Репозиторий | Первая версия загружена в `main` [System-Practice](https://github.com/BSU-RFCT-Afonenko-Courses/System-Practice); опубликованные учебные исходники — `11e77159504858e74c51ad54022cceb342ddbe4d` |
| CI первой версии | [Запуск 38087595781](https://github.com/BSU-RFCT-Afonenko-Courses/System-Practice/actions/runs/38087595781) успешно установил пакеты и собрал student/full на этом SHA |
| Публикация сайта | [System Practice](https://bsu-rfct-afonenko-courses.github.io/System-Practice/) опубликован штатно в `gh-pages`; независимо проверены 21 страница, 26 якорей задач, 52 цели QRC и поиск |
| Среда PrairieLearn | Не подготовлена; требуется отдельный образ VS Code с Git, fish и `pwsh` |
| Стартовые файлы и архивы задач | Будущие материалы перечислены в исходных карточках; пакеты ещё не созданы |
| Оценивание | Критерии, решения, тесты и graders ещё не подготовлены |
| Интеграция ссылок в Java | Не выполнялась; проверенные адреса System Practice доступны для отдельной задачи |

Windows использует PowerShell 7, Linux — fish. Установка локального ПО
и подготовка облачного образа выполняются до занятия. Для проверки истории
Git передаётся архив с `.git`; `git archive` сохраняет снимок файлов,
а не историю репозитория. Наличие страниц курса не означает готовность
среды или автоматической проверки сдачи.

## Источники и устойчивые цели

В карточках сохранены происхождение условий, печатная/PDF пагинация,
ссылки, зависимости и обозначения адаптаций. Библиографические сведения
публикуются в `tasks/sources.qmd`. У адаптаций Pro Git сохраняется
CC BY-NC-SA 3.0; курс целиком не объявлен материалом под одной общей лицензией.

Исходный ID `SP01-01` соответствует нативному `tasks:exr-sp01-01`;
`SPP-01` — `tasks:exr-spp-01`. Полная карта исходных карточек, SHA-256,
страниц и якорей находится в [provenance/id-map.json](provenance/id-map.json).
Поле `url` содержит проверенный опубликованный адрес каждой из 26 карточек.
[Публичный каталог целей QRC](https://bsu-rfct-afonenko-courses.github.io/System-Practice/reference-catalog.json)
содержит 52 проверенные цели. Межкурсовые ссылки используют этот каталог
и адрес либо обычную ссылку на проверенную страницу с устойчивым якорем.

## Штатная публикация

GitHub Pages настроен на ветку `gh-pages`. Для повторной публикации:

```fish
task publish
```

Команда выполняет полную сборку student и затем
`quarto publish gh-pages --profile student --no-render`. Успешная локальная
сборка, загрузка исходников, PR, слияние и доступность опубликованного сайта
фиксируются отдельно. Передача исходников не подразумевает слияния PR.

## Пилот текстовой сдачи PrairieLearn

Выбранная работа `tasks/prairielearn-pilot.qmd` включает только SP01-03:
конвейер, запись, дописывание и отдельное перенаправление ошибки. Студент
вводит `commands.fish` в обычный редактор PL; контейнер запускает ответ
на двух наборах HTTP-заголовков. VS Code и PowerShell для этого пилота
не требуются. Остальные 25 карточек и полный маршрут сохраняются.

В репозитории замкнута поставка выбранной работы: каноническое условие,
стартовый ответ, эталон, `checks.py`, входные данные и отрицательные fixtures
находятся в `tasks/projects/streams/`. Проверки и эталон опубликованы вместе
с исходниками. Полный архив нужен автору для разработки или локального
выполнения; в интерфейсе PL отправляется только текст одного файла.

Core/Presentation v5.0.2 используются через штатные adapters/task-items.
Exporter устанавливается **целым пакетом** из проверенного commit
`a28fe17570ff5a9f0e2fb6a04ab73d404d95c09a` репозитория
[Afonenko-Course-Tools/quarto-course-prairielearn](https://github.com/Afonenko-Course-Tools/quarto-course-prairielearn).
Он включает явное разрешение `.fish` для runtime, non-Java descriptor и
атомарное staging при разных filesystem. Это commit с отдельным PR;
не следует объявлять его новым опубликованным выпуском.

В `tasks/_quarto.yml` явно объявлены editor mode, source profile,
`fish-git-v1`, trusted tests, limits и единственная lab работа instance `pilot`.
Внешний runtime собирается из платформенного
`images/fish-git-grader/Dockerfile`: он использует официальный Landlock/sbuser,
ограничивает выполнение и output; правила задания остаются в этом курсе.
Новый fish image пока diagnostic candidate, его published digest не назначен.
Java runtime по-прежнему требует JDK 25; это не требование к ответу fish.

Пример локального экспорта из корня курса (абсолютные пути заменяет оператор):

```sh
quarto run tasks/_extensions/course-prairielearn/entrypoints/export-course.ts -- \
  /absolute/System-Practice /absolute/private/system-native \
  --instance pilot --book tasks \
  --checks-output /absolute/private/system-checks.json \
  --runtime-registry /absolute/prairielearn-platform/runtime-profiles.json \
  --candidate-image sha256:ACTUAL_LOCAL_CONFIG_IMAGE_ID
```

Candidate ID должен быть настоящим результатом `docker image inspect`.
Генерируемые delivery и private receipts не редактируются вручную.
Полная контейнерная проверка охватывает starter, reference, wrong,
syntax failure и timeout. На VM дополнительно проверяются текстовые student
HTTP submissions и невалидный UTF-8; результаты читаются в Moodle через AGS.

Сборки этой ветки student/full содержат по 22 страницы, 26 канонических задач
и 53 цели QRC; прежняя опубликованная версия в таблице выше остаётся отдельным
историческим состоянием. URL выбранных QRC references в native условии
разрешены через проверенный опубликованный каталог: текущий Core Body exporter
не умеет переносить QRC shortcode без resolver. Другие карточки используют
штатный QRC. Новая публикация сайта и слияние этого PR не подразумеваются.
