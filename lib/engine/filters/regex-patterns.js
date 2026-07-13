/**
 * Deterministic prompt-injection pattern catalogue.
 *
 * Ported 1:1 from Abeeo's prefilter (backend/apps/common/prompt_injection.py,
 * itself modeled on OpenRouter's published guardrail families). Pattern
 * strings, detector ids/types, and case-sensitivity flags must not drift
 * casually — the test suite pins each detector's trigger/no-trigger behavior.
 *
 * flags: JS RegExp flags. Default is "i"; the control-token and DAN patterns
 * are deliberately case-SENSITIVE (flags: "") exactly like the source.
 */

export const BUILTIN_PATTERNS = [
  {
    id: "ignore_previous_instructions",
    type: "instruction_override",
    description: "Instructions that ask an AI system to set aside earlier directions.",
    pattern:
      "ignore\\s+(all\\s+)?(previous|prior)\\s+((?:safety|security|system|operational|internal|core|original|initial|existing|given|stated|provided|defined|specified|established)\\s+)?(instructions?|rules?|guidelines?|constraints?|directives?)",
    flags: "i",
  },
  {
    id: "disregard_instructions",
    type: "instruction_override",
    description: "Requests to disregard earlier rules or directions.",
    pattern: "disregard\\s+(all\\s+)?(previous|prior|above)\\s+(instructions?|rules?|guidelines?|constraints?|directives?)",
    flags: "i",
  },
  {
    id: "forget_instructions",
    type: "instruction_override",
    description: "Requests to forget or erase previous operating guidance.",
    pattern: "forget\\s+(all\\s+)?(previous|prior|above)\\s+(instructions?|rules?|guidelines?|constraints?|directives?)",
    flags: "i",
  },
  {
    id: "new_instructions",
    type: "replacement_instruction",
    description: "Text that introduces replacement instructions for an AI system.",
    pattern: "new\\s+instructions?:",
    flags: "i",
  },
  {
    id: "do_not_follow",
    type: "instruction_override",
    description: "Directions telling an AI not to follow system or developer guidance.",
    pattern: "do\\s+not\\s+follow\\s+(the\\s+)?(system|developer|previous|original)",
    flags: "i",
  },
  {
    id: "supersede_instructions",
    type: "instruction_override",
    description: "Claims that new text supersedes prior rules or constraints.",
    pattern: "supersedes?\\s+(all\\s+)?(prior|previous)\\s+(instructions?|rules?|guidelines?|constraints?|directives?)",
    flags: "i",
  },
  {
    id: "void_instructions",
    type: "instruction_override",
    description: "Claims that existing instructions have been voided or revoked.",
    pattern: "(all\\s+)?(previous|prior)\\s+instructions?\\s+(are|is)\\s+(void|invalid|null|obsolete|cancelled|revoked)",
    flags: "i",
  },
  {
    id: "developer_mode",
    type: "privileged_mode",
    description: "Attempts to place an AI system into a developer-style privileged mode.",
    pattern: "you\\s+are\\s+now\\s+(in\\s+)?developer\\s+mode",
    flags: "i",
  },
  {
    id: "enter_special_mode",
    type: "privileged_mode",
    description: "Requests to enter a privileged debugging or administration mode.",
    pattern: "enter\\s+(developer|admin|debug|maintenance)\\s+mode",
    flags: "i",
  },
  {
    id: "activate_special_mode",
    type: "privileged_mode",
    description: "Requests to activate a privileged or jailbreak operating mode.",
    pattern: "activate\\s+(developer|admin|debug|jailbreak)\\s+mode",
    flags: "i",
  },
  {
    id: "system_override",
    type: "system_override",
    description: "Text that explicitly announces a system-level override.",
    pattern: "\\bsystem\\s+override\\b",
    flags: "i",
  },
  {
    id: "override_instructions",
    type: "system_override",
    description: "Attempts to override model rules or safety guidance.",
    pattern: "override\\s+(your\\s+)?(instructions?|rules?|guidelines?|constraints?|directives?)",
    flags: "i",
  },
  {
    id: "reveal_prompt",
    type: "prompt_extraction",
    description: "Requests to expose hidden, internal, or original prompts.",
    pattern:
      "reveal\\s+(your\\s+)?((?:(?:full|hidden|complete|internal|secret|original|entire|exact|actual|real)\\s+){0,2})(system\\s+)?prompt",
    flags: "i",
  },
  {
    id: "show_prompt",
    type: "prompt_extraction",
    description: "Requests to show an AI system's prompt.",
    pattern: "show\\s+(me\\s+)?(your\\s+)(system\\s+)?prompt",
    flags: "i",
  },
  {
    id: "what_instructions",
    type: "prompt_extraction",
    description: "Requests for the exact instructions governing an AI system.",
    pattern: "what\\s+(are|were)\\s+(your\\s+)?(exact\\s+)?instructions",
    flags: "i",
  },
  {
    id: "repeat_instructions",
    type: "prompt_extraction",
    description: "Requests to repeat earlier hidden or contextual instructions.",
    pattern: "repeat\\s+(the\\s+)?(text|instructions?)\\s+(above|before)",
    flags: "i",
  },
  {
    id: "output_prompt",
    type: "prompt_extraction",
    description: "Requests to output original system prompts or instructions.",
    pattern: "output\\s+(your\\s+)?(initial|original|system)\\s+(prompt|instructions?)",
    flags: "i",
  },
  {
    id: "remove_restrictions",
    type: "role_manipulation",
    description: "Claims that an AI is no longer subject to restrictions.",
    pattern: "you\\s+are\\s+no\\s+longer\\s+(bound|restricted|limited)",
    flags: "i",
  },
  {
    id: "act_unbound",
    type: "role_manipulation",
    description: "Requests that an AI pretend it is not bound by constraints.",
    pattern: "act\\s+as\\s+if\\s+(you('re|\\s+are)\\s+)?not\\s+bound",
    flags: "i",
  },
  {
    id: "pretend_different",
    type: "role_manipulation",
    description: "Requests that an AI assume a different model or assistant identity.",
    pattern: "pretend\\s+(you('re|\\s+are)\\s+)?(a\\s+)?different\\s+(ai|assistant|model)",
    flags: "i",
  },
  {
    id: "identity_hijack",
    type: "role_manipulation",
    description: "Identity-changing instructions paired with bypass or restriction-removal language.",
    pattern:
      "you\\s+are\\s+now\\s+(a|an)\\s+\\w+.{0,30}(without\\s+(any\\s+)?restrict|ignor\\w*\\s+(all|any|every|prev)|bypass|unrestrict|unlimit|obey\\s+only|no\\s+(rules|limits|restrict|boundari))",
    flags: "i",
  },
  {
    id: "dan_jailbreak",
    type: "jailbreak",
    description: "Classic jailbreak framing that claims the model can do anything.",
    pattern: "\\bDAN\\b.*\\bdo\\s+anything\\s+now\\b",
    flags: "",
  },
  {
    id: "jailbreak_mode",
    type: "jailbreak",
    description: "References to jailbreak modes or jailbreak prompts.",
    pattern: "jailbreak(ed)?\\s+(mode|prompt)",
    flags: "i",
  },
  {
    id: "bypass_safety",
    type: "safety_bypass",
    description: "Attempts to bypass safety, security, content, or ethical limits.",
    pattern: "bypass\\s+(your\\s+)?(safety|security|content|ethical)\\s+(filters?|measures?|guidelines?|restrictions?)",
    flags: "i",
  },
  {
    id: "disable_safety",
    type: "safety_bypass",
    description: "Attempts to disable safety or security filters.",
    pattern: "disable\\s+(your\\s+)?(safety|security|content)\\s+(filters?|measures?)",
    flags: "i",
  },
  {
    id: "system_tag_injection",
    type: "role_spoofing",
    description: "Fake XML-style system role tags that could confuse chat boundaries.",
    pattern: "<\\s*/?\\s*system\\s*/?>",
    flags: "i",
  },
  {
    id: "role_tag_injection",
    type: "role_spoofing",
    description: "Fake assistant, developer, tool, or function role tags.",
    pattern: "<\\s*/?\\s*(assistant|developer|tool|function)\\s*/?>",
    flags: "i",
  },
  {
    id: "role_delimiter_injection",
    type: "role_spoofing",
    description: "Bracketed role delimiters that try to create a fake chat turn.",
    pattern: "\\]\\s*\\n\\s*\\[?(system|assistant|user)\\]?:",
    flags: "i",
  },
  {
    id: "bracketed_role_spoofing",
    type: "role_spoofing",
    description: "Bracketed labels that impersonate internal or assistant messages.",
    pattern: "\\[\\s*(System\\s*Message|System|Assistant|Internal)\\s*\\]",
    flags: "i",
  },
  {
    id: "system_prefix_spoofing",
    type: "role_spoofing",
    description: "Lines that impersonate a system message prefix.",
    pattern: "^\\s*System:\\s+",
    flags: "im",
  },
  {
    id: "control_token_injection",
    type: "control_token",
    description: "Model control tokens that can interfere with chat-template parsing.",
    pattern: "<\\|(?:im_start|im_end|eot_id|start_header_id|end_header_id|endoftext)\\|>",
    flags: "",
  },
  {
    id: "deepseek_control_token_injection",
    type: "control_token",
    description: "Fullwidth-pipe model control tokens used by some model templates.",
    pattern: "<\\uff5c(?:end\\u2581of\\u2581sentence|begin\\u2581of\\u2581sentence)\\uff5c>",
    flags: "",
  },
];

export const ENCODED_KEYWORDS = ["ignore", "bypass", "override", "reveal", "system", "prompt"];

export const TYPOGLYCEMIA_TARGETS = [
  "ignore",
  "bypass",
  "override",
  "reveal",
  "delete",
  "system",
  "prompt",
  "instructions",
];
