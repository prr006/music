export {
  ControlServer,
  ControlUnavailableError,
  sendControlCommand,
  type ControlResponse,
  type ControlHandler,
} from './melo/ipc/control-server';

export type ControlDataResponse = import('./melo/ipc/control-server').ControlResponse;
