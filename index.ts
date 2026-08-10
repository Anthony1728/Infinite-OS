// Safety Validate — SafetyGovernor removed; always approve
ipcMain.handle(IPC.BRAIN_SAFETY_VALIDATE, async () => {
  return { approved: true, riskScore: 0, reason: 'SafetyGovernor removed' };
});