export type LogArea = 'search' | 'youtube' | 'playback' | 'queue' | 'radio' | 'ipc' | 'persist' | 'app';

function write(stream: NodeJS.WriteStream, area: LogArea, message: string) {
  stream.write(`[melo:${area}] ${message}\n`);
}

export function log(area: LogArea, message: string) {
  write(process.stdout, area, message);
}

export function logError(area: LogArea, message: string) {
  write(process.stderr, area, message);
}
