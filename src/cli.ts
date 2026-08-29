import type { Track } from './types';

export type RepeatMode = 'off' | 'one' | 'all';

// ─── Keep in sync with gui/src/shared/types.ts ControlCommand ─────────────
// Both files define the same discriminated union. If you add or remove a
// variant here, update the GUI copy too, and vice-versa.

export type ControlCommand =
  | { type: 'play'; query: string }
  | { type: 'play-track'; track: Track }
  | { type: 'mute' }
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'toggle' }
  | { type: 'volume'; value: number; relative: boolean }
  | { type: 'seek'; seconds: number }
  | { type: 'now' }
  | { type: 'status' }
  | { type: 'shuffle'; enabled: boolean | null }
  | { type: 'repeat'; mode: RepeatMode }
  | { type: 'favorite'; track?: Track }
  | { type: 'download' }
  | { type: 'queue'; clear: boolean }
  | { type: 'stop' }
  | { type: 'quit' }
  | { type: 'search'; query: string; limit?: number }
  // ─── Extended protocol (GUI integration) ────────────────────────────────
  | { type: 'add-to-queue'; track: Track }
  | { type: 'play-next'; track: Track }
  | { type: 'remove-from-queue'; index: number }
  | { type: 'get-queue' }
  | { type: 'get-state' }
  | { type: 'subscribe' };

export type CliCommand =
  | { action: 'interactive' }
  | { action: 'control'; command: ControlCommand }
  | { action: 'version' }
  | { action: 'help' };

export const CLI_HELP = `Usage:
  ym
  ym -s <song name>          Play the best search result
  ym play <song name>        Play the best search result
  ym <command> [value]       Control the running player

Playback commands:
  mute (m)                   Toggle mute
  next (n)                   Play the next queued song
  prev, previous (p)         Play the previous song
  pause | resume | toggle (t)
  volume <0-100|+N|-N>       Set or adjust volume
  seek <+seconds|-seconds>   Seek relative to the current position
  stop                       Stop playback but keep the player open
  quit (q)                   Close the running player

Mode and library commands:
  shuffle <on|off>           Set shuffle; shuffle (x) toggles it
  repeat <off|one|all>       Set repeat mode
  favorite (f)               Toggle the current song as a favorite
  download (d)               Download the current song

Information commands:
  now (i)                    Show the current song
  status                     Show playback, volume, and queue status
  queue [clear]              Show or clear the queue
  help (h)                   Show this help

Options:
  -s, --search <song name>   Alias for play
  -v, --version              Show the installed version
  -h, --help                 Show this help`;

function requireNoValues(command: string, values: string[]) {
  if (values.length > 0) throw new Error(`${command} does not accept a value.`);
}

function requireQuery(command: string, values: string[]): string {
  const query = values.join(' ').trim();
  if (!query) throw new Error(`${command} requires a song name.`);
  return query;
}

function parseInteger(command: string, value: string | undefined): number {
  if (!value || !/^[+-]?\d+$/.test(value)) {
    throw new Error(`${command} requires a whole number.`);
  }
  return Number(value);
}

export function parseCliArgs(args: string[]): CliCommand {
  if (args.length === 0) return { action: 'interactive' };

  const [rawCommand, ...values] = args;
  const aliases: Record<string, string> = {
    m: 'mute',
    n: 'next',
    p: 'previous',
    prev: 'previous',
    t: 'toggle',
    i: 'now',
    f: 'favorite',
    d: 'download',
    x: 'shuffle',
    q: 'quit',
    h: 'help',
  };
  const command = aliases[rawCommand!] || rawCommand!;

  if (command === '-v' || command === '--version') {
    requireNoValues(command, values);
    return { action: 'version' };
  }

  if (command === '-h' || command === '--help' || command === 'help') {
    requireNoValues(command, values);
    return { action: 'help' };
  }

  if (command === '-s' || command === '--search' || command === 'play') {
    return {
      action: 'control',
      command: { type: 'play', query: requireQuery(command, values) },
    };
  }

  if (['mute', 'next', 'previous', 'pause', 'resume', 'toggle', 'now', 'status', 'favorite', 'download', 'stop', 'quit', 'get-queue', 'get-state', 'subscribe'].includes(command)) {
    requireNoValues(command, values);
    return { action: 'control', command: { type: command as 'mute' | 'next' | 'previous' | 'pause' | 'resume' | 'toggle' | 'now' | 'status' | 'favorite' | 'download' | 'stop' | 'quit' | 'get-queue' | 'get-state' | 'subscribe' } };
  }

  if (command === 'volume') {
    if (values.length !== 1) throw new Error('volume requires exactly one value.');
    const rawValue = values[0]!;
    const value = parseInteger('volume', rawValue);
    const relative = rawValue.startsWith('+') || rawValue.startsWith('-');
    if (!relative && (value < 0 || value > 100)) {
      throw new Error('volume must be between 0 and 100.');
    }
    return { action: 'control', command: { type: 'volume', value, relative } };
  }

  if (command === 'seek') {
    if (values.length !== 1 || !/^[+-]\d+$/.test(values[0]!)) {
      throw new Error('seek requires a relative value such as +10 or -10.');
    }
    return { action: 'control', command: { type: 'seek', seconds: Number(values[0]) } };
  }

  if (command === 'shuffle') {
    if (values.length === 0) {
      return { action: 'control', command: { type: 'shuffle', enabled: null } };
    }
    if (values.length !== 1 || !['on', 'off'].includes(values[0]!)) {
      throw new Error('shuffle requires on or off.');
    }
    return { action: 'control', command: { type: 'shuffle', enabled: values[0] === 'on' } };
  }

  if (command === 'repeat') {
    if (values.length !== 1 || !['off', 'one', 'all'].includes(values[0]!)) {
      throw new Error('repeat requires off, one, or all.');
    }
    return { action: 'control', command: { type: 'repeat', mode: values[0] as RepeatMode } };
  }

  if (command === 'queue') {
    if (values.length === 0) return { action: 'control', command: { type: 'queue', clear: false } };
    if (values.length === 1 && values[0] === 'clear') {
      return { action: 'control', command: { type: 'queue', clear: true } };
    }
    throw new Error('queue accepts only the optional clear command.');
  }

  throw new Error(`Unknown command: ${rawCommand}`);
}
