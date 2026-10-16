# Техническая поставка «Обработки данных»

Авторский договор — условие `tasks/labs/data-processing.qmd`. Учебные ZIP
содержат только объявленные данные двух маршрутов; приватные примеры
`reference/` не входят в них. `materials.json` задаёт точные UTF-8 байты,
`materials-hashes.json` — хеши воспроизводимых ZIP.

Из корня репозитория:

```sh
python3 tools/build_materials.py --project data-processing --write
python3 tools/build_materials.py --project data-processing --check
python3 -m unittest discover -s tests -p 'test_*.py' -v
python3 tools/check_data_processing.py submission.zip --route fish
python3 tools/check_data_processing.py submission.zip --route powershell
```

Упаковщик сначала проверяет все назначения и известные хеши, затем пишет
архивы. Неожиданная локальная правка не перезаписывается.

Проверка ZIP не извлекает и не запускает присланный код. Она устанавливает
сохранность входов и expected, наличие сценария и пояснения, оба результата,
пустую выборку и файлы диагностики. fish сравнивается побайтово; CSV
PowerShell — после разбора с проверкой колонок, строк и значений. Отсутствие
обоих выходных файлов после ошибки проверяется отдельно. Одинаковый результат не
доказывает применение содержательного конвейера. Смысл сценария, объяснение,
stdout/stderr и коды процессов подтверждаются разбором и запуском в подходящей
изолированной среде. Поле `manualRequired` сохраняется даже при успехе
автоматической части; итоговую оценку этот инструмент не выставляет.

Примеры преподавателя проверены отдельными процессами локальных fish и
PowerShell на CachyOS. Это свидетельство не подтверждает Windows,
интерактивный cloud workspace или наличие PowerShell в fish grader.
