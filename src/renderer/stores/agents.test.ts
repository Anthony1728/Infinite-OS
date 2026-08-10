import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAgentsStore } from './agents';

describe('task status truthfulness', () => {
  beforeEach(() => {
    useAgentsStore.setState({ types: [], runs: [], chatTasks: [], subTasks: [] });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('does not overwrite a failed task with a late completion event', () => {
    const id = useAgentsStore.getState().addChatTask('Build and validate an app');
    useAgentsStore.getState().failChatTask(id, 'Build failed');
    useAgentsStore.getState().completeChatTask(id);

    expect(useAgentsStore.getState().chatTasks[0]).toMatchObject({
      id,
      status: 'failed',
      error: 'Build failed',
    });
  });

  it('does not overwrite a completed task with a late failure event', () => {
    const id = useAgentsStore.getState().addChatTask('Answer a question');
    useAgentsStore.getState().completeChatTask(id);
    useAgentsStore.getState().failChatTask(id, 'Late event');

    expect(useAgentsStore.getState().chatTasks[0]).toMatchObject({ id, status: 'completed' });
  });

  it('starts every chat task in the working state', () => {
    const id = useAgentsStore.getState().addChatTask('Control the computer');
    expect(useAgentsStore.getState().chatTasks[0]).toMatchObject({ id, status: 'working' });
  });

  it('cancels an agent by its backend run id', async () => {
    const abortAgent = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('window', { api: { abortAgent } });
    useAgentsStore.setState({
      runs: [{
        id: 'run-1',
        agentId: 'code',
        sessionId: 'session-1',
        status: 'running',
        task: 'Build app',
        startedAt: Date.now(),
        toolCallCount: 0,
      }],
    });

    await useAgentsStore.getState().abort('run-1');

    expect(abortAgent).toHaveBeenCalledWith({ runId: 'run-1' });
    expect(useAgentsStore.getState().runs[0].status).toBe('cancelled');
  });
});
