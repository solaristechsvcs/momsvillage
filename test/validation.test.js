import test from 'node:test';
import assert from 'node:assert/strict';
import { text, id, image, price } from '../validation.js';
test('text enforces required strings and limits without coercing objects', () => {
  assert.equal(text('  hello  ', 5), 'hello');
  assert.equal(text('', 5, false), '');
  for (const value of ['', null, {}, [], 'longer']) assert.throws(() => text(value, 5), { status: 400 });
});
test('IDs reject SQL fragments, negative numbers, decimals and unsafe integers', () => {
  assert.equal(id('123'), 123);
  for (const value of ['1 OR 1=1', '-1', '0', '1.5', '9007199254740993', undefined]) assert.throws(() => id(value), { status: 400 });
});
test('image URLs disallow executable schemes and embedded credentials', () => {
  assert.equal(image('https://example.com/image.jpg'), 'https://example.com/image.jpg');
  assert.equal(image(undefined), '');
  for (const value of ['javascript:alert(1)', 'data:image/svg+xml,test', 'http://example.com/a', 'https://name:secret@example.com/a']) assert.throws(() => image(value), { status: 400 });
});
test('prices enforce nonnegative decimal currency and database bounds', () => {
  assert.equal(price('0'), 0); assert.equal(price('999999.99'), 999999.99); assert.equal(price('15.50'), 15.5);
  for (const value of ['-1', 'NaN', 'Infinity', '1e5', '1.001', '1000000', '', null]) assert.throws(() => price(value), { status: 400 });
});
