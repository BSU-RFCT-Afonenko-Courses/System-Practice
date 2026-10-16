# Источники System Practice

Книжная опора находится в личном каталоге `WORKSPACE/books` восстановленного
единого handoff r3. Полные файлы доступны автору; в ресурсы публичного курса
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

## Первичная документация

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
