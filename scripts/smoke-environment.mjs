import path from "node:path"

export function createSmokeEnvironment(root, inherited = process.env) {
  const environment = Object.fromEntries(Object.entries(inherited).filter(([key]) => !key.toUpperCase().startsWith("OPENCODE_")))
  return {
    ...environment,
    HOME: root, USERPROFILE: root, OPENCODE_TEST_HOME: root,
    XDG_CONFIG_HOME: path.join(root, "config"), XDG_DATA_HOME: path.join(root, "data"),
    XDG_CACHE_HOME: path.join(root, "cache"), XDG_STATE_HOME: path.join(root, "state"),
    OPENCODE_CONFIG_DIR: path.join(root, "config", "opencode"),
    OPENCODE_DISABLE_MODELS_FETCH: "1", OPENCODE_DISABLE_AUTOUPDATE: "1",
  }
}