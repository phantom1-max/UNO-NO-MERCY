import {
  db,
  router,
  json,
  error,
  invites,
  isInviteError,
} from '@appdeploy/sdk';
import {
  notifySubscribers,
  realtimeSubscriptionRoutes,
} from './realtime-subscribers';

type Card = { id: string; color: string; value: string; kind: string };
type Player = {
  id: string;
  name: string;
  hand: Card[];
  host: boolean;
  uno: boolean;
  isCpu?: boolean;
  difficulty?: 'easy' | 'medium' | 'hard' | 'xhard';
};
type Room = {
  id: string;
  inviteCode: string;
  status: 'lobby' | 'playing' | 'finished';
  players: Player[];
  deck: Card[];
  discard: Card[];
  current: number;
  direction: number;
  currentColor: string;
  pendingDraw: number;
  version: number;
  winner?: string;
  message?: string;
};

const TABLE = 'uno_rooms';
const COLORS = ['red', 'yellow', 'green', 'blue'];
const rand = (n: number) => Math.floor(Math.random() * n);
const shuffle = <T>(items: T[]) => {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
function makeDeck(): Card[] {
  const cards: Card[] = [];
  const add = (color: string, value: string, kind: string, count = 1) => {
    for (let i = 0; i < count; i++)
      cards.push({
        id: `c${cards.length}-${rand(999999)}`,
        color,
        value,
        kind,
      });
  };
  for (const color of COLORS) {
    add(color, '0', 'number');
    for (let n = 1; n <= 9; n++) add(color, String(n), 'number', 2);
    add(color, 'SKIP', 'skip', 2);
    add(color, 'REVERSE', 'reverse', 2);
    add(color, '+2', 'draw2', 2);
    add(color, 'SKIP ALL', 'skipall', 1);
    add(color, 'DISCARD ALL', 'discardall', 1);
  }
  add('wild', 'WILD +4', 'draw4', 4);
  add('wild', 'WILD +6', 'draw6', 2);
  add('wild', 'WILD +10', 'draw10', 1);
  add('wild', 'WILD', 'wild', 4);
  add('wild', '7 SWAP', 'swap7', 4);
  add('wild', '0 ROTATE', 'rotate0', 4);
  return shuffle(cards);
}
function publicRoom(room: Room, playerId: string) {
  const me = room.players.find(p => p.id === playerId);
  return {
    id: room.id,
    inviteCode: room.inviteCode,
    status: room.status,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      handCount: p.hand.length,
      host: p.host,
      isCpu: p.isCpu || false,
      difficulty: p.difficulty,
    })),
    hand: me?.hand || [],
    top: room.discard[room.discard.length - 1] || null,
    currentPlayerId: room.players[room.current]?.id || '',
    currentColor: room.currentColor,
    direction: room.direction,
    pendingDraw: room.pendingDraw,
    version: room.version,
    winner: room.winner,
    message: room.message,
    deckCount: room.deck.length,
  };
}
async function getRoom(id: string): Promise<Room | null> {
  const [room] = await db.get<Room>(TABLE, [id], { consistent: true });
  return room;
}
async function saveRoom(room: Room, expectedVersion: number) {
  room.version = expectedVersion + 1;
  const [ok] = await db.tx.update(
    TABLE,
    [{ id: room.id, record: room, if: { version: expectedVersion } }],
    { patch: true }
  );
  if (!ok)
    throw new Error(
      'The table changed at the same time. Refresh and try again.'
    );
}
function nextIndex(room: Room, steps = 1) {
  const count = room.players.length;
  return (room.current + room.direction * steps + count * 10) % count;
}
function drawCards(room: Room, player: Player, count: number) {
  for (let i = 0; i < count; i++) {
    if (!room.deck.length) {
      const top = room.discard.pop();
      room.deck = shuffle(room.discard);
      room.discard = top ? [top] : [];
    }
    const card = room.deck.pop();
    if (card) player.hand.push(card);
  }
}
function advance(room: Room, steps = 1) {
  room.current = nextIndex(room, steps);
}
function removeOut(room: Room) {
  room.players = room.players.filter(p => p.hand.length < 25);
  if (room.players.length <= 1) {
    room.status = 'finished';
    room.winner = room.players[0]?.id || '';
    return;
  }
  room.current = Math.min(room.current, room.players.length - 1);
}
function canPlay(card: Card, room: Room) {
  const top = room.discard[room.discard.length - 1];
  if (room.pendingDraw > 0)
    return (
      card.kind.startsWith('draw') &&
      (card.kind === 'draw' + room.pendingDraw ||
        card.kind === 'draw2' ||
        card.kind === 'draw4' ||
        card.kind === 'draw6' ||
        card.kind === 'draw10')
    );
  return (
    card.color === 'wild' ||
    card.color === room.currentColor ||
    card.value === top?.value
  );
}
function applyCard(
  room: Room,
  player: Player,
  card: Card,
  chosenColor?: string
) {
  const idx = player.hand.findIndex(c => c.id === card.id);
  if (idx < 0) throw new Error('That card is not in your hand.');
  if (!canPlay(card, room)) throw new Error('That card cannot be played now.');
  player.hand.splice(idx, 1);
  room.discard.push(card);
  room.message = `${player.name} played ${card.value}.`;
  if (card.color !== 'wild') room.currentColor = card.color;
  else
    room.currentColor = COLORS.includes(chosenColor || '')
      ? chosenColor!
      : COLORS[rand(4)];
  if (card.kind.startsWith('draw')) {
    const amount =
      card.kind === 'draw2'
        ? 2
        : card.kind === 'draw4'
          ? 4
          : card.kind === 'draw6'
            ? 6
            : 10;
    room.pendingDraw += amount;
    advance(room);
  } else if (room.pendingDraw > 0) advance(room);
  else if (card.kind === 'skip') advance(room, 2);
  else if (card.kind === 'skipall') {
    room.message = `${player.name} skipped everyone!`;
  } else if (card.kind === 'reverse') {
    room.direction *= -1;
    advance(room);
  } else if (card.kind === 'swap7') {
    const target = room.players[(room.current + 1) % room.players.length];
    [player.hand, target.hand] = [target.hand, player.hand];
    room.message = `${player.name} swapped hands with ${target.name}.`;
    advance(room);
  } else if (card.kind === 'rotate0') {
    const hands = room.players.map(p => p.hand);
    room.players.forEach((p, i) => {
      p.hand = hands[(i - room.direction + hands.length) % hands.length];
    });
    room.message = 'All hands rotated!';
    advance(room);
  } else if (card.kind === 'discardall') {
    const removed = player.hand.filter(c => c.color === card.color);
    player.hand = player.hand.filter(c => c.color !== card.color);
    room.discard.push(...removed);
    room.message = `${player.name} cleared every ${card.color} card.`;
    advance(room);
  } else advance(room);
  if (player.hand.length === 0) {
    room.status = 'finished';
    room.winner = player.id;
    room.message = `${player.name} wins the table!`;
  }
  if (player.hand.length >= 25) {
    room.message = `${player.name} hit 25 cards and is out.`;
    removeOut(room);
  }
}
function chooseCpuCard(room: Room, player: Player): Card | undefined {
  const legal = player.hand.filter(card => canPlay(card, room));
  if (!legal.length) return undefined;
  const level = player.difficulty || 'easy';
  const score = (card: Card) => {
    const sameColorCount = player.hand.filter(c => c.color === card.color).length;
    const special = card.kind.startsWith('draw') ? 9 : ['skip','skipall','reverse','swap7','rotate0','discardall'].includes(card.kind) ? 6 : 0;
    const urgency = player.hand.length <= 3 ? 7 : 0;
    const wildCost = card.color === 'wild' ? (level === 'easy' ? 0 : 4) : 0;
    if (level === 'easy') return Math.random() * 12;
    if (level === 'medium') return special + sameColorCount + Math.random() * 5 - wildCost * 0.5;
    if (level === 'hard') return special + sameColorCount * 2 + urgency - wildCost + Math.random() * 2;
    return special * 1.4 + sameColorCount * 3 + urgency * 1.5 - wildCost * 1.5 + (card.kind === 'draw10' ? 5 : 0) + Math.random();
  };
  return legal.sort((a, b) => score(b) - score(a))[0];
}
function cpuColor(player: Player): string {
  return COLORS.sort((a, b) => player.hand.filter(c => c.color === b).length - player.hand.filter(c => c.color === a).length)[0] || COLORS[rand(4)];
}
function runCpuTurns(room: Room) {
  let turns = 0;
  while (room.status === 'playing' && room.players[room.current]?.isCpu && turns++ < 30) {
    const cpu = room.players[room.current];
    const card = chooseCpuCard(room, cpu);
    if (card) {
      applyCard(room, cpu, card, card.color === 'wild' ? cpuColor(cpu) : undefined);
    } else {
      const amount = room.pendingDraw || 1;
      drawCards(room, cpu, amount);
      room.pendingDraw = 0;
      room.message = `${cpu.name} drew ${amount} card${amount === 1 ? '' : 's'}.`;
      advance(room);
      if (cpu.hand.length >= 25) {
        room.message = `${cpu.name} hit 25 cards and is out.`;
        removeOut(room);
      }
    }
  }
}
async function publish(room: Room) {
  for (const player of room.players) {
    await notifySubscribers('uno_room', room.id, publicRoom(room, player.id));
  }
}
const routes = {
  'POST /api/rooms': [
    async ({ body }) => {
      const input = body as { name?: string; playerId?: string; cpuDifficulty?: 'easy' | 'medium' | 'hard' | 'xhard' };
      if (!input.name?.trim() || !input.playerId)
        return error('Name and player ID are required.', 400);
      const room: Room = {
        id: '',
        inviteCode: '',
        status: 'lobby',
        players: [
          {
            id: input.playerId,
            name: input.name.trim().slice(0, 18),
            hand: [],
            host: true,
            uno: false,
          },
          ...(input.cpuDifficulty ? [1, 2, 3].map((n) => ({
            id: `cpu-${n}-${rand(999999)}`,
            name: `CPU ${n}`,
            hand: [],
            host: false,
            uno: false,
            isCpu: true,
            difficulty: input.cpuDifficulty,
          } as Player)) : []),
        ],
        deck: [],
        discard: [],
        current: 0,
        direction: 1,
        currentColor: 'red',
        pendingDraw: 0,
        version: 0,
      };
      const [id] = await db.add(TABLE, [room]);
      if (!id) return error('Could not create a room.', 500);
      room.id = id;
      const [saved] = await db.get<Room>(TABLE, [id], { consistent: true });
      if (!saved) return error('Room creation could not be confirmed.', 500);
      try {
        const invite = await invites.create({
          resourceType: 'uno_room',
          authMode: 'anonymous',
          expiresInSec: 60 * 60 * 24,
          context: { roomId: id },
        });
        const updated = { ...saved, inviteCode: invite.code, version: 1 };
        await db.update(TABLE, [{ id, record: updated }]);
        return json({ roomId: id, inviteCode: invite.code });
      } catch (err) {
        if (isInviteError(err)) return error(err.code, 400);
        throw err;
      }
    },
  ],
  'POST /api/join': [
    async ({ body }) => {
      const input = body as { code?: string; name?: string; playerId?: string };
      if (!input.code || !input.name?.trim() || !input.playerId)
        return error('Invite code, name and player ID are required.', 400);
      try {
        const resolved = await invites.resolve({ code: input.code });
        const roomId = String(resolved.context?.roomId || '');
        if (resolved.status !== 'open' || !roomId)
          return error('This invite is no longer active.', 400);
        await invites.join({ code: input.code });
        const room = await getRoom(roomId);
        if (!room) return error('Room not found.', 404);
        if (room.status !== 'lobby')
          return error('This game has already started.', 400);
        if (room.players.some(p => p.id === input.playerId))
          return json({ roomId });
        if (room.players.length >= 10)
          return error('This room is full (10 players).', 400);
        room.players.push({
          id: input.playerId,
          name: input.name.trim().slice(0, 18),
          hand: [],
          host: false,
          uno: false,
          isCpu: false,
        });
        await saveRoom(room, room.version);
        await publish(room);
        return json({ roomId });
      } catch (err) {
        if (isInviteError(err)) return error(err.code, 400);
        throw err;
      }
    },
  ],
  'GET /api/rooms/:id': [
    async ({ params, query }) => {
      const room = await getRoom(params.id);
      if (!room) return error('Room not found.', 404);
      const playerId = query.playerId || '';
      if (!room.players.some(p => p.id === playerId))
        return error('You are not in this room.', 403);
      return json(publicRoom(room, playerId));
    },
  ],
  'POST /api/rooms/:id/start': [
    async ({ params, body }) => {
      const input = body as { playerId?: string };
      const room = await getRoom(params.id);
      if (!room) return error('Room not found.', 404);
      if (room.players[0]?.id !== input.playerId)
        return error('Only the host can start the game.', 403);
      if (room.players.length < 2)
        return error('At least 2 players are needed.', 400);
      if (room.status !== 'lobby')
        return error('This game has already started.', 400);
      room.deck = makeDeck();
      room.players.forEach(p => {
        p.hand = room.deck.splice(0, 7);
      });
      let top = room.deck.pop()!;
      while (top.color === 'wild') {
        room.deck.unshift(top);
        top = room.deck.pop()!;
      }
      room.discard = [top];
      room.currentColor = top.color;
      room.current = 0;
      room.pendingDraw = 0;
      room.status = 'playing';
      room.message = 'The game is on.';
      await saveRoom(room, room.version);
      await publish(room);
      return json(publicRoom(room, input.playerId || ''));
    },
  ],
  'POST /api/rooms/:id/action': [
    async ({ params, body }) => {
      const input = body as {
        playerId?: string;
        action?: string;
        cardId?: string;
        color?: string;
      };
      const room = await getRoom(params.id);
      if (!room) return error('Room not found.', 404);
      const playerIndex = room.players.findIndex(p => p.id === input.playerId);
      if (playerIndex < 0) return error('You are not in this room.', 403);
      if (room.status !== 'playing')
        return error('The game is not active.', 400);
      if (room.players[room.current]?.id !== input.playerId)
        return error('It is not your turn.', 400);
      const player = room.players[playerIndex];
      if (input.action === 'uno') {
        player.uno = true;
        room.message = `${player.name} called UNO!`;
      } else if (input.action === 'draw') {
        const amount = room.pendingDraw || 1;
        drawCards(room, player, amount);
        room.pendingDraw = 0;
        room.message = `${player.name} drew ${amount} card${amount === 1 ? '' : 's'}.`;
        advance(room);
        if (player.hand.length >= 25) {
          room.message = `${player.name} hit 25 cards and is out.`;
          removeOut(room);
        }
      } else if (input.action === 'play' && input.cardId) {
        const card = player.hand.find(c => c.id === input.cardId);
        if (!card) return error('Card not found in your hand.', 400);
        applyCard(room, player, card, input.color);
      } else return error('Unknown action.', 400);
      runCpuTurns(room);
      await saveRoom(room, room.version);
      await publish(room);
      return json(publicRoom(room, input.playerId));
    },
  ],
  ...realtimeSubscriptionRoutes,
};
export const handler = router(routes);
