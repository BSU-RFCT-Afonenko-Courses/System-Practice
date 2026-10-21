# Происхождение технической поставки System Practice

## Актуальная поставка расширений8.0.0/8.0.0/3.2.0

Три согласованных расширения установлены из фактических опубликованных
immutable Releases. Теги, exact commits и sourceZip закреплены в
`providers.json`; области установки и хеши генерирует штатный
`tools/materialize-providers.py`. Активные candidate blocks не используются.

| Владелец | Выпуск | Коммит |
| --- | --- | --- |
| Afonenko-Course-Tools/quarto-course | v8.0.0 | `5ee77e0e64d24c03ff6f3d384a890d69aa13f267` |
| Afonenko-Course-Tools/quarto-project-publish | v5.1.0 | `62f8c4a01a5fd9af11f5f66abba2bb48c2ef2631` |
| Afonenko-Course-Tools/quarto-reference-catalog | v3.1.0 | `3df2110e9f525f03f3ecb4926b5d55718e955c4c` |
| Afonenko-Course-Tools/quarto-course-prairielearn | v8.0.0 | `66f5401d20febf9dea3c873373186c64c781039d` |
| Afonenko-Course-Tools/quarto-project-download | v3.2.0 | `2dd97d8ce28c4ad514e869fe86d25dbc19f79def` |

Site и QRC сохраняют прежние версии и байты этого курса. Все пакеты
восстанавливаются существующей командой, без локального изменения реализации:

```sh
python3 tools/materialize-providers.py --providers-root /absolute/release-checkouts --write
python3 tools/materialize-providers.py --check
```

Core/Presentation/Navigation сохраняют18 областей. Exporter и Download
добавлены только в `tasks`; установка файлов сама по себе не меняет
filters или конфигурацию курса. Site5.1.0 и QRC3.1.0 не обновляются.

Exporter8 использует delivery v3 с Core8; прежний delivery v2 reader
не объявляется совместимым. Body package остаётся v2. Эти опубликованные
расширения не обновляют Platform/Gateway, сервисные OCI pins или production.
Готовность учебных исходников, capture, архивов, экспорта, импорта и
студенческого/преподавательского интерфейса подтверждается отдельно.

## История прежней статической поставки

Следующие сведения относятся к прежнему выпуску и его фактическим проверкам.
Они сохранены как история и не описывают новую готовность курса.

Техническая статическая поставка от 17 октября 2026 года сохраняет учебные
исходники принятого `b4ba287aa83213013a94e0add3bb6c5dcf068029`.
Core candidate `c8b2fe868cf805301fb6ebeba6587f8c96197369` заменён настоящим
опубликованным Core v7.2.0: `aebf6f4580c0bd5e9468498e840221619fc69e5f`.
[Source release](https://github.com/Afonenko-Course-Tools/quarto-course/releases/tag/v7.2.0)
подтверждён отдельно от локальной materialization. Три Core descriptor имеют
версию 7.2.0; остальные vendored bytes совпадают с принятым candidate.

`providers.json` задаёт точные published repository/tag/version/commit/sourceZip.
`installed-packages.json` получен штатным материализатором из Git archive
точных release commits и содержит фактические package bytes и scopes.
Активного Core candidate и его patch больше нет. Прежний local-api patch
сохраняется как исторический файл и не применяется материализатором.

| Пакеты | Опубликованный источник |
| --- | --- |
| Core, Presentation, Navigation | quarto-course v7.2.0 / `aebf6f4580c0bd5e9468498e840221619fc69e5f` |
| Course Site | quarto-project-publish v5.1.0 / `62f8c4a01a5fd9af11f5f66abba2bb48c2ef2631` |
| QRC | quarto-reference-catalog v3.1.0 / `3df2110e9f525f03f3ecb4926b5d55718e955c4c` |

## Проверка и воспроизведение

Offline проверка не меняет установленные пакеты:

```sh
python3 tools/materialize-providers.py --check
```

Для воспроизведения подготовьте release repositories с именами `checkout`
из `providers.json`, затем выполните:

```sh
python3 tools/materialize-providers.py --providers-root /absolute/release-checkouts --write
python3 tools/materialize-providers.py --check
quarto render --profile student
```

Материализатор проверяет tag → exact SHA, descriptor version и весь inventory
до первой записи. Неизвестная локальная правка, extra file или symlink
останавливает поставку. Данные берутся из Git archive, working-tree правки
владельца не используются. Повторный запуск сохраняет bytes/inventory.

Core/Presentation/Navigation/QRC доступны в корне и во всех пяти native
частях; Course Site — в корне. Сохраняются штатные hooks, Presentation notes,
Navigation plugin и все namespaces. Библиографические источники, учебные QMD,
условия и архивы материалов сохранены побайтно.

Поставка включает только свежий student static render и публичные ZIP.
System продолжает использовать manual ZIP и очную приёмку. Экспортёр,
Hub/questions/grader, новый runtime и новые обязанности студента не добавлены.
По текущему указанию пользователя новая содержательная, визуальная и
native/manual интеграция System и её проверка пропущены. Render, source pins
и файловая целостность подтверждают подготовку публикуемых bytes;
новую предметную или Moodle приёмку они не устанавливают.
Внешние URL, Moodle ссылки и настройки не изменялись. Исторические сведения
о первой поставке сохранены в [истории](docs/provider-history/UPSTREAM-before-20261016.md).
