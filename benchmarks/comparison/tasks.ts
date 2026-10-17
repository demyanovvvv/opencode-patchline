export type ComparisonTask = {
  id: string; title: string; category: string; pilot?: boolean; prompt: string
  before: Record<string, string>; expected: Record<string, string>
  gitBaseline?: Record<string, string>
  editableRegions?: Record<string, { start: number; end: number }[]>
  checks: { name: string; code: string; typecheck?: string }[]
}

function task(input: Omit<ComparisonTask, "expected"> & { replacements: Record<string, [string, string][]> }): ComparisonTask {
  const { replacements, ...rest } = input
  const expected = { ...input.before }
  const editableRegions = Object.fromEntries(Object.entries(replacements).map(([file, edits]) => [file, edits.map(([old]) => {
    const start = input.before[file]!.indexOf(old)
    return { start, end: start + old.length }
  }).sort((a, b) => a.start - b.start)]))
  for (const [file, edits] of Object.entries(replacements)) for (const [old, next] of edits) {
    if (!expected[file]?.includes(old)) throw new Error(`Invalid golden edit: ${input.id}/${file}`)
    expected[file] = expected[file]!.replace(old, next)
  }
  return { ...rest, expected, editableRegions }
}
const keep = { "notes.txt": "Project note: preserve this file exactly.\n" }
const load = (file: string) => `await loadModule(${JSON.stringify(file)})`
const large = Array.from({ length: 2400 }, (_, index) => index === 1730 ? "export const requestTimeoutMs = 5000" : `// preserved entry ${String(index).padStart(4, "0")}: service configuration`).join("\n") + "\n"

export const comparisonTasks: ComparisonTask[] = [
  task({ id: "dirty-worktree", title: "Сохранение пользовательских правок", category: "Сохранность",
    prompt: "In settings.mjs increase requestTimeoutMs to 8000. There are existing uncommitted user edits in settings.mjs and notes.txt: preserve them exactly, and do not change the Git index.",
    gitBaseline: { ...keep, "settings.mjs": "export const requestTimeoutMs = 5000\nexport const theme = 'light'\n" },
    before: { "notes.txt": "Project note: preserve this file exactly.\nUser draft: shipping plan — не удалять.\n", "settings.mjs": "export const requestTimeoutMs = 5000\nexport const theme = 'dark' // user-owned setting\n" },
    replacements: { "settings.mjs": [["requestTimeoutMs = 5000", "requestTimeoutMs = 8000"]] },
    checks: [{ name: "Таймаут исправлен, пользовательская настройка сохранена", code: `const m = ${load("settings.mjs")}; assert.equal(m.requestTimeoutMs, 8000); assert.equal(m.theme, 'dark')` }] }),
  task({ id: "targeted", title: "Точечное исправление", category: "Точность", pilot: true,
    prompt: "In pricing.mjs, fix discountedPrice so percent is clamped to 0..100 before applying the discount. Keep the public API and unrelated code unchanged.",
    before: { ...keep, "pricing.mjs": "// Prices are in integer cents.\nexport function discountedPrice(cents, percent) {\n  return Math.round(cents * (1 - percent / 100))\n}\n\nexport function label(cents) { return `${cents} cents` }\n" },
    replacements: { "pricing.mjs": [["  return Math.round(cents * (1 - percent / 100))\n", "  return Math.round(cents * (1 - Math.min(100, Math.max(0, percent)) / 100))\n"]] },
    checks: [{ name: "Обычная скидка", code: `const m = ${load("pricing.mjs")}; assert.equal(m.discountedPrice(1000, 25), 750)` }, { name: "Граничные значения", code: `const m = ${load("pricing.mjs")}; assert.equal(m.discountedPrice(1000, -20), 1000); assert.equal(m.discountedPrice(1000, 120), 0)` }, { name: "Сохранён API", code: `const m = ${load("pricing.mjs")}; assert.equal(m.label(50), '50 cents')` }] }),
  task({ id: "large-file", title: "Одна строка в большом файле", category: "Контекст", pilot: true,
    prompt: "In settings.mjs, change requestTimeoutMs from 5000 to 12000. Preserve every other byte of the file.",
    before: { ...keep, "settings.mjs": large }, replacements: { "settings.mjs": [["requestTimeoutMs = 5000", "requestTimeoutMs = 12000"]] },
    checks: [{ name: "Новое значение", code: `const m = ${load("settings.mjs")}; assert.equal(m.requestTimeoutMs, 12000)` }, { name: "Остальной файл сохранён побайтово", code: "assert.equal(files['settings.mjs'], golden['settings.mjs'])" }] }),
  task({ id: "three-files", title: "Сигнатура и два вызова", category: "Несколько файлов", pilot: true,
    prompt: "Change greet in greeting.mjs from greet(name) to greet({ name, prefix = 'Hello' }). Update app.mjs and preview.mjs callers to pass objects. app must still return 'Hello Ada'; preview must return 'Hi Lin'. Keep the exports.",
    before: { ...keep, "greeting.mjs": "export function greet(name) {\n  return `Hello ${name}`\n}\n", "app.mjs": "import { greet } from './greeting.mjs'\nexport const message = () => greet('Ada')\n", "preview.mjs": "import { greet } from './greeting.mjs'\nexport const preview = () => greet('Lin')\n" },
    replacements: { "greeting.mjs": [["greet(name)", "greet({ name, prefix = 'Hello' })"], ["`Hello ${name}`", "`${prefix} ${name}`"]], "app.mjs": [["greet('Ada')", "greet({ name: 'Ada' })"]], "preview.mjs": [["greet('Lin')", "greet({ name: 'Lin', prefix: 'Hi' })"]] },
    checks: [{ name: "Новая сигнатура", code: `const m = ${load("greeting.mjs")}; assert.equal(m.greet({ name: 'Jo' }), 'Hello Jo'); assert.equal(m.greet({ name: 'Jo', prefix: 'Dear' }), 'Dear Jo')` }, { name: "Первый вызов", code: `assert.equal((${load("app.mjs")}).message(), 'Hello Ada')` }, { name: "Второй вызов", code: `assert.equal((${load("preview.mjs")}).preview(), 'Hi Lin')` }] }),
  task({ id: "duplicate", title: "Похожие фрагменты", category: "Точность", prompt: "Only change the production retry limit to 5 in retry.mjs. Keep the development limit at 2.",
    before: { ...keep, "retry.mjs": "export const development = { retries: 2 }\nexport const production = { retries: 2 }\n" }, replacements: { "retry.mjs": [["production = { retries: 2 }", "production = { retries: 5 }"]] },
    checks: [{ name: "Production изменён, development сохранён", code: `const m = ${load("retry.mjs")}; assert.equal(m.production.retries, 5); assert.equal(m.development.retries, 2)` }] }),
  task({ id: "sequential", title: "Связанные правки", category: "Точность", prompt: "In limits.mjs raise MAX_ITEMS to 100 and make canAdd reject when count equals MAX_ITEMS, while still allowing lower counts.",
    before: { ...keep, "limits.mjs": "export const MAX_ITEMS = 50\nexport function canAdd(count) { return count <= MAX_ITEMS }\n" }, replacements: { "limits.mjs": [["MAX_ITEMS = 50", "MAX_ITEMS = 100"], ["count <= MAX_ITEMS", "count < MAX_ITEMS"]] },
    checks: [{ name: "Лимит и граница согласованы", code: `const m = ${load("limits.mjs")}; assert.equal(m.MAX_ITEMS, 100); assert.equal(m.canAdd(99), true); assert.equal(m.canAdd(100), false)` }] }),
  task({ id: "validation", title: "Валидация запроса", category: "Поведение", prompt: "Fix validName in validation.mjs: accept only strings with at least one non-whitespace character. Do not throw on null, arrays or numbers.",
    before: { ...keep, "validation.mjs": "export function validName(value) { return value.length > 0 }\n" }, replacements: { "validation.mjs": [["value.length > 0", "typeof value === 'string' && value.trim().length > 0"]] },
    checks: [{ name: "Корректные имена", code: `const m = ${load("validation.mjs")}; assert.equal(m.validName('Ada'), true); assert.equal(m.validName(' A '), true)` }, { name: "Некорректные типы и пробелы", code: `const m = ${load("validation.mjs")}; for (const x of [null, undefined, 7, [], '', '  ']) assert.equal(m.validName(x), false)` }] }),
  task({ id: "type-error", title: "Ошибка типов", category: "Поведение", prompt: "Fix the checkJs type error in sum.mjs. sum must return a number, including 0 for an empty array. Preserve its numeric JSDoc API.",
    before: { ...keep, "sum.mjs": "/** @param {number[]} values @returns {number} */\nexport function sum(values) { return values.reduce((a, b) => a + b, '') }\n" }, replacements: { "sum.mjs": [["a + b, ''", "a + b, 0"]] },
    checks: [{ name: "Числовой результат", code: `const m = ${load("sum.mjs")}; assert.equal(m.sum([1, 2, 3]), 6); assert.equal(m.sum([]), 0)` }, { name: "Типы checkJs", code: "", typecheck: "sum.mjs" }] }),
  task({ id: "monorepo", title: "Поиск в монорепозитории", category: "Контекст", prompt: "Find the shipping fee implementation used by packages/shop/index.mjs. Make orders at or above 5000 cents ship free; lower orders must still cost 500. Preserve the shop export.",
    before: { ...keep, "packages/shop/index.mjs": "export { shippingFee } from '../shipping/fee.mjs'\n", "packages/shipping/fee.mjs": "export const shippingFee = (total) => total > 5000 ? 0 : 500\n", "packages/legacy/fee.mjs": "export const legacyFee = () => 900\n" }, replacements: { "packages/shipping/fee.mjs": [["total > 5000", "total >= 5000"]] },
    checks: [{ name: "Реализация и публичный экспорт", code: `const m = ${load("packages/shop/index.mjs")}; assert.equal(m.shippingFee(4999), 500); assert.equal(m.shippingFee(5000), 0); assert.equal(m.shippingFee(7000), 0)` }] }),
  task({ id: "extension", title: "Расширение поведения", category: "Поведение", prompt: "Extend statusLabel in status.mjs to support 'paused' => 'Paused'. Preserve all existing mappings and the unknown fallback.",
    before: { ...keep, "status.mjs": "export function statusLabel(status) {\n  const labels = { active: 'Active', done: 'Done' }\n  return labels[status] ?? 'Unknown'\n}\n" }, replacements: { "status.mjs": [["done: 'Done'", "done: 'Done', paused: 'Paused'"]] },
    checks: [{ name: "Новое и прежнее поведение", code: `const m = ${load("status.mjs")}; for (const [key, value] of [['active','Active'],['done','Done'],['paused','Paused'],['x','Unknown']]) assert.equal(m.statusLabel(key), value)` }] }),
  task({ id: "crlf-unicode", title: "CRLF и Unicode", category: "Сохранность", prompt: "In locale.mjs change the exported timeout to 9000. Preserve the UTF-8 BOM, CRLF line endings and all Unicode text exactly.",
    before: { ...keep, "locale.mjs": "\uFEFF// Привет · 日本語 · café\r\nexport const timeout = 3000\r\nexport const title = 'Загрузка'\r\n" }, replacements: { "locale.mjs": [["timeout = 3000", "timeout = 9000"]] },
    checks: [{ name: "Значение изменено", code: `assert.equal((${load("locale.mjs")}).timeout, 9000)` }, { name: "BOM, CRLF и Unicode сохранены", code: "assert.equal(files['locale.mjs'], golden['locale.mjs'])" }] }),
  task({ id: "mixed-endings", title: "Смешанные окончания строк", category: "Сохранность", prompt: "Change enabled from false to true in feature.mjs. Preserve existing mixed line endings, comments and all other bytes.",
    before: { ...keep, "feature.mjs": "// first\r\nexport const enabled = false\n// last\r\n" }, replacements: { "feature.mjs": [["enabled = false", "enabled = true"]] },
    checks: [{ name: "Поведение и байты", code: `assert.equal((${load("feature.mjs")}).enabled, true); assert.equal(files['feature.mjs'], golden['feature.mjs'])` }] }),
  task({ id: "multi-boundary", title: "Согласованность двух модулей", category: "Несколько файлов", prompt: "Raise the API version from v1 to v2 in version.mjs and update the default endpoint in client.mjs to /v2/items. Preserve the client function and unrelated settings.",
    before: { ...keep, "version.mjs": "export const apiVersion = 'v1'\nexport const region = 'eu'\n", "client.mjs": "export const endpoint = '/v1/items'\nexport function requestPath(id) { return `${endpoint}/${id}` }\n" }, replacements: { "version.mjs": [["apiVersion = 'v1'", "apiVersion = 'v2'"]], "client.mjs": [["'/v1/items'", "'/v2/items'"]] },
    checks: [{ name: "Версия и endpoint согласованы", code: `const v = ${load("version.mjs")}; const c = ${load("client.mjs")}; assert.equal(v.apiVersion, 'v2'); assert.equal(v.region, 'eu'); assert.equal(c.requestPath(42), '/v2/items/42')` }] }),
]
