import { ComputerControlAgent } from './computer.js';

let instance: ComputerControlAgent | null = null;

export function getComputerControl(): ComputerControlAgent {
  if (!instance) {
    instance = new ComputerControlAgent();
  }
  return instance;
}
