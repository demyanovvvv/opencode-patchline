# Patchline

Точное редактирование кода для OpenCode.

Patchline - готовый к использованию плагин OpenCode для минимальных,
снимок-ориентированных и защищённых от устаревшего состояния изменений
существующих исходных файлов. Он сохраняет привычный рабочий процесс OpenCode,
а контроль корректности выполняется детерминированными инструментами, а не
только инструкциями для модели.

**Patchline `1.3.0` · OpenCode `1.19.0` · Интегрированный хост `1.19.0+patchline.1.3.0`**

[English](README.md) · [Установка](#установка) · [Работа](docs/operations/usage.ru.md) · [Инструменты](#инструменты) · [Документация](docs/README.md) · [Changelog](CHANGELOG.md) · [Релизы](https://github.com/demyanovvvv/opencode-patchline/releases) · [Issues](https://github.com/demyanovvvv/opencode-patchline/issues)

## Содержание

- [Возможности](#возможности) и [требования](#требования)
- [Установка, обновление и удаление](#установка)
- [Работа с Patchline](docs/operations/usage.ru.md)
- [Режимы работы](#режимы-работы) и [модель безопасности](#модель-безопасности)
- [Инструменты](#инструменты) и [поиск](#поиск-и-необязательные-возможности)
- [Разработка и проверка](#разработка-и-проверка)
- [Документация](#документация), [безопасность](#безопасность-и-приватность) и [лицензия](#лицензия)

## Возможности

- `read` создаёт снимок файла, ограничивает объём вывода и возвращает якоря строк.
- `edit` выполняет точную или актуальную Hashline-замену, связанную с прочитанным снимком.
- Перед записью проверяется устаревшее состояние; при ошибке записывается 0 байт.
- `write` защищает существующие файлы. Для них используется `edit`.
- Проверяются рабочая область, пути, симлинки, `.git`, кодировка, BOM и окончания строк.
- Многофайловые операции проходят предварительную проверку и защищённый rollback, включая отмену во время commit.
- Коллизии коротких Hashline-тегов обрабатываются безопасно; память snapshot ограничена byte quota, в Node доступен линейный PUT/CUT fallback.
- Есть буквальный текстовый поиск, структурный AST-поиск и мост к OpenCode LSP.
- Диагностика и post-edit validation запрашивают разрешение OpenCode.
- Правки показывают ограниченный по вычислениям и размеру unified diff в нативном интерфейсе OpenCode.
- Кастомные карточки инструментов, включая `patchline_execute` и `patchline_apply_patch`: состояние, раскрытие результатов и diff.
- Доступны режимы `precision`, `compatibility` и `disabled`.
- Есть команды doctor, benchmark, package smoke и OpenCode plugin smoke.

## Требования

- Node.js 20 или новее.
- OpenCode >=1.18.0 и <2; выбор артефакта хоста для Windows/Linux/macOS x64/arm64.
- Проект, открытый в OpenCode как worktree.

Релиз проверен на OpenCode `1.19.0` и `@opencode-ai/plugin@1.19.0`.
OpenCode загружает плагины через Bun, поэтому полный upstream Hashline доступен
при успешной загрузке native adapter. Прямой запуск через Node сохраняет
ограниченный PUT/CUT fallback. Опция `hashlineRecovery` разрешает только
доказанное upstream-восстановление якорей; `REM` и `MV` остаются строгими.
Установщик подключает серверный и TUI entrypoint; полные карточки требуют
совместимого хоста, который он подготавливает.

## Установка

### Быстрый старт: GitHub-релиз

Скачайте [`opencode-patchline-1.3.0.tgz`](https://github.com/demyanovvvv/opencode-patchline/releases/download/v1.3.0/opencode-patchline-1.3.0.tgz).
Распакуйте в постоянную папку и установите runtime-зависимости:

```bash
mkdir patchline-1.3.0
tar -xzf opencode-patchline-1.3.0.tgz -C patchline-1.3.0
cd patchline-1.3.0/package
npm install --omit=dev
node dist/cli.js doctor
```

Для ручного подключения без подготовки conversation UI host добавьте
абсолютные file URL в конфигурацию OpenCode:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["file:///absolute/path/patchline-1.3.0/package/dist/plugin.js"],
  "tui": { "plugin": ["file:///absolute/path/patchline-1.3.0/package/dist/tui.js"] }
}
```

На Windows используйте URL вида `file:///C:/tools/patchline-1.3.0/package/dist/plugin.js`.
Сохраняйте распакованную папку, пока регистрация ссылается на неё.
После изменения конфигурации перезапустите OpenCode. Из этой папки выполните:

```bash
node dist/cli.js doctor
node dist/cli.js doctor --json
node dist/cli.js config show
node dist/cli.js explain STALE_SNAPSHOT
```

Установщик подключает серверную и TUI-части и подготавливает совместимый
conversation UI host OpenCode на Windows/Linux/macOS x64/arm64. Хост собирается через Git/Bun,
команда запуска остаётся `opencode`. Подтверждение требуется без `--yes`.
Недостающие зависимости TypeScript LSP устанавливаются отдельно:

```bash
node dist/cli.js install --local --yes --lang ru
node dist/cli.js install --local --global --yes --lang ru
node dist/cli.js host-upgrade --opencode-version 1.19.0
```

Повторная установка обновляет Patchline, сохраняя текущую upstream-версию
OpenCode. Для смены upstream-версии используйте `host-upgrade`.
Скрипты работают из распакованного релиза и собранного checkout: используют
пакет рядом с собой, передают флаги и код завершения и не загружают CLI из npm.
Запускайте их из нужного проекта или укажите проект через `--cwd`:

```bash
sh /opt/patchline-1.3.0/package/install.sh --project --cwd /work/my-project --lang ru
sh /opt/patchline-1.3.0/package/install.sh --global --yes --lang ru
sh /opt/patchline-1.3.0/package/install.sh --project --cwd /work/my-project --dry-run
```

```powershell
& "C:\tools\patchline-1.3.0\package\install.ps1" --project --cwd "C:\work\my-project" --lang ru
& "C:\tools\patchline-1.3.0\package\install.ps1" --global --yes --lang ru
& "C:\tools\patchline-1.3.0\package\uninstall.ps1" --project --cwd "C:\work\my-project" --dry-run
```

### Флаги установщика

| Флаг | Команды | Значение |
| --- | --- | --- |
| `--project` | Обе | Область проекта по умолчанию; корень Git определяется от выбранного каталога. |
| `--global`, `-g` | Обе | Глобальная конфигурация для всех проектов. |
| `--cwd <путь>` | Обе | Выбор проекта без изменения рабочего каталога вызывающего процесса. |
| `--lang en\|ru`, `--language` | Обе | Язык сообщений, сохраняемый для выбранной области. |
| `--yes`, `-y` | Обе | Подтверждение операций для автоматизации. |
| `--dry-run` | Обе | Предпросмотр без записи, скачивания, сборки и пакетных команд. |
| `--help`, `-h` | Обе | Справка по выбранной команде. |
| `--local` | Установка | Пакет рядом с CLI; это источник пакета, а не область проекта. |
| `--package <путь>` | Установка | Явный каталог готового пакета вместо `--local`. |
| `--no-host` | Установка | Пропустить подготовку UI-хоста; полные карточки требуют интеграции. |
| `--no-lsp` | Установка | Пропустить установку и настройку TypeScript LSP. |
| `--opencode-version <1.x.y>` | Установка | Явно выбрать стабильную upstream-версию. |
| `--host-binary <путь>` | Обе | Исполняемый файл OpenCode для подготовки или восстановления. |
| `--keep-deps` | Удаление | Сохранить пакетные зависимости и runtime-дополнения. |
| `--restore-host` | Удаление | Восстановить исходный OpenCode, если нет других записанных владельцев. |

Значения принимаются как `--флаг значение` и `--флаг=значение`. Неизвестные,
повторные, неполные и конфликтующие параметры отклоняются до изменений.
`--project --global` недопустим; `--local --global` сохраняет совместимость.
Скрипты используют соседний пакет; явный `--package` заменяет этот источник.
CLI `install` без источника сохраняет регистрацию npm-пакета;
для GitHub-релиза используйте `--local` или скрипты.

`--lang ru|en` (синоним `--language`) меняет язык установщика и деинсталлятора;
выбор сохраняется для этой области установки. `--yes` подтверждает действия
для автоматизации. В проекте LSP-пакеты добавляются как devDependencies, при
`--global` — глобально. Bun устанавливается глобально как runtime-дополнение.
Уже существующие зависимости TypeScript и настройки LSP сохраняются.

Удаление с предварительным просмотром или подтверждением:

```bash
node dist/cli.js uninstall --dry-run --lang ru
node dist/cli.js uninstall --lang ru
node dist/cli.js uninstall --global --yes --lang ru
node dist/cli.js uninstall --project --cwd /work/my-project --keep-deps --yes
node dist/cli.js uninstall --global --restore-host --dry-run
node dist/cli.js uninstall --global --restore-host --yes
```

Удаляются записи Patchline и добавленные установщиком LSP/runtime-компоненты.
Прямые зависимости `opencode-patchline` удаляются из выбранного корня
проекта/конфигурации и проектной `.opencode/`. Общий кэш OpenCode сохраняется,
поскольку его могут использовать другие проекты; исходные checkout не удаляются.
Остальные плагины сохраняются. Резервные копии конфигурации остаются рядом
с исходными файлами. `sh uninstall.sh` и `./uninstall.ps1` принимают те же флаги.
Обычное удаление сохраняет общий интегрированный хост. `--restore-host` проверяет
хеши исходной копии и установленного файла, отклоняет восстановление при других
записанных владельцах и возвращает только неизменённую пользователем настройку
`autoupdate`. Восстанавливается сохранённая исходная версия, даже после обновлений
хоста. Флаг можно использовать после обычного удаления; если хост больше не
находится автоматически, укажите `--host-binary`.
Для старых установок без проверенной исходной копии выводится инструкция;
вращающаяся `.patchline-previous` не считается исходным OpenCode.
Сохраняйте каталог пакета, пока его использует регистрация или интегрированный
хост. Полностью перезапустите OpenCode после установки, обновления или удаления.
Подробнее: [установка и удаление](docs/operations/installation.md).

### Карточки инструментов и интегрированная версия

Полное оформление требует модифицированного хоста. Установщик автоматически
подготавливает интеграцию и заменяет executable с защищённой резервной копией.
После установки перезапустите OpenCode. Версия показывает установленный upstream
и версию Patchline, например `1.19.0+patchline.1.3.0`.

Установщик сохраняет текущую upstream-версию. Команда `host-upgrade` принимает
целевую версию OpenCode. Версии плагина и OpenCode изменяют свои части
интегрированной версии независимо. Совпадающая пара не пересобирается; при
замене executable обновляется одна копия `.patchline-previous`. Обновления
интегрированного хоста проходят через отдельную host-only операцию. Глобальный `autoupdate` пока
переводится в `notify` для защиты от stock-замены; значение `false` сохраняется.

Карточки используют цвета состояния активной темы, английские подписи,
анимацию и нижние кнопки `Show details` / `Hide details`. Результаты раскрываются
по двенадцать строк, файлы — независимо, native diff — целыми участками изменений
с номерами строк и цветами добавления/удаления.

Подготовка хоста требует Git и Bun. Готовые бинарные
артефакты, межкомпонентное восстановление транзакций и очистка старых backups /
source cache с проверкой владения пока не реализованы. Удаление плагина не
восстанавливает официальный executable и настройку обновлений. Подробнее:
[контракт установщика](docs/specs/installer-contract.md).

Для локальной рабочей копии:

```bash
npm install
npm run build
node dist/cli.js install --local --global --yes
```

Локальные install-скрипты также выбирают собранный пакет автоматически.
Для UI-проверки выполните `npm run smoke:tui` при доступном Bun.

## Режимы работы

`precision` используется по умолчанию. Он заменяет `read`, `edit`, `write` и
`apply_patch` на защищённые инструменты и добавляет поиск и диагностику
Patchline. Существующие файлы можно редактировать только на основе актуального
снимка. Классический `apply_patch` разрешён только для создания новых файлов;
секции с тегом снимка остаются точным способом редактирования.

`compatibility` оставляет встроенные инструменты редактирования и shell-поведение
OpenCode без изменений, добавляя инструменты поиска и диагностики Patchline.
`disabled` не регистрирует инструменты Patchline.

Пример настройки:

```json
{
  "plugin": [["file:///absolute/path/patchline-1.2.1/package/dist/plugin.js", {
    "mode": "precision",
    "maxInitialReadLines": 120,
    "maxSearchResults": 30,
    "maxDiagnostics": 30,
    "applyPatchFallback": true,
    "hashlineRecovery": false,
    "telemetry": false,
    "summary": true
  }]]
}
```

Все параметры проверяются при загрузке плагина. Полный список находится в
[`docs/operations/configuration.md`](docs/operations/configuration.md).

## Модель безопасности

1. `read` сохраняет исходные байты, идентификатор файла, сессию, worktree и
   ограниченный фрагмент файла.
2. `edit` непосредственно перед подготовкой операции проверяет SHA-256 снимка и
   идентификатор файла.
3. Несовпадение возвращает `STALE_SNAPSHOT` и не выполняет запись.
4. Существующие файлы заменяются защищённо и атомарно, с сохранением кодировки и
   окончаний строк.
5. Batch-операции проверяют все цели до первой записи и сохраняют внешние
   изменения при rollback.

Команды диагностики и проверки после редактирования запрашивают разрешение
OpenCode `bash` для конкретной команды. При отказе команда не запускается.

Основные коды ошибок: `STALE_SNAPSHOT`, `WRITE_PROTECTED`,
`PATH_OUTSIDE_WORKSPACE`, `SYMLINK_ESCAPE`, `GENERATED_FILE` и
`FALLBACK_REJECTED`.

## Инструменты

- `read`, `edit`, `write`, `apply_patch`
- `patchline_grep` - ограниченный буквальный поиск текста
- `patchline_lsp` - поиск символов через CLI-мост OpenCode
- `ast_search` - структурный поиск синтаксических шаблонов
- `patchline_edit_batch` - проверенные изменения нескольких файлов
- `patchline_diagnostics` - диагностика с проверкой разрешений
- `patchline_summary` - необязательные локальные агрегированные счётчики

Используйте LSP для символов, grep для буквального текста, AST для структуры,
а перед редактированием читайте минимально необходимый диапазон.

## Поиск и необязательные возможности

Результаты поиска ограничены. Файлы с некорректным UTF-8 и NUL-байтами
пропускаются буквальным поиском. AST-провайдер подключается только при наличии
возможности. Hashline загружается лениво, потому что его upstream runtime
ориентирован на Bun. Bun поддерживает целые patches, clipboard между файлами,
structural blocks, объединение same-path секций и защищённые `REM`/`MV`. В Node
остаются точные snapshot-редакции и линейный `PUT`/`CUT` fallback. Именованные
registers ограничены сессией/worktree и публикуются после успешного commit.
Нативный LSP OpenCode доступен при включённой экспериментальной возможности;
иначе Patchline использует CLI-мост. Отключённый LSP и пустые symbol results
возвращают явную ошибку недоступности: изолированный CLI-процесс не подтверждает
инициализацию индекса. Для семантики используйте native LSP, для поиска — AST/grep.

Для интерактивной диагностики используйте:

```bash
opencode-patchline doctor --lsp
opencode-patchline lsp check --json
```

Команды покажут установку TypeScript language server, готовый фрагмент
конфигурации OpenCode и fallback-инструменты `ast_search` и `patchline_grep`.
Они не изменяют конфигурацию и ничего не устанавливают автоматически.

## Разработка и проверка

```bash
npm install
npm run typecheck
npm test -- --run
npm run lint
npm run build
npm run bench
npm run doctor
npm run smoke:plugin
npm run smoke:hashline
npm run smoke:hashline:differential
npm run smoke:tui
npm run smoke:package
npm run smoke:install
npm run smoke:installer-lifecycle
npm run smoke:installer-lsp
npm pack --dry-run
```

Релизный gate включает полный Vitest, Bun Hashline differential, mounted TUI,
package-install и изолированный OpenCode installer smoke. Benchmark:
`functionalSuccess: true`, diff `+1 / -1`, 0 полных и 0 устаревших перезаписей.

## Документация

- [`README.md`](README.md) - полная англоязычная версия.
- [`docs/README.md`](docs/README.md) - индекс технической документации.
- [`docs/operations/installation.md`](docs/operations/installation.md) - установка.
- [`docs/operations/configuration.md`](docs/operations/configuration.md) - настройка.
- [`docs/operations/troubleshooting.md`](docs/operations/troubleshooting.md) - устранение проблем.
- [`docs/specs/`](docs/specs/) - нормативные контракты runtime.
- [`docs/architecture/`](docs/architecture/) - архитектура и решения.
- [`docs/testing/`](docs/testing/) - стратегия и сценарии тестирования.
- [`CHANGELOG.md`](CHANGELOG.md) - история релизов.

## Безопасность и приватность

По умолчанию Patchline не отправляет исходный код и метрики во внешние сервисы.
Он сохраняет модель разрешений OpenCode, отклоняет небезопасные пути и выходы
через симлинки, а для проверки устаревшего состояния использует содержимое файла,
а не только временные метки. Сообщения о проблемах безопасности направляйте
через приватный security-канал репозитория, когда он будет доступен.

## Лицензия

MIT. См. [`LICENSE`](LICENSE).
