# Источники System Practice

Книжная опора находится в личном каталоге
`/home/tolya/JavaBooks/system-practice-source-pack-2026-10-16/books/`.
Действующий указатель — `SOURCES.md` комплекта
`system-practice-revision-handoff-2026-10-19`. Полные файлы доступны автору;
в ресурсы публичного курса
они не включаются. Фактическое содержательное чтение фиксируется отдельно
в [журнале](source-reading-log.md).

## Включённые издания

| Ключ | Издание и локальный файл | Предметная роль |
|---|---|---|
| `bib-shotts-tlcl` | William Shotts. *The Linux Command Line*. Seventh Internet Edition, 25.12A, 18 July 2026. `TLCL-25.12A.pdf`, 597 PDF-страниц | Командная среда, файловая система, текстовые потоки и инструменты |
| `bib-jones-powershell-intro` | Don Jones. *Learn Windows PowerShell in a Month of Lunches*. Manning, 2011, ISBN 9781617290213. `learn-windows-powershell-in-a-month-of-lunches.pdf`, 336 PDF-страниц | Последовательность знакомства с командами, справкой, объектами и конвейером |
| `bib-petty-powershell-scripting` | Джеймс Петти, Дон Джонс, Джеффри Хикс. *Изучаем скриптинг PowerShell за месяц, занимаясь один час в день. Создание скриптов и инструментов*. 2-е изд. СПб.: Питер, 2025. ISBN 978-5-4461-4184-5. `Изучаем скриптинг PowerShell.pdf`, 352 PDF-страницы | Проектирование сценария, структурированный результат, функции, диагностика и данные |
| `bib-chacon-straub-progit` | Scott Chacon, Ben Straub. *Pro Git*. 2-е изд., русский электронный текст; версия экземпляра `2.1.124-4-gbef0ce5`, 24.08.2026. `ProGit.pdf`, 541 PDF-страница | Снимок, индекс, история, ветки, слияние, обмен и сопровождение |

Титул TLCL фиксирует дату исправленной редакции 25.12A. Имя файла
не является датой фактического выпуска. У русского Pro Git версия
экземпляра установлена по титулу; страницы других сборок могут различаться.
Книга Don Jones 2011 года относится к Windows PowerShell своего времени.
Четвёртая редакция 2022 года не заявляется прочитанной или включённой.

Старое имя `dokumen.pub_powershell-o-6345139.pdf` в карточках относится
к библиографической линии PowerShell; для нового авторства используется
указанный выше фактический экземпляр Питер, 2025. Ошибочное отнесение
Pro Git к имени `Изучаем скриптинг PowerShell .pdf` не переносится.
Страницы старой ссылки нельзя автоматически считать страницами новой книги.

## Документация ранее прочитанных наборов

Следующий перечень сохраняет происхождение редакции от 16 октября.
Названия S2–S3в обозначают прежние наборы. Их решения о составе курса
имеют историческую область действия; обязательный GitHub/SSH и две лекции
установлены [текущим планом](course-revision-plan.md). Новое адресное чтение
фиксируется отдельно в журнале.

- [fish Tutorial](https://fishshell.com/docs/current/tutorial.html): команды,
  аргументы, справка, перенаправления и код завершения. При чтении
  16.10.2026 страница обозначена как документация 4.9.3.
- [PowerShell about_Pipelines](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_pipelines?view=powershell-7.5):
  поэлементная передача и привязка входа к параметрам; прочитана редакция 7.5.
- [PowerShell Export-Csv](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.utility/export-csv?view=powershell-7.5):
  преобразование свойств в CSV и влияние предварительного форматирования;
  прочитан, в частности, пример 7 редакции 7.5.
- [Git diff](https://git-scm.com/docs/git-diff): сравнение рабочего дерева,
  индекса и выбранного коммита; прочитаны synopsis и соответствующие
  формы description 16.10.2026.
- [fish Language, 4.9.3](https://fishshell.com/docs/current/language.html):
  раскрытие шаблонов и границы переноса примеров Bash в S2; в S3а —
  перенаправления, конвейер, `$status`, `$pipestatus`, переменные,
  условия и аргументы сценария.
- [PowerShell Get-Help, 7.5](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/get-help?view=powershell-7.5):
  доступность справочных файлов, описание параметра и примеры.
- [about_Quoting_Rules, 7.5](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_quoting_rules?view=powershell-7.5):
  аргумент с пробелом и строковое значение.
- [Set-Location, 7.5](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.management/set-location?view=powershell-7.5):
  текущее расположение, буквальный путь, различие `C:` и `C:\`.
- [Copy-Item, 7.5](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.management/copy-item?view=powershell-7.5):
  сохранение исходника, новое имя и параметры `LiteralPath`/`Destination`.
- [Working with files and folders, 7.5](https://learn.microsoft.com/en-us/powershell/scripting/samples/working-with-files-and-folders?view=powershell-7.5):
  просмотр, создание и удаление элементов; спорная фраза о перезаписи
  назначения не перенесена в курс, см. журнал.
- [Get-ChildItem, 7.5](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.management/get-childitem?view=powershell-7.5):
  начальное описание и примеры 1–3, рекурсивный просмотр и скрытые элементы.
- [GNU Coreutils: sort invocation, 9.11](https://www.gnu.org/software/coreutils/manual/html_node/sort-invocation.html):
  прочитанные официальные фрагменты о границах и порядке ключей,
  числовом сравнении, разделителе полей и locale.
- [GNU Grep: Exit Status, 3.12](https://www.gnu.org/s/grep/manual/html_node/Exit-Status.html):
  коды 0, 1 и 2; отсутствие выбранных строк относится к штатному результату
  фильтра. Область чтения — официальный фрагмент раздела.
- [Import-Csv, 7.5](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.utility/import-csv?view=powershell-7.5):
  синтаксис, описание и примеры 1–4; строки значений становятся свойствами
  объектов, числовое преобразование требуется отдельно.
- [Sort-Object, 7.5](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.utility/sort-object?view=powershell-7.5):
  описание и примеры 1–5, параметры Culture, Property, InputObject,
  Descending и Stable. В S3а используются два явных ключа и культура сравнения.
- [about_Output_Streams, 7.5](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_output_streams?view=powershell-7.5):
  основной текст о потоках, перенаправлении и Progress. Этот раздел уточняет
  обобщения книги о нумерации и перенаправлении потоков.
- [about_CommonParameters, 7.5](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_commonparameters?view=powershell-7.5):
  раздел ErrorAction: Continue для непрерывающей ошибки и граница
  действия параметра. В опыте с отсутствующим файлом используется Get-Content.

В S3а повторно прочитаны нужные части Export-Csv: синтаксис, описание,
примеры 1–3 и 7, параметры Encoding, NoTypeInformation, LiteralPath
и UseQuotes. В коде для PowerShell 7 отсутствие строки `#TYPE`
опирается на поведение по умолчанию; `-NoTypeInformation` не требуется.
Общая [библиография](../bibliography/course.bib) содержит источники,
цитируемые в учебных формах; точные печатные и PDF-страницы книг — в журнале.

Версия прочитанной документации фиксирует основание утверждения. Выбранную
исполняемую среду и поведение конкретных команд отдельно подтверждает Sol.
Инвентаризация программ на авторском компьютере не является проверкой
учебного маршрута Windows или готовностью облачной рабочей области.

### Git: уточнения S3б

Реально прочитанные новые интервалы Pro Git — печатные 27–28, 42–53,
58–61, 78–88; PDF-страницы и вклад каждого раздела записаны в журнале.
Они дополняют первоначальную опору на 14–18, 29–39 и 66–82.

- [git-add](https://git-scm.com/docs/git-add),
  [git-status](https://git-scm.com/docs/git-status) и
  [git-commit](https://git-scm.com/docs/git-commit): подготовленное содержимое,
  две колонки статуса и границы правила фиксации индекса.
- [git-restore](https://git-scm.com/docs/git-restore) и
  [gitrevisions](https://git-scm.com/docs/gitrevisions): источник/назначение
  восстановления и чтение файла выбранной версии либо индекса.
- [git-switch](https://git-scm.com/docs/git-switch) и
  [git-merge](https://git-scm.com/docs/git-merge): начало ветки,
  переключение, родители слияния и fast-forward.
- [git-config](https://git-scm.com/docs/git-config): современная форма
  config set --local и значения автора; [gitattributes](https://git-scm.com/docs/gitattributes):
  text/auto и eol для нормализации окончаний строк.
- [git-show](https://git-scm.com/docs/git-show): raw и no-patch для
  непосредственных родителей; [git-archive](https://git-scm.com/docs/git-archive):
  экспорт файлов снимка и граница такой передачи.

Документы открыты 16.10.2026. Полный объём каждого руководства
не заявляется: в журнале названы прочитанные разделы. Часть документов
обновлена в Git 2.56.0, часть сохраняет прежнюю редакцию с пометкой
об отсутствии изменений. Операции демонстрации используют обычные
локальные репозитории; новые runtime и внешние сервисы не нужны.

### Git: сопровождение S3в

Прочитаны 33 страницы Pro Git, включая повторное чтение: печатные
53–63, 79–82, 89–93, 110–112, 160–165 и 172–175. Главы 2–5 связывают
получение истории, конфликт, отдельную линию патча и подготовку выпуска.
Точные PDF-страницы и пределы чтения рисунков записаны в журнале.

- [git-remote](https://git-scm.com/docs/git-remote) и
  [git-fetch](https://git-scm.com/docs/git-fetch): настройка адреса,
  получение объектов и локальные ссылки слежения.
- [git-apply](https://git-scm.com/docs/git-apply) и
  [diff-format](https://git-scm.com/docs/diff-format): контекст патча,
  проверка применимости, изменение рабочих файлов и индекса.
- [git-push](https://git-scm.com/docs/git-push) и
  [git-ls-remote](https://git-scm.com/docs/git-ls-remote): передача refs,
  сохранение истории и наблюдение объекта аннотированного тега.
- [git-tag](https://git-scm.com/docs/git-tag) и повторно
  [git-archive](https://git-scm.com/docs/git-archive): именованная версия,
  аннотация, состав архива и запись средствами Git; в git-diff отдельно
  прочитан --output.

Прежний набор использовал локальный bare-каталог для обмена. Его границы
HTTP/SSH и учётных записей не определяют новую третью лабораторную.
Цифровая подпись коммитов, rerere и am остаются самостоятельными
углублениями при наличии учебной цели.

## Опора новой редакции

Методические основания — `authoring-methodology.md`, `authoring-examples.md`
и применимые части `course-revision-plan.md` из `/home/tolya/Java/docs/`.
Их проверенный снимок находится в `reference/java/docs/` управляющего
комплекта. Переносятся качество объяснения, развитие примера, сценарий notes,
самостоятельность работ и цикл рецензии. Аудитория GUI, PowerShell/Windows
и две лекции определены собственным заданием System Practice.

Для трёх новых образцов непосредственно прочитаны Jones, печ. 1–4;
TLCL, печ. 7–12; Pro Git, печ. 14–18 и 66–71. Пагинация, просмотр рисунка
и вклад записаны в [журнале](source-reading-log.md). Первичные уточнения:

- [Get-Content 7.5](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.management/get-content?view=powershell-7.5)
  и [Set-Location 7.5](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.management/set-location?view=powershell-7.5):
  чтение файла и текущее расположение в первом Windows-примере.
- [GitHub: создание ключа](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/generating-a-new-ssh-key-and-adding-it-to-the-ssh-agent):
  сохранность существующих ключей, парольная фраза, клиент и агент Windows.
- [GitHub: проверка SSH](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/testing-your-ssh-connection)
  и [отпечатки сервера](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints):
  проверка стороны, имени аккаунта и кода завершения теста.
- [RFC 4253](https://www.rfc-editor.org/rfc/rfc4253)
  и [RFC 4252](https://www.rfc-editor.org/rfc/rfc4252): модель защищённого
  транспорта и подписи пользователя. Старые рекомендации алгоритмов
  не являются настройкой современного клиента.
- [Руководство ssh](https://man.openbsd.org/ssh.1): назначение `-T`.
  [Автоматические переменные PowerShell](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_automatic_variables?view=powershell-7.5):
  `$LASTEXITCODE` для результата внешней программы.

### Чтение для следующих наборов

Этот перечень задаёт адресную очередь. Наличие ссылки не означает,
что новый автор уже прочитал её содержание.

| Предмет | Первичные источники и роль |
|---|---|
| Интерактивная среда | [Corbató и др., 1962](https://cseweb.ucsd.edu/classes/wi19/cse221-a/papers/corbato62.pdf): интерактивный доступ; [Ritchie](https://www.nokia.com/bell-labs/about/dennis-m-ritchie/hist.html): развитие Unix; [Monad Manifesto](https://www.jsnover.com/Docs/MonadManifesto.pdf) и [Microsoft](https://devblogs.microsoft.com/powershell/monad-manifesto-the-origin-of-windows-powershell/): замысел объектной среды |
| Командная оболочка | [Microsoft](https://learn.microsoft.com/en-us/powershell/scripting/what-is-a-command-shell), [about_Pipelines](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_pipelines), [fish Tutorial](https://fishshell.com/docs/current/tutorial.html): современные определения и модель данных |
| Происхождение Git | [Интервью Torvalds](https://www.linuxfoundation.org/blog/blog/10-years-of-git-an-interview-with-git-creator-linus-torvalds) и [исходный README](https://github.com/git/git/blob/e83c5163316f89bfbde7d9ab23ca2e25604af290/README): Linux, BitKeeper и цели создания |
| Удалённый доступ | [Pro Git: протоколы](https://git-scm.com/book/en/v2/Git-on-the-Server-The-Protocols), [создание аккаунта](https://docs.github.com/en/account-and-profile/how-tos/account-management/creating-an-account-on-github), [адреса remote](https://docs.github.com/en/get-started/git-basics/about-remote-repositories), [SSH](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/about-ssh), [изменение безопасности протоколов](https://github.blog/security/application-security/improving-git-protocol-security-github/): полный лабораторный маршрут |
| Двоичные данные | [Git LFS](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-git-large-file-storage) и [большие файлы GitHub](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github): хранение указателя, отдельное содержимое и ограничения хостинга |
| Параллельная работа | [git-worktree](https://git-scm.com/docs/git-worktree), [делегирование в VS Code](https://code.visualstudio.com/docs/agents/guides/delegate-two-tasks): рабочие каталоги, индекс, HEAD и общая база |
| Нагрузка агентной разработки | [Anthropic: Redesigning source control](https://www.anthropic.com/engineering/redesigning-source-control) и [GitHub: Building Git infrastructure for agent-scale development](https://github.blog/engineering/architecture-optimization/building-git-infrastructure-for-agent-scale-development/): конкретные профили нагрузки и инженерные ответы |

Перед авторством современных случаев сверяются даты, числа и границы
обобщения. Первичные мотивы разработчиков отличают от педагогической
интерпретации. Новые версии PowerShell сверяются с документацией;
Windows PowerShell 2011 года не обозначается как PowerShell 7.
Для Git учитываются shallow/partial clone и современные форматы объектов;
всеобщая полнота clone и неизменность SHA-1 не предполагаются.

## Использование и границы

Курс использует собственные объяснения, данные и учебные примеры.
Близкая адаптация задачи или изображения получает отдельную атрибуцию
и применимые условия использования. У Pro Git сохраняется CC BY-NC-SA 3.0
для соответствующих адаптаций. Экземпляр TLCL указывает CC BY-NC-ND 3.0 US;
он используется для чтения и содержательной опоры, без публикации
переработанных фрагментов книги. Общая лицензия всем материалам курса
этим документом не назначается.

Книги PowerShell предоставлены пользователем целиком для авторской работы.
Доступ к платному preview не заявляется. Полноценное чтение выбранных страниц
различается с просмотром титула и оглавления. Открытая документация также
считается прочитанной только в фактически рассмотренном объёме.

[The Missing Semester](https://missing.csail.mit.edu/) остаётся кандидатом
для дополнительных учебных сценариев. Его материалы в этом наборе
содержательно не использованы; редакция и разделы будут записаны при чтении.
