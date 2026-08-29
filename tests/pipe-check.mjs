import { createConnection } from 'net';
const userId = (process.env.USERNAME || 'user').replace(/[^a-zA-Z0-9_-]/g, '_');
const pipePath = `\\\\.\\pipe\\ytmusic-player-control-${userId}`;
console.log('Pipe:', pipePath);
const socket = createConnection(pipePath);
socket.on('connect', () => {
  console.log('PIPE ALIVE');
  socket.write(JSON.stringify({type:'get-state',request_id:1}) + '\n');
});
socket.on('data', (d) => {
  console.log('Response:', d.toString().substring(0, 150));
  socket.destroy();
  process.exit(0);
});
socket.on('error', (e) => { console.log('ERROR:', e.message); process.exit(1); });
setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 5000);
