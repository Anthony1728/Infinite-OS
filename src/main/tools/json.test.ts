import { describe, expect, it } from 'vitest';
import { jsonTool } from './json.js';
import { queryPath } from './json.js';

function exec(action: string, args: Record<string, unknown>) {
  return jsonTool.execute({ action, ...args }, {} as never);
}

describe('Json tool', () => {
  it('parses and stringifies with stable output', async () => {
    const parsed = await exec('parse', { input: '{"a":1,"b":[1,2,3]}' });
    expect(parsed.is_error).toBeUndefined();
    const value = JSON.parse(String(parsed.content)).value;
    expect(value).toEqual({ a: 1, b: [1, 2, 3] });

    const stringified = await exec('stringify', { value: '{"a":1}' });
    expect(String(stringified.content)).toBe('{\n  "a": 1\n}');
  });

  it('reports invalid JSON instead of throwing', async () => {
    const result = await exec('parse', { input: '{oops' });
    expect(result.is_error).toBe(true);
    expect(String(result.content)).toContain('JSON');
  });

  it('validates good and bad input', async () => {
    const good = await exec('validate', { input: '{"ok":true}' });
    expect(JSON.parse(String(good.content)).valid).toBe(true);
    const bad = await exec('validate', { input: 'not json' });
    expect(JSON.parse(String(bad.content)).valid).toBe(false);
  });

  it('queries nested dot paths and wildcards', async () => {
    const input = JSON.stringify({ users: [{ name: 'Ada' }, { name: 'Grace' }] });
    const single = await exec('query', { input, path: 'users.1.name' });
    expect(JSON.parse(String(single.content)).value).toBe('Grace');

    const wildcard = await exec('query', { input, path: 'users[*].name' });
    expect(JSON.parse(String(wildcard.content)).value).toEqual(['Ada', 'Grace']);
  });

  it('queryPath handles bracket notation and missing paths', () => {
    expect(queryPath({ a: [10, 20] }, 'a[1]')).toEqual({ found: true, value: 20 });
    expect(queryPath({ a: 1 }, 'b.c').found).toBe(false);
    expect(queryPath({ a: [{ x: 1 }, { x: 2 }] }, 'a[*].x').value).toEqual([1, 2]);
  });

  it('converts CSV to JSON rows', async () => {
    const result = await exec('csv_to_json', { input: 'name,age\nAda,36\nGrace,45' });
    const { headers, rows } = JSON.parse(String(result.content));
    expect(headers).toEqual(['name', 'age']);
    expect(rows).toEqual([{ name: 'Ada', age: 36 }, { name: 'Grace', age: 45 }]);
  });

  it('converts JSON rows to CSV with quoting', async () => {
    const result = await exec('json_to_csv', { array: [{ name: 'Ada, Lovelace', age: 36 }] });
    expect(String(result.content)).toBe('name,age\n"Ada, Lovelace",36');
  });

  it('deep-merges objects and concatenates arrays', async () => {
    const result = await exec('merge', { input: '{"a":1,"nested":{"x":1},"list":[1]}', data: '{"b":2,"nested":{"y":2},"list":[2]}' });
    expect(JSON.parse(String(result.content))).toEqual({ a: 1, b: 2, nested: { x: 1, y: 2 }, list: [1, 2] });
  });

  it('flattens and unflattens round-trip', async () => {
    const original = { a: { b: { c: 1 } }, arr: [{ x: 1 }, { x: 2 }] };
    const flat = await exec('flatten', { data: JSON.stringify(original) });
    const flatValue = JSON.parse(String(flat.content));
    expect(flatValue['a.b.c']).toBe(1);
    expect(flatValue['arr.0.x']).toBe(1);

    const unflattened = await exec('unflatten', { data: JSON.stringify(flatValue) });
    expect(JSON.parse(String(unflattened.content))).toEqual({ a: { b: { c: 1 } }, arr: [{ x: 1 }, { x: 2 }] });
  });

  it('extracts JSON embedded in larger text', async () => {
    const result = await exec('extract', { input: 'Here is the data: {"answer": 42} and trailing text' });
    expect(JSON.parse(String(result.content)).value).toEqual({ answer: 42 });

    const none = await exec('extract', { input: 'no json here' });
    expect(none.is_error).toBe(true);
  });
});
