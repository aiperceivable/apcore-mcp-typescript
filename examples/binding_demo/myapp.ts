/**
 * Plain business logic — NO apcore imports, NO framework dependencies.
 *
 * This file represents an existing project's code that we want to expose
 * as MCP tools without modifying a single line.
 */

export function convert_temperature(
  value: number,
  from_unit: string = "celsius",
  to_unit: string = "fahrenheit",
): Record<string, unknown> {
  // Normalize to Celsius first
  let celsius: number;
  if (from_unit === "celsius") {
    celsius = value;
  } else if (from_unit === "fahrenheit") {
    celsius = (value - 32) * 5 / 9;
  } else if (from_unit === "kelvin") {
    celsius = value - 273.15;
  } else {
    throw new Error(`Unknown unit: ${from_unit}`);
  }

  // Convert from Celsius to target
  let result: number;
  if (to_unit === "celsius") {
    result = celsius;
  } else if (to_unit === "fahrenheit") {
    result = celsius * 9 / 5 + 32;
  } else if (to_unit === "kelvin") {
    result = celsius + 273.15;
  } else {
    throw new Error(`Unknown unit: ${to_unit}`);
  }

  return {
    input: `${value} ${from_unit}`,
    output: `${Math.round(result * 100) / 100} ${to_unit}`,
    result: Math.round(result * 100) / 100,
  };
}

export function word_count(text: string): Record<string, unknown> {
  const words = text.split(/\s+/).filter(Boolean);
  return {
    words: words.length,
    characters: text.length,
    lines: text ? text.split("\n").length : 0,
  };
}
