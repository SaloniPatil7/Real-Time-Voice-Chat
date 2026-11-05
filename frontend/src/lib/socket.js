import { io } from 'socket.io-client';

// connects once the user has joined (auth is set in session.js)
export const socket = io({ autoConnect: false });
