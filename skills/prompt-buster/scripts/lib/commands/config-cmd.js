import { parseCommandArgs, UsageError } from "../args.js";
import { emit, emitError, outputMode, EXIT } from "../output.js";
import { loadConfig, saveGlobalConfigValue, deleteGlobalConfigValue, getPath, defaultConfig, ConfigError } from "../config.js";
import { configPath } from "../paths.js";

export async function run(argv) {
  const { flags, positionals } = parseCommandArgs(argv, {});
  const [action, key, ...rest] = positionals;
  const mode = outputMode(flags);

  try {
    switch (action) {
      case "get": {
        if (!key) throw new UsageError("config get <key>");
        const value = getPath(loadConfig(), key);
        emit({ key, value }, { mode, text: JSON.stringify(value) });
        return EXIT.OK;
      }
      case "set": {
        if (!key || rest.length === 0) throw new UsageError('config set <key> <json-value>');
        const value = parseValue(rest.join(" "));
        const file = saveGlobalConfigValue(key, value);
        emit({ set: key, value, file }, { mode, text: `set ${key} in ${file}` });
        return EXIT.OK;
      }
      case "unset": {
        if (!key) throw new UsageError("config unset <key>");
        const file = deleteGlobalConfigValue(key);
        emit({ unset: key, file }, { mode, text: `unset ${key}` });
        return EXIT.OK;
      }
      case "list":
      case undefined: {
        const config = loadConfig();
        const meta = config._meta;
        delete config._meta;
        emit({ config, sources: meta?.sources, warnings: meta?.warnings }, { mode, text: JSON.stringify(config, null, 2) });
        return EXIT.OK;
      }
      case "path": {
        emit({ path: configPath() }, { mode, text: configPath() });
        return EXIT.OK;
      }
      case "defaults": {
        emit({ defaults: defaultConfig() }, { mode, text: JSON.stringify(defaultConfig(), null, 2) });
        return EXIT.OK;
      }
      default:
        throw new UsageError(`unknown config action "${action}" (get|set|unset|list|path|defaults)`);
    }
  } catch (error) {
    if (error instanceof UsageError) throw error;
    if (error instanceof ConfigError) return emitError(error.message, { code: "config_error", exitCode: EXIT.ERROR });
    throw error;
  }
}

function parseValue(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return raw; // bare strings allowed
  }
}
