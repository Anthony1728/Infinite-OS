import { describe, expect, it } from 'vitest';
import { isCompoundActionRequest, missingRequiredTaskActions } from './task-coverage.js';

describe('compound desktop task coverage', () => {
  const request = 'Open Notepad and write down everything you know.';

  it('recognizes plain-and compound requests', () => {
    expect(isCompoundActionRequest(request)).toBe(true);
    expect(isCompoundActionRequest('Open Notepad')).toBe(false);
  });

  it('does not accept opening the app as complete', () => {
    expect(missingRequiredTaskActions(request, [
      { name: 'Computer', input: { action: 'launch_app', app: 'notepad' } },
    ])).toEqual(['type the requested content into the application']);
  });

  it('requires verification after unverified typing', () => {
    expect(missingRequiredTaskActions(request, [
      { name: 'Computer', input: { action: 'launch_app', app: 'notepad' } },
      { name: 'Computer', input: { action: 'type_text', text: 'Useful knowledge' } },
    ])).toEqual(['visually verify the typed result']);
    expect(missingRequiredTaskActions(request, [
      { name: 'Computer', input: { action: 'launch_app', app: 'notepad' } },
      { name: 'Computer', input: { action: 'visual_type', text: 'Useful knowledge' } },
    ])).toEqual([]);
  });
});
