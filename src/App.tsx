import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ws, invitesClient } from '@appdeploy/client';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  Crown,
  DoorOpen,
  Flame,
  Info,
  Link2,
  LoaderCircle,
  Plus,
  RefreshCw,
  Send,
  Shield,
  Shuffle,
  Sparkles,
  Users,
  X,
} from 'lucide-react';

type Card = { id: string; color: string; value: string; kind: string };
type Player = { id: string; name: string; handCount: number; host?: boolean; isCpu?: boolean; difficulty?: string };
type GameState = {
  id: string;
  inviteCode: string;
  status: 'lobby' | 'playing' | 'finished';
  players: Player[];
  hand: Card[];
  top: Card | null;
  currentPlayerId: string;
  currentColor: string;
  direction: number;
  pendingDraw: number;
  version: number;
  winner?: string;
  message?: string;
  deckCount: number;
};
const COLORS = ['red', 'yellow', 'green', 'blue'];
const COLOR_HEX: Record<string, string> = {
  red: '#f06a62',
  yellow: '#f2c95c',
  green: '#62bd8b',
  blue: '#6599ed',
  wild: '#24262c',
};
const playerId = () => {
  let id = localStorage.getItem('nm-player-id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('nm-player-id', id);
  }
  return id;
};
const myId = playerId();

function CardFace({
  card,
  small = false,
  onClick,
  disabled = false,
}: {
  card: Card;
  small?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const color = COLOR_HEX[card.color] || COLOR_HEX.wild;
  return (
    <button
      className={`playing-card ${small ? 'small-card' : ''} ${disabled ? 'card-disabled' : ''}`}
      style={{ '--card-color': color } as React.CSSProperties}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="card-corner">{card.value}</span>
      <span className="card-center">
        {card.value === 'SKIP ALL'
          ? '⊘'
          : card.value === 'REVERSE'
            ? '↶'
            : card.value === 'WILD'
              ? '✳'
              : card.value}
      </span>
      <span className="card-corner bottom-corner">{card.value}</span>
    </button>
  );
}

function App() {
  const [screen, setScreen] = useState<'home' | 'lobby' | 'game'>('home');
  const [name, setName] = useState(
    localStorage.getItem('nm-player-name') || ''
  );
  const [code, setCode] = useState('');
  const [cpuDifficulty, setCpuDifficulty] = useState('none');
  const [game, setGame] = useState<GameState | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [wildChoice, setWildChoice] = useState(false);
  const [pendingCard, setPendingCard] = useState<Card | null>(null);
  const [finished, setFinished] = useState(false);
  const connRef = useRef<ReturnType<typeof ws.connect> | null>(null);
  const gameRef = useRef<GameState | null>(null);
  gameRef.current = game;
  const myPlayer = game?.players.find(p => p.id === myId);
  const isMyTurn = game?.currentPlayerId === myId;
  const inviteCode = game?.inviteCode || '';
  const shareUrl = useMemo(
    () =>
      inviteCode
        ? invitesClient.buildJoinUrl(inviteCode, { path: '#/join' })
        : '',
    [inviteCode]
  );

  const loadRoom = useCallback(async (roomId: string) => {
    const result = await api.get(
      `/api/rooms/${encodeURIComponent(roomId)}?playerId=${encodeURIComponent(myId)}`
    );
    setGame(result.data as GameState);
    setScreen(
      result.data.status === 'playing' || result.data.status === 'finished'
        ? 'game'
        : 'lobby'
    );
  }, []);

  const connectRoom = useCallback(async (roomId: string) => {
    if (connRef.current) return;
    const conn = ws.connect();
    connRef.current = conn;
    conn.onMessage((msg: any) => {
      if (
        msg?.type === 'entity.update' &&
        msg.payload?.entity_type === 'uno_room' &&
        msg.payload?.entity_id === roomId
      ) {
        const next = msg.payload.data as GameState;
        setGame(next);
        setScreen(next.status === 'lobby' ? 'lobby' : 'game');
      }
    });
    conn.onError(() =>
      setNotice('Live connection interrupted. Reconnecting may be needed.')
    );
    await conn.ready;
    if (conn.connectionId)
      await api.post('/api/subscriptions', {
        entity_type: 'uno_room',
        entity_id: roomId,
        connection_id: conn.connectionId,
      });
  }, []);

  useEffect(() => {
    const pending = invitesClient.getPendingCode();
    if (pending) setCode(pending);
    return () => {
      connRef.current?.disconnect();
      connRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (game?.status === 'finished') setFinished(true);
  }, [game?.status]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setNotice('');
    try {
      await fn();
    } catch (e: any) {
      setNotice(
        e?.response?.data?.error ||
          e?.message ||
          'Something went wrong. Try again.'
      );
    } finally {
      setBusy(false);
    }
  };

  const createRoom = () =>
    run(async () => {
      if (!name.trim()) throw new Error('Add your name first.');
      localStorage.setItem('nm-player-name', name.trim());
      const result = await api.post('/api/rooms', {
        name: name.trim(),
        playerId: myId,
        cpuDifficulty: cpuDifficulty === 'none' ? undefined : cpuDifficulty,
      });
      invitesClient.clearPendingCode();
      await loadRoom(result.data.roomId);
      await connectRoom(result.data.roomId);
      setNotice('Room created. Send the invite link to your friends.');
    });

  const joinRoom = (invite = code) =>
    run(async () => {
      if (!name.trim()) throw new Error('Add your name first.');
      if (!invite.trim())
        throw new Error('Enter an invite code or open a friend’s invite link.');
      localStorage.setItem('nm-player-name', name.trim());
      const result = await api.post('/api/join', {
        code: invite.trim(),
        name: name.trim(),
        playerId: myId,
      });
      invitesClient.clearPendingCode();
      await loadRoom(result.data.roomId);
      await connectRoom(result.data.roomId);
    });

  const refresh = () => game?.id && run(() => loadRoom(game.id));
  const startGame = () =>
    game &&
    run(async () => {
      const result = await api.post(`/api/rooms/${game.id}/start`, {
        playerId: myId,
      });
      setGame(result.data);
    });

  const act = (action: string, cardId?: string, color?: string) =>
    game &&
    run(async () => {
      const result = await api.post(`/api/rooms/${game.id}/action`, {
        playerId: myId,
        action,
        cardId,
        color,
      });
      setGame(result.data);
      setWildChoice(false);
      setPendingCard(null);
    });

  const playCard = (card: Card) => {
    if (!isMyTurn || busy) return;
    if (card.color === 'wild') {
      setPendingCard(card);
      setWildChoice(true);
      return;
    }
    void act('play', card.id);
  };

  const copyLink = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const backHome = () => {
    connRef.current?.disconnect();
    connRef.current = null;
    setGame(null);
    setScreen('home');
    setNotice('');
    setFinished(false);
  };

  if (screen === 'home')
    return (
      <main className="shell home-shell">
        <header className="topbar">
          <a className="brand" href="#">
            <span className="brand-mark">
              <Flame size={18} />
            </span>{' '}
            NO MERCY <span className="brand-muted">CARDS</span>
          </a>
          <button
            className="icon-button"
            onClick={() => setShowRules(true)}
            aria-label="Rules"
          >
            <Info size={18} />
          </button>
        </header>
        <section className="hero">
          <div className="eyebrow">
            <span className="live-dot" /> PRIVATE ROOMS · UP TO 10 PLAYERS
          </div>
          <h1>
            One table.
            <br />
            <em>No easy wins.</em>
          </h1>
          <p className="hero-copy">
            A chaotic card showdown. Bring your friends, stack the penalties,
            and try not to be the last one holding cards.
          </p>
          <div className="home-panel">
            <label className="field-label" htmlFor="player-name">
              YOUR NAME
            </label>
            <input
              id="player-name"
              className="text-input"
              value={name}
              maxLength={18}
              onChange={e => setName(e.target.value)}
              placeholder="Enter a nickname"
            />
            <label className="field-label" htmlFor="cpu-difficulty">PLAY MODE</label>
            <select id="cpu-difficulty" className="text-input cpu-select" value={cpuDifficulty} onChange={e => setCpuDifficulty(e.target.value)}>
              <option value="none">Friends / invite-only</option>
              <option value="easy">Play vs CPU · Easy</option>
              <option value="medium">Play vs CPU · Medium</option>
              <option value="hard">Play vs CPU · Hard</option>
              <option value="xhard">Play vs CPU · Extreme</option>
            </select>
            <button
              className="primary-button full-button"
              onClick={createRoom}
              disabled={busy || !name.trim()}
            >
              {busy ? (
                <LoaderCircle className="spin" size={18} />
              ) : (
                <Plus size={18} />
              )}{' '}
              Create a room
            </button>
            <div className="or-divider">
              <span>OR JOIN A FRIEND</span>
            </div>
            <div className="join-row">
              <input
                className="text-input"
                value={code}
                onChange={e => setCode(e.target.value.toUpperCase())}
                placeholder="Enter invite code"
                maxLength={32}
              />
              <button
                className="secondary-button"
                onClick={() => joinRoom()}
                disabled={busy || !name.trim() || !code.trim()}
              >
                Join <ArrowRight size={16} />
              </button>
            </div>
            <p className="microcopy">
              <Shield size={13} /> Private invite-only tables. No account
              needed.
            </p>
          </div>
          {notice && <p className="notice">{notice}</p>}
        </section>
        <footer className="home-footer">
          <span>BUILT FOR FRIEND GROUPS</span>
          <button className="text-button" onClick={() => setShowRules(true)}>
            How to play <ArrowRight size={14} />
          </button>
        </footer>
        {showRules && <RulesModal close={() => setShowRules(false)} />}
      </main>
    );

  if (!game)
    return (
      <main className="shell center-state">
        <LoaderCircle className="spin" size={26} />
        <p>Loading table…</p>
      </main>
    );

  if (screen === 'lobby')
    return (
      <main className="shell room-shell">
        <header className="topbar">
          <button className="brand brand-button" onClick={backHome}>
            <span className="brand-mark">
              <Flame size={18} />
            </span>{' '}
            NO MERCY <span className="brand-muted">CARDS</span>
          </button>
          <button className="icon-button" onClick={() => setShowRules(true)}>
            <Info size={18} />
          </button>
        </header>
        <section className="lobby-content">
          <div className="eyebrow">
            <span className="live-dot" /> ROOM OPEN
          </div>
          <h1>
            Waiting for
            <br />
            <em>the trouble.</em>
          </h1>
          <div className="invite-box">
            <div>
              <span className="field-label">INVITE FRIENDS</span>
              <strong className="invite-code">{inviteCode || '—'}</strong>
              <span className="microcopy">
                Share this link. Up to 10 players can join.
              </span>
            </div>
            <button className="secondary-button copy-button" onClick={copyLink}>
              {copied ? <Check size={16} /> : <Copy size={16} />}{' '}
              {copied ? 'Copied' : 'Copy link'}
            </button>
          </div>
          <div className="player-heading">
            <span>PLAYERS</span>
            <b>{game.players.length}/10</b>
          </div>
          <div className="player-list">
            {game.players.map((p, i) => (
              <div className="player-row" key={p.id}>
                <span className="avatar">
                  {p.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="player-name">
                  {p.name}
                  {p.id === myId ? ' (you)' : p.isCpu ? ` · CPU ${p.difficulty?.toUpperCase() || ''}` : ''}
                </span>
                {p.host && (
                  <span className="host-tag">
                    <Crown size={12} /> HOST
                  </span>
                )}
                <span className="player-number">
                  {String(i + 1).padStart(2, '0')}
                </span>
              </div>
            ))}
          </div>
          {myPlayer?.host ? (
            <button
              className="primary-button full-button start-button"
              onClick={startGame}
              disabled={busy || game.players.length < 2}
            >
              {busy ? (
                <LoaderCircle className="spin" size={18} />
              ) : (
                <Sparkles size={18} />
              )}{' '}
              Start game <span className="button-hint">2–10 players</span>
            </button>
          ) : (
            <div className="waiting-note">
              <LoaderCircle size={16} className="spin" /> Waiting for the host
              to start…
            </div>
          )}
          {game.players.length < 2 && (
            <p className="microcopy centered">
              You need at least 2 players to start.
            </p>
          )}
          {notice && <p className="notice">{notice}</p>}
        </section>
        {showRules && <RulesModal close={() => setShowRules(false)} />}
      </main>
    );

  const opponents = game.players.filter(p => p.id !== myId);
  const current = game.players.find(p => p.id === game.currentPlayerId);
  const myTurn = isMyTurn && game.status === 'playing';
  return (
    <main className="shell table-shell">
      <header className="game-topbar">
        <button className="brand brand-button" onClick={backHome}>
          <span className="brand-mark">
            <Flame size={18} />
          </span>{' '}
          NM<span className="brand-muted">/</span>CARDS
        </button>
        <div className="table-meta">
          <span className="room-pill">{game.players.length} PLAYERS</span>
          <button className="icon-button" onClick={() => setShowRules(true)}>
            <Info size={18} />
          </button>
        </div>
      </header>
      <section className="table-area">
        <div className="opponents-strip">
          {opponents.map((p, i) => (
            <div
              className={`opponent ${p.id === game.currentPlayerId ? 'active-opponent' : ''}`}
              key={p.id}
            >
              <span className="opponent-avatar">
                {p.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="opponent-name">{p.name}{p.isCpu ? ` · ${p.difficulty?.toUpperCase() || 'CPU'}` : ''}</span>
              <span className="opponent-count">{p.handCount} cards</span>
              {p.id === game.currentPlayerId && <span className="turn-dot" />}
            </div>
          ))}
        </div>
        <div className="center-table">
          <div className="turn-banner">
            {game.status === 'finished'
              ? 'ROUND OVER'
              : myTurn
                ? 'YOUR TURN'
                : `${current?.name || 'Someone'}’S TURN`}
            <span className="direction-mark">
              {game.direction === 1 ? '↻' : '↺'}
            </span>
          </div>
          <div className="pile-row">
            <div
              className="draw-pile"
              onClick={() => myTurn && !busy && act('draw')}
              role="button"
              tabIndex={0}
            >
              <div className="deck-back">
                <span>NM</span>
                <small>DRAW</small>
              </div>
              <span className="pile-label">DRAW {game.deckCount}</span>
            </div>
            <div className="discard-pile">
              {game.top && <CardFace card={game.top} small />}
              <span className="pile-label">DISCARD</span>
            </div>
          </div>
          <div className="table-status">
            {game.pendingDraw > 0 ? (
              <>
                <span className="penalty-count">+{game.pendingDraw}</span> DRAW
                PENALTY — STACK OR TAKE
              </>
            ) : (
              <>
                <span
                  className="color-dot"
                  style={{ background: COLOR_HEX[game.currentColor] }}
                />{' '}
                {game.currentColor.toUpperCase()} IS ACTIVE
              </>
            )}
          </div>
        </div>
        {game.message && <div className="game-message">{game.message}</div>}
        <div className="self-panel">
          <div className="self-header">
            <div>
              <span className="field-label">YOUR HAND</span>
              <strong>
                {game.hand.length} <small>CARDS</small>
              </strong>
            </div>
            <div className="self-actions">
              <button className="icon-button" onClick={refresh} title="Refresh">
                <RefreshCw size={16} />
              </button>
              <button className="icon-button" onClick={copyLink} title="Invite">
                <Link2 size={16} />
              </button>
            </div>
          </div>
          <div className="hand-row">
            {game.hand.map(card => (
              <CardFace
                key={card.id}
                card={card}
                onClick={() => playCard(card)}
                disabled={
                  !myTurn ||
                  busy ||
                  (game.pendingDraw > 0 && !card.kind.startsWith('draw'))
                }
              />
            ))}
          </div>
          <div className="action-row">
            <button
              className="secondary-button"
              onClick={() => act('draw')}
              disabled={!myTurn || busy}
            >
              <ArrowDown size={16} /> Draw card
            </button>
            <button
              className="primary-button"
              onClick={() => act('uno')}
              disabled={!myTurn || busy || game.hand.length > 2}
            >
              UNO!
            </button>
          </div>
        </div>
      </section>
      {notice && (
        <div className="toast">
          {notice}
          <button onClick={() => setNotice('')}>
            <X size={14} />
          </button>
        </div>
      )}
      {finished && (
        <div className="modal-backdrop">
          <div className="modal-card result-card">
            <div className="result-icon">
              <Crown size={28} />
            </div>
            <span className="eyebrow">GAME FINISHED</span>
            <h2>
              {game.winner === myId
                ? 'You won.'
                : `${game.players.find(p => p.id === game.winner)?.name || 'A player'} won.`}
            </h2>
            <p>That was a ruthless round.</p>
            <button className="primary-button full-button" onClick={backHome}>
              Back to home
            </button>
          </div>
        </div>
      )}
      {wildChoice && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <button
              className="modal-close"
              onClick={() => setWildChoice(false)}
            >
              <X size={18} />
            </button>
            <span className="eyebrow">WILD CARD</span>
            <h2>Choose a colour</h2>
            <div className="color-choices">
              {COLORS.map(c => (
                <button
                  key={c}
                  style={{ background: COLOR_HEX[c] }}
                  onClick={() => pendingCard && act('play', pendingCard.id, c)}
                  aria-label={c}
                />
              ))}
            </div>
          </div>
        </div>
      )}
      {showRules && <RulesModal close={() => setShowRules(false)} />}
    </main>
  );
}

function RulesModal({ close }: { close: () => void }) {
  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal-card rules-card" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={close}>
          <X size={18} />
        </button>
        <span className="eyebrow">QUICK RULES</span>
        <h2>Play mean. Play smart.</h2>
        <ul>
          <li>Match the active colour or the symbol on the discard pile.</li>
          <li>
            Stack draw cards (+2, +4, +6 and +10) to pass the growing penalty
            along.
          </li>
          <li>
            Skip, reverse, skip-all and discard-all cards can swing the table.
          </li>
          <li>
            7 lets you swap hands with a player. 0 rotates every hand in the
            current direction.
          </li>
          <li>Reach 25 cards and you’re out. Empty your hand to win.</li>
          <li>Say UNO when you’re down to one card. Don’t forget.</li>
        </ul>
        <p className="rules-foot">
          A house-rules card game inspired by high-chaos shedding games. Not
          affiliated with or endorsed by any official UNO brand.
        </p>
        <button className="primary-button full-button" onClick={close}>
          Got it
        </button>
      </div>
    </div>
  );
}

export default App;
