import { createConnection } from 'net';

const userId = (process.env.USERNAME || 'user').replace(/[^a-zA-Z0-9_-]/g, '_');
const pipePath = `\\\\.\\pipe\\ytmusic-player-control-${userId}`;

console.log('USERNAME:', process.env.USERNAME);
console.log('userId:', userId);
console.log('Pipe path:', JSON.stringify(pipePath));

const socket = createConnection(pipePath);

socket.on('connect', () => {
  console.log('CONNECTED to pipe!');
  socket.write(JSON.stringify({ type: 'get-state', request_id: 999 }) + '\n');
});

socket.on('data', (d) => {
  const text = d.toString();
  console.log('Response:', text.substring(0, 300));
  socket.destroy();
  process.exit(0);
});

socket.on('error', (e) => {
  console.log('ERROR:', e.message);
  process.exit(1);
});

setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 5000);
