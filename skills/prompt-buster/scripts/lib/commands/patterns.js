import { parseCommandArgs, UsageError } from "../args.js";
import { emit, emitError, outputMode, EXIT } from "../output.js";
import { loadConfig, saveGlobalConfigValue, validateCustomPattern, ConfigError } from "../config.js";
import { BUILTIN_PATTERNS } from "../engine/filters/regex-patterns.js";
import { check, effectivePatterns } from "../engine/filters/regex.js";

export async function run(argv) {
  const { flags, positionals } = parseCommandArgs(argv, {
    id: { type: "string" },
    type: { type: "string" },
    description: { type: "string" },
    pattern: { type: "string" },
    flags: { type: "string" },
  });
  const [action, ...rest] = positionals;
  const mode = outputMode(flags);
  const config = loadConfig();

  try {
    switch (action) {
      case "list":
      case undefined: {
        const disabled = new Set(config.filters.regex.disabled);
        const builtins = BUILTIN_PATTERNS.map((p) => ({ id: p.id, type: p.type, disabled: disabled.has(p.id) }));
        const custom = config.filters.regex.custom.map((p) => ({ id: p.id, type: p.type || "custom", custom: true }));
        emit({ builtins, custom }, { mode, text: renderList(builtins, custom) });
        return EXIT.OK;
      }
      case "add": {
        const spec = {
          id: flags.id,
          type: flags.type || "custom",
          description: flags.description || "User-defined prompt-injection pattern.",
          pattern: flags.pattern,
          flags: flags.flags || "i",
        };
        validateCustomPattern(spec);
        const existing = config.filters.regex.custom.filter((p) => p.id !== spec.id);
        const file = saveGlobalConfigValue("filters.regex.custom", [...existing, spec]);
        emit({ added: spec.id, file }, { mode, text: `added pattern ${spec.id}` });
        return EXIT.OK;
      }
      case "remove": {
        const id = rest[0] || flags.id;
        if (!id) throw new UsageError("patterns remove <id>");
        const isBuiltin = BUILTIN_PATTERNS.some((p) => p.id === id);
        if (isBuiltin) {
          const disabled = Array.from(new Set([...config.filters.regex.disabled, id]));
          saveGlobalConfigValue("filters.regex.disabled", disabled);
          emit({ disabled: id }, { mode, text: `disabled built-in pattern ${id}` });
        } else {
          const remaining = config.filters.regex.custom.filter((p) => p.id !== id);
          saveGlobalConfigValue("filters.regex.custom", remaining);
          emit({ removed: id }, { mode, text: `removed custom pattern ${id}` });
        }
        return EXIT.OK;
      }
      case "test": {
        const text = rest.join(" ") || flags.text;
        if (!text) throw new UsageError('patterns test "<text>"');
        const result = await check(text, { config });
        emit(
          { triggered: result.triggered, findings: result.findings },
          { mode, text: result.triggered ? `TRIGGERED: ${result.findings.map((f) => `${f.detectorId}(${f.source})`).join(", ")}` : "no match" },
        );
        return result.triggered ? EXIT.FLAGGED : EXIT.OK;
      }
      case "count": {
        emit({ count: effectivePatterns(config).length }, { mode, text: String(effectivePatterns(config).length) });
        return EXIT.OK;
      }
      default:
        throw new UsageError(`unknown patterns action "${action}" (list|add|remove|test|count)`);
    }
  } catch (error) {
    if (error instanceof UsageError) throw error;
    if (error instanceof ConfigError) return emitError(error.message, { code: "pattern_error", exitCode: EXIT.ERROR });
    throw error;
  }
}

function renderList(builtins, custom) {
  const lines = [`built-in patterns (${builtins.length}):`];
  for (const p of builtins) lines.push(`  ${p.disabled ? "✗" : "✓"} ${p.id} [${p.type}]`);
  if (custom.length) {
    lines.push("", `custom patterns (${custom.length}):`);
    for (const p of custom) lines.push(`  + ${p.id} [${p.type}]`);
  }
  return lines.join("\n");
}
