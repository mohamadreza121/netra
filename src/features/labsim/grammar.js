// Each command declares keyword and argument positions for execution, help and completion.
const lex = /"[^"]*"|'[^']*'|[^\s]+/g;
export const tokens = input => (input.match(lex) ?? []).map(raw => ({
  raw, value: raw.replace(/^(['"])(.*)\1$/, '$2')
}));
const parameter = word => word.startsWith('<');
const rest = word => word.endsWith('...>');
const matchesKeyword = (word, prefix) => !parameter(word) && word.startsWith(prefix);
const expand = pattern => {
  const option = /\[([^\]]+)\]/.exec(pattern);
  if (!option) return [pattern.trim().split(/\s+/)];
  return ['', option[1]].flatMap(value => expand(pattern.slice(0, option.index) + value + pattern.slice(option.index + option[0].length)));
};

export function compile(patterns) {
  return patterns.flatMap(expand);
}

function walk(commands, input) {
  let candidates = commands;
  const args = [];
  for (const {raw, value} of tokens(input)) {
    const prefix = raw.toLowerCase();
    const keywords = [...new Set(candidates.map(row => row[0]).filter(word => word && matchesKeyword(word, prefix)))];
    const exact = keywords.includes(prefix) ? prefix : undefined;
    if (!exact && keywords.length > 1) return { error:'Ambiguous command. Matches: '+keywords.sort().join(', ') };
    const keyword = exact ?? keywords[0];
    if (keyword) {
      candidates = candidates.filter(row => row[0] === keyword).map(row => row.slice(1));
      args.push(keyword);
      continue;
    }
    candidates = candidates.filter(row => row[0] && parameter(row[0])).flatMap(row => rest(row[0]) ? [row,row.slice(1)] : [row.slice(1)]);
    if (!candidates.length) return { error:'Invalid input. Type ? for commands in this mode.' };
    args.push(value);
  }
  return {candidates, args};
}

export function resolve(commands, input) {
  const result = walk(commands, input);
  if (result.error) return result;
  if (!result.candidates.some(row => !row.length)) return {error:'Incomplete command. Use a space followed by ? for the next arguments.'};
  return {args:result.args};
}

export function assist(commands, input) {
  const match = input.match(/\S+$/);
  const attached = match && !match[0].includes('"') && !match[0].includes("'");
  const start = attached ? match.index : input.length;
  const prefix = attached ? match[0].toLowerCase() : '';
  const result = walk(commands, input.slice(0, start));
  if (result.error) return {text:'% '+result.error};
  const choices = [...new Set(result.candidates.map(row => row[0] ?? '<cr>'))].sort();
  const options = prefix ? choices.filter(word => matchesKeyword(word, prefix)) : choices;
  const keywords = options.filter(word => !parameter(word));
  const completed = prefix && keywords.length === 1 ? input.slice(0, start) + keywords[0] + ' ' : undefined;
  return {text:options.join('\n') || '% No matching keywords.', completed};
}
