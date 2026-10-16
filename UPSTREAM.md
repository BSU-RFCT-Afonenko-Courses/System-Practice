# Происхождение технической поставки System Practice

Текущая локальная интеграция 16 октября 2026 года использует проверенную
candidate-связку. Полная содержательная, визуальная и внешняя приёмка курса
выполняются отдельными этапами. Предыдущее описание сохранено в
[истории](docs/provider-history/UPSTREAM-before-20261016.md); его статусы
относятся к прежней редакции.

`providers.json` сохраняет published repository/tag/version/commit/sourceZip
как исходную базу. Отдельный `candidate` задаёт точный локальный commit,
baseCommit, tracked patch и SHA256. `installed-packages.json` содержит
фактически установленные bytes и scopes; `extensionTree` относится к базовому
пакету, а `candidate` описывает применённый локальный diff. Descriptor version
остается номером исходного release, а не объявлением нового выпуска.

| Владелец | Опубликованная база | Локальный candidate |
| --- | --- | --- |
| Afonenko-Course-Tools/quarto-course | v7.1.0 / `04a6295569f5dcc0fc1b991dc076bafc050dbd49` | `80cdff6d443ea6036f6138a0a3bb95b35779eb34` |
| Afonenko-Course-Tools/quarto-project-publish | v5.1.0 / `62f8c4a01a5fd9af11f5f66abba2bb48c2ef2631` | Без локальных изменений |
| Afonenko-Course-Tools/quarto-reference-catalog | v3.1.0 / `3df2110e9f525f03f3ecb4926b5d55718e955c4c` | Без локальных изменений |

Полные patches и hashes установленных отличий находятся в
[манифесте](docs/local-extension-patches.json). Core candidate сохраняет
опубликованную optional time semantics: отсутствие оценки допустимо;
заданное значение остаётся положительным целым; неполная оценка скрывает
общую сводку. Навигация к hash-цели сохраняет начало структурного SECTION;
диагностика называет владельца проектом. API-precheck — необязательное узкое
расширение, которое само не создаёт обязательных API задания.

## Проверка и воспроизведение

Обычный checkout уже содержит vendored packages. Offline проверка ничего
не переустанавливает и не обращается к GitHub:

```sh
python3 tools/materialize-providers.py --check
python3 tools/test-materialize-providers.py
```

Для воспроизведения подготовьте repositories с именами `checkout` из
`providers.json` в одном каталоге. Достаточно published tag objects и blobs;
непушенный candidate SHA получать из GitHub не требуется. Материализатор
проверяет tag → exact SHA, descriptor version, tracked patch SHA256 и все
candidate package bytes. Пример:

```sh
python3 tools/materialize-providers.py --providers-root /absolute/release-checkouts --write
python3 tools/materialize-providers.py --check
```

Данные берутся из Git archive точного published commit и tracked patch,
без использования working-tree правок владельца. Перед первой записью
проверяется весь target inventory всех scopes. Неизвестная локальная правка,
extra file или symlink останавливает поставку. Повторный запуск не меняет
bytes/inventory. Посторонние темы сохраняются. Материализация предполагает
единоличное владение vendor scopes на время проверки и записи.

## Пять учебных форм и пространства имён

Core/Presentation/Navigation/QRC доступны в корне и во всех пяти native
частях; Course Site — в корне. Лекции получили те же штатные hooks,
Presentation notes и Navigation plugin, что введения. Все необходимые JS/CSS
assets поставляются этими пакетами. `bibliography/numeric.csl` скопирован
побайтно из проверенного Java; библиографические источники не менялись.

QRC namespaces теперь `system-practice-portal`, `system-practice-theory`,
`system-practice-lectures`, `system-practice-practice`, `system-practice-tasks`,
`system-practice-handbook`. Ссылки xref получили только новый namespace-аргумент;
ID, labels, авторская проза, render/chapter lists и заголовки сохранены.
Aliases/redirects не добавлены, рабочие пути и внешние корни не переименованы.

Текущий S2 использует manual ZIP и очную приёмку. PL/Download, grader metadata
и автоматические runtime checks к System не добавлены. Task install проверяет
vendored closure; install:from-sources явно воспроизводит её. CI не заменяет
пакеты blind quarto add и не получает непушенные SHA. Полный render/визуальная
приёмка новой редакции остаются отдельным этапом. Реальный Moodle не менялся.

Текущий candidate дополнен bounded optional Java source ZIP и compiled type discovery. Публичные version/digests не изменены. Навигация предоставляет вызов штатного Reveal Notes.open на широком экране и в меню узкого экрана; самостоятельная inline-панель не служит доказательством работы отдельного окна. Actual speaker-window verification ведётся в отдельном visual receipt. Прежние результаты render/native остаются историческими до новых проверок точных текущих SHA.
