# Точная установка общих расширений

`providers.json` закрепляет опубликованные immutable tag/version/commit и package scopes; `installed-packages.json` хранит полный состав каждого пакета с SHA-256, размером и нормализованным Git mode. Проверка: `python3 -B tools/materialize-providers.py --check`.

Воспроизводимая запись требует локальных release checkouts с точными tags: `python3 -B tools/materialize-providers.py --write --providers-root /путь/к/checkouts`. Совпадение tag/commit, descriptor version, состава файлов, candidate patch/hash (если он явно существует) и всех старых scopes проверяется до первой записи. Обнаруженная локальная правка останавливает обычную поставку; пользовательские файлы не перезаписываются как якобы старый release.

Modes 420 и 493 в inventory — это десятичные `0644` и `0755`, не количество файлов. Git executable class определяется owner execute bit; опубликованный Git archive сохраняет его, installer нормализует regular files в644/755, directories в755. Physical freeze bits400/500 или444/555 исследовательского пакета не переносятся в установленный курс. Нельзя заменять это blanket chmod644 либо делать все файлы executable. `--check` сравнивает также Git mode, поэтому потерянный executable early-filter.sh обнаруживается без запуска render.

Разовая принятая интеграция старого owner с ранее разрешёнными незакоммиченными vendor changes связана с отдельным initial source manifest/preflight и резервной копией. Она не ослабляет обычный materializer guard и не превращает unpublished candidate в опубликованный release. Ни provider verification, ни static inventory не объявляют native135/assignment/P/OCI/course qualification завершёнными.
