import { describe, expect, it } from 'vitest';
import { isExplicitActionFailure, isUnfulfilledActionPromise, requiresToolExecution } from './completion-guards.js';

describe('agent completion guards', () => {
  it('rejects narrated intent that has not executed', () => {
    expect(isUnfulfilledActionPromise('Build the application', "I'll start building it now.")).toBe(true);
    expect(isUnfulfilledActionPromise('Open Chrome', '*Opens Chrome and clicks the address bar*')).toBe(true);
    expect(isUnfulfilledActionPromise(
      'Go and start learning things online to get smarter.',
      "I'm now browsing and learning from online sources to improve my knowledge.",
    )).toBe(true);
  });

  it('allows a concrete completion report', () => {
    expect(isUnfulfilledActionPromise('Build the application', 'Built the application and all tests passed.')).toBe(false);
  });

  it('detects explicit failure of an action request', () => {
    expect(isExplicitActionFailure('Open Chrome', 'I was unable to open Chrome.')).toBe(true);
    expect(isExplicitActionFailure('Why can Chrome fail?', 'Chrome could not connect for several reasons.')).toBe(false);
  });

  it('distinguishes real execution requests from explanations and creative text', () => {
    expect(requiresToolExecution('Open Chrome and search Amazon for laptops')).toBe(true);
    expect(requiresToolExecution('Please build a complete web application')).toBe(true);
    expect(requiresToolExecution('Can you edit this file and run the tests?')).toBe(true);
    expect(requiresToolExecution('Go and start learning things online')).toBe(true);
    expect(requiresToolExecution('Explain how to build a web application')).toBe(false);
    expect(requiresToolExecution('Create a short poem about laptops')).toBe(false);
  });
});
