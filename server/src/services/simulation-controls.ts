export type SimulationName = "marketMaker" | "ticker";

export interface SimulationStatus {
  available: boolean;
  running: boolean;
}

export interface SimulationControlsResponse {
  marketMaker: SimulationStatus;
  ticker: SimulationStatus;
}

type PauseHandler = (paused: boolean) => void;

export class SimulationControls {
  private readonly handlers = new Map<SimulationName, PauseHandler>();
  private readonly paused = new Map<SimulationName, boolean>();

  register(name: SimulationName, handler: PauseHandler): () => void {
    this.handlers.set(name, handler);
    this.paused.set(name, false);
    handler(false);
    return () => {
      if (this.handlers.get(name) === handler) {
        this.handlers.delete(name);
        this.paused.delete(name);
      }
    };
  }

  setRunning(name: SimulationName, running: boolean): void {
    const handler = this.handlers.get(name);
    if (handler === undefined) {
      throw new Error(`Simulation ${name} is unavailable`);
    }
    this.paused.set(name, !running);
    handler(!running);
  }

  getStatus(): SimulationControlsResponse {
    const status = (name: SimulationName): SimulationStatus => ({
      available: this.handlers.has(name),
      running: this.handlers.has(name) && this.paused.get(name) !== true
    });
    return {
      marketMaker: status("marketMaker"),
      ticker: status("ticker")
    };
  }
}
