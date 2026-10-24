# Происхождение технической поставки SystemPractice

## Подготовленная техническая поставка 8.2.4/8.2.4/3.2.0

Core 8.2.4 и Exporter 8.2.4 опубликованы как immutable Releases.
Site 5.1.2, QRC 3.1.0 и Download 3.2.0 сохранены без изменения исходников.
Точные теги, коммиты и sourceZip закреплены в `providers.json`;
области установки и хеши генерирует штатный `tools/materialize-providers.py`.
Активные candidate blocks не используются.

| Владелец | Выпуск | Коммит |
| --- | --- | --- |
| Afonenko-Course-Tools/quarto-course | v8.2.4 | `7d8a472a0fe4f05b5543fb856336a6d15278ef3a` |
| Afonenko-Course-Tools/quarto-project-publish | v5.1.2 | `359e55786ca1d35e98b791a1362193e7bfbbd9b4` |
| Afonenko-Course-Tools/quarto-reference-catalog | v3.1.0 | `3df2110e9f525f03f3ecb4926b5d55718e955c4c` |
| Afonenko-Course-Tools/quarto-course-prairielearn | v8.2.4 | `87bb47cc20cc0cc9f835c2205962f8223da5211f` |
| Afonenko-Course-Tools/quarto-project-download | v3.2.0 | `2dd97d8ce28c4ad514e869fe86d25dbc19f79def` |

Exporter 8.2.4 принимает явные whole conditions ZIP принятой публикации.
Учебные условия, стартеры, эталоны, оценки и остальные providers сохранены.
Существующие области установки не меняются. Исторические capture и
materialization не подтверждают новый source commit; для этой поставки нужны
свежие семь NativeRun-деклараций, observer и student/grading materialization.

Воспроизведение выполняется из проверенных локальных release checkout:

```sh
python3 tools/materialize-providers.py --providers-root /absolute/release-checkouts --write
python3 tools/materialize-providers.py --check
```

Runtime builder и OCI images остаются опубликованной поставкой Platform 2.3.0.
Новый source pin сам по себе не подтверждает CI, capture, экспорт, импорт
или пользовательскую приёмку. Исторические результаты сохранены ниже.

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

Exporter8.2.4 сохраняет учебную Git-историю в неизменном starter ZIP,
но исключает raw `.git` из прямого starter subtree для обычного Git clone.
Публичные TAR/ZIP и две stock установки приняты отдельно; новый native capture
и CI этого курса подтверждаются только последующими фактическими проверками.
