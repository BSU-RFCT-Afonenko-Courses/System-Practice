# Происхождение технической поставки

Общие расширения установлены штатным Quarto в `_extensions` и хранятся в Git.
Версии пакетов находятся в их `_extension.yml`. Порядок установки и обновления
описан в [инструкции](docs/provider-installation.md).

Исходные зависимости Platform и Performance оформлены как Git submodules:
URL находятся в `.gitmodules`, выбранные commits — в gitlinks курса.
`go-task bootstrap` получает их стандартной командой Git.

CI выполняет student render и полный author export. Отдельные declared/delivery
jobs проверяют готовую поставку с тем же фактическим Platform HEAD, который
использовался при сборке. Runtime profiles и OCI identities поступают из
закреплённой Platform в готовый выпуск. Успех student render сам по себе
не подтверждает native export, контейнерное оценивание и эксплуатацию.

История прежних поставок доступна в [снимке Git](https://github.com/BSU-RFCT-Afonenko-Courses/System-Practice/tree/d254c636bbc0701e881315802dc3a3f775b7d872/docs/provider-history).
