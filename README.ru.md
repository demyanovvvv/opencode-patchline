# Patchline

Точное редактирование кода для OpenCode.

Patchline - готовый к использованию плагин OpenCode для минимальных,
снимок-ориентированных и защищённых от устаревшего состояния изменений
существующих исходных файлов. Он сохраняет привычный рабочий процесс OpenCode,
а контроль корректности выполняется детерминированными инструментами, а не
только инструкциями для модели.

**Текущий релиз: `1.0.0`**

## Возможности

- `read` создаёт снимок файла, ограничивает объём вывода и возвращает якоря строк.
- `edit` выполняет точную или якорную замену, связанную с прочитанным снимком.
- Перед записью проверяется устаревшее состояние; при ошибке записывается 0 байт.
- `write` защищает существующие файлы. Для них используется `edit`.
- Проверяются рабочая область, пути, симлинки, `.git`, кодировка, BOM и окончания строк.
- Многофайловые операции проходят предварительную проверку и защищённый rollback.
- Есть буквальный текстовый поиск, структурный AST-поиск и мост к OpenCode LSP.
- Диагностика и post-edit validation запрашивают разрешение OpenCode.
- Доступны режимы `precision`, `compatibility` и `disabled`.
- Есть команды doctor, benchmark, package smoke и OpenCode plugin smoke.

## Требования

- Node.js 20 или новее.
- OpenCode 1.18.x.
- Проект, открытый в OpenCode как worktree.

Плагин проверен с OpenCode `1.18.30` и `@opencode-ai/plugin@1.18.30`.
Windows, Linux и macOS входят в CI-матрицу Node.js 20 и 22; на Windows
используется direct plugin smoke, поскольку bootstrap HTTP-сервера OpenCode на
hosted runner зависает независимо от Patchline.

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

Также доступен установщик, который передаёт изменение конфигурации штатной
команде OpenCode:

```bash
npx opencode-patchline install
npx opencode-patchline install --global
```

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
ориентирован на Bun; в Node.js точные snapshot-редакции остаются доступными, а
`doctor` показывает Hashline как необязательную возможность. Нативный LSP
OpenCode используется только при включённой экспериментальной возможности;
иначе Patchline использует CLI-мост.

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
npm pack --dry-run
```

Текущий релизный gate включает 9 файлов тестов и 65 тестов. Последний локальный
benchmark: `functionalSuccess: true`, diff `+1 / -1`, 0 полных перезаписей и
0 устаревших перезаписей.

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
