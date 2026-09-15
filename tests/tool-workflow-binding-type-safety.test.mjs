import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertCurrentWorkflowBindingTypeSafety,
  schemaAssignable
} from '../src/tool-workflow-binding-type-safety.mjs';

test('current workflow bindings and selections are type-compatible with canonical tool schemas', () => {
  assert.equal(assertCurrentWorkflowBindingTypeSafety(), true);
});

test('schema assignability rejects explicit primitive and collection contradictions', () => {
  assert.equal(schemaAssignable({ type: 'string' }, { type: 'string' }), true);
  assert.equal(schemaAssignable({ type: 'string' }, { type: 'array', items: { type: 'string' } }), false);
  assert.equal(schemaAssignable({ type: 'array', items: { type: 'string' } }, { type: 'array', items: { type: 'string' } }), true);
  assert.equal(schemaAssignable({ type: 'array', items: { type: 'number' } }, { type: 'array', items: { type: 'string' } }), false);
  assert.equal(schemaAssignable({ type: 'integer' }, { type: 'number' }), true);
  assert.equal(schemaAssignable({ type: 'number' }, { type: 'integer' }), false);
});

test('schema assignability treats nullable source branches as absent-capable and validates non-null values', () => {
  const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] };
  assert.equal(schemaAssignable(nullableString, { type: 'string' }), true);
  assert.equal(schemaAssignable(nullableString, { type: 'number' }), false);
});

test('schema assignability honors target enum restrictions without rejecting open schemas', () => {
  assert.equal(schemaAssignable({ type: 'string', enum: ['a'] }, { type: 'string', enum: ['a', 'b'] }), true);
  assert.equal(schemaAssignable({ type: 'string', enum: ['a', 'c'] }, { type: 'string', enum: ['a', 'b'] }), false);
  assert.equal(schemaAssignable({ type: 'string' }, { type: 'string', enum: ['a', 'b'] }), false);
  assert.equal(schemaAssignable({}, { type: 'string' }), true);
  assert.equal(schemaAssignable({ type: 'string' }, {}), true);
});
