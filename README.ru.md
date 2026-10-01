# Patchline

Точное редактирование кода для OpenCode.

Patchline - готовый к использованию плагин OpenCode для минимальных,
снимок-ориентированных и защищённых от устаревшего состояния изменений
существующих исходных файлов. Он сохраняет привычный рабочий процесс OpenCode,
а контроль корректности выполняется детерминированными инструментами, а не
только инструкциями для модели.

**Версия пакета: `1.1.0`** (неопубликованные изменения — в `CHANGELOG.md`)

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
- В том же пакете есть TUI-панель прогресса, числа записей, validation, скрытых файлов и ошибок в цветах активной темы.
- Доступны режимы `precision`, `compatibility` и `disabled`.
- Есть команды doctor, benchmark, package smoke и OpenCode plugin smoke.

## Требования

- Node.js 20 или новее.
- OpenCode 1.18.x.
- Проект, открытый в OpenCode как worktree.

Локальные проверки выполняются с OpenCode `1.18.33` и `@opencode-ai/plugin@1.18.30`.
OpenCode загружает плагины через Bun, поэтому полный upstream Hashline доступен
при успешной загрузке native adapter. Прямой запуск через Node сохраняет
ограниченный PUT/CUT fallback. Опция `hashlineRecovery` разрешает только
доказанное upstream-восстановление якорей; `REM` и `MV` остаются строгими.
TUI entrypoint устанавливается отдельно в TUI-конфигурацию OpenCode.

## Установка

Установите пакет:

```bash
npm install opencode-patchline
```

Добавьте его в конфигурацию OpenCode:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-patchline"]
}
```

После изменения конфигурации перезапустите OpenCode. Проверить окружение можно
командой:

```bash
npx opencode-patchline doctor
npx opencode-patchline doctor --json
npx opencode-patchline config show
npx opencode-patchline explain STALE_SNAPSHOT
```

Установщик подключает серверную и TUI-части штатной командой OpenCode и
отдельно спрашивает подтверждение перед установкой недостающих компонентов
TypeScript LSP и дополнительной runtime-среды Bun для полного native Hashline:

```bash
npx opencode-patchline install --lang ru
npx opencode-patchline install --global --lang ru
```

`--lang ru|en` (синоним `--language`) меняет язык установщика и деинсталлятора;
выбор сохраняется для этой области установки. `--yes` подтверждает действия
для автоматизации. В проекте LSP-пакеты добавляются как devDependencies, при
`--global` — глобально. Bun устанавливается глобально как runtime-дополнение.
Уже существующие зависимости TypeScript и настройки LSP сохраняются.

Удаление с предварительным просмотром или подтверждением:

```bash
npx opencode-patchline uninstall --dry-run
npx opencode-patchline uninstall
npx opencode-patchline uninstall --global --yes
```

Удаляются записи Patchline и добавленные установщиком LSP/runtime-компоненты.
Остальные плагины сохраняются. Резервные копии конфигурации остаются рядом
с исходными файлами. Подробнее: [установка и удаление](docs/operations/installation.md).

Для новой TUI-панели используйте этот установщик с пакетом, содержащим экспорты
`./server` и `./tui`: OpenCode обнаружит обе части и обновит серверную и TUI
конфигурации. Одна серверная запись в `opencode.json` подключает инструменты и
нативные diff-карточки; для sidebar нужна также TUI-часть. После установки
перезапустите OpenCode и откройте боковую панель. TUI-изменения в этой рабочей
копии ещё не опубликованы; старый npm-пакет их не содержит.

Для локальной рабочей копии сначала соберите пакет и установите его каталог
штатной командой OpenCode:

```bash
npm install
npm run build
opencode plugin /absolute/path/to/opencode-patchline
```

Компактная панель показывает до четырёх файлов и двенадцати строк diff на файл,
явно отмечает сокращённое превью и результаты validation/rollback. Нативные
карточки `edit` / `apply_patch` доступны в истории диалога.
Для mounted UI-проверки установите Bun и выполните `npm run smoke:tui`.

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
  "plugin": [["opencode-patchline", {
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
