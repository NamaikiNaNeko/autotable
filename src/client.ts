/* eslint no-console: 0 */

import { Message, Player, Thing } from '../server/protocol';

interface Game {
  gameId: string;
  num: number;
  secret: string;
  players: Array<Player | null>;
  things: Array<Thing>;
}

export enum Status {
  NEW = 'NEW',
  CONNECTING = 'CONNECTING',
  JOINING = 'JOINING',
  JOINED = 'JOINED',
  DISCONNECTED = 'DISCONNECTED',
}

const PLAYER_UPDATE_RATE = 100;

export class Client {
  private ws: WebSocket | null = null;
  game: Game | null = null;
  private joinGameId: string | null = null;
  private joinSecret: string | null = null;

  player: Player = {};

  handlers: Record<string, Array<Function>> = {};

  lastPlayerUpdate = 0;
  playerDirty = false;
  updateIntervalId: number | null = null;

  connect(url: string, gameId: string | null, secret: string | null): void {
    if (this.isConnected()) {
      return;
    }
    this.ws = new WebSocket(url);
    this.ws.onopen = this.onOpen.bind(this);
    this.ws.onclose = this.onClose.bind(this);

    this.joinGameId = gameId;
    this.joinSecret = secret;

    this.ws.onmessage = event => {
      const message = JSON.parse(event.data as string) as Message;
      console.log('recv', message);
      this.onMessage(message);
    };

    this.event('status', f => f(this.status()));
  }

  on(what: 'status', handler: (status: Status) => void): void;
  on<P>(what: 'players', handler: (players: Array<P | null>) => void): void;
  on<T>(what: 'update', handler: (things: Record<number, T>) => void): void;
  on<T>(what: 'replace', handler: (things: Array<T>) => void): void;

  on(what: string, handler: Function): void {
    if (this.handlers[what] === undefined) {
      this.handlers[what] = [];
    }
    this.handlers[what].push(handler);

    if (what === 'status') {
      setTimeout(() => handler(this.status()), 0);
    }
    if (what === 'players') {
      setTimeout(handler(this.players()), 0);
    }
  }

  private event(what: string, func: (handler: Function) => void): void {
    if (this.handlers[what] !== undefined) {
      for (const handler of this.handlers[what]) {
        setTimeout(() => func(handler), 0);
      }
    }
  }

  status(): Status {
    if (!this.ws) {
      return Status.NEW;
    }

    if (this.isConnected() && this.game) {
      return Status.JOINED;
    }
    if (this.isConnected()) {
      return Status.JOINING;
    }
    if (this.ws.readyState === WebSocket.OPEN) {
      return Status.CONNECTING;
    }
    return Status.DISCONNECTED;
  }

  players(): Array<Player> {
    return this.game ? this.game.players : new Array(4).fill(null);
  }

  updatePlayer<P>(player: P): void {
    Object.assign(this.player, player);
    this.playerDirty = true;
    const now = new Date().getTime();
    if (now - this.lastPlayerUpdate > PLAYER_UPDATE_RATE) {
      this.sendPlayer();
    }
  }

  update<T>(things: Record<number, T>): void {
    this.send({ type: 'UPDATE', things });
  }

  replace<T>(allThings: Array<T>): void {
    this.send({ type: 'REPLACE', allThings });
  }

  private send(message: Message): void {
    if (!this.isConnected()) {
      return;
    }
    console.log('send', message);
    const data = JSON.stringify(message);
    this.ws!.send(data);
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  private sendPlayer(): void {
    if (this.isConnected() && this.game) {
      this.send({
        type: 'PLAYER',
        num: this.game.num,
        player: this.player,
      });
      this.playerDirty = false;
      this.lastPlayerUpdate = new Date().getTime();
    }
  }

  private checkSendPlayer(): void{
    if (this.playerDirty) {
      this.sendPlayer();
    }
  }

  private onOpen(): void {
    this.send({
      type: 'JOIN',
      gameId: this.joinGameId,
      secret: this.joinSecret,
    });
    this.event('status', f => f(this.status()));
    if (this.updateIntervalId === null) {
      this.updateIntervalId = setInterval(this.checkSendPlayer.bind(this), PLAYER_UPDATE_RATE);
    }
  }

  private onClose(): void {
    if (this.updateIntervalId !== null) {
      clearInterval(this.updateIntervalId);
    }
    this.updateIntervalId = null;
    this.game = null;

    this.event('status', f => f(this.status()));
    this.event('players', f => f(this.players()));
  }

  private onMessage(message: Message): void {
    switch (message.type) {
      case 'JOINED':
        this.game = {
          gameId: message.gameId,
          num: message.num,
          secret: message.secret,
          players: new Array(4).fill(null),
          things: [],
        };
        window.location.hash = this.game.gameId;
        this.sendPlayer();
        this.event('status', f => f(this.status()));
        break;

      case 'PLAYER':
        this.game!.players[message.num] = message.player;
        this.event('players', f => f(this.players()));
        break;

      case 'UPDATE':
        for (const index in message.things) {
          this.game!.things[index] = message.things[index];
        }
        this.event('update', f => f(message.things));
        break;

      case 'REPLACE':
        this.game!.things = message.allThings;
        this.event('replace', f => f(message.allThings));
        break;
    }
  }
}
