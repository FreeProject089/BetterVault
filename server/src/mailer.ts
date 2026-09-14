import { connect as netConnect, type Socket } from 'node:net';
import { connect as tlsConnect, type TLSSocket } from 'node:tls';
import { randomUUID } from 'node:crypto';

/**
 * Client SMTP minimal (aucune dépendance) pour les emails du serveur :
 * code de réinitialisation, alerte de connexion, changement de mot de passe.
 */

export type SmtpSecurity = 'tls' | 'starttls' | 'none';

export interface SmtpConfig {
  host: string;
  port: number;
  security: SmtpSecurity;
  user: string;
  password: string;
  from: string;
  /** Accepter un certificat auto-signé (serveur SMTP interne) */
  allowInvalidCertificate?: boolean;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

const TIMEOUT_MS = 15_000;

class SmtpConnection {
  private socket: Socket | TLSSocket;
  private buffer = '';
  /** Lignes reçues avant qu'une lecture ne les attende (réponses multi-lignes arrivées d'un bloc) */
  private lines: string[] = [];
  private waiters: Array<(line: string) => void> = [];
  private failure: Error | null = null;

  constructor(socket: Socket | TLSSocket) {
    this.socket = socket;
    this.attach(socket);
  }

  private attach(socket: Socket | TLSSocket): void {
    socket.setEncoding('utf8');
    socket.setTimeout(TIMEOUT_MS, () => this.fail(new Error('Délai dépassé avec le serveur SMTP')));
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      let index: number;
      while ((index = this.buffer.indexOf('\n')) !== -1) {
        const line = this.buffer.slice(0, index).replace(/\r$/, '');
        this.buffer = this.buffer.slice(index + 1);
        const waiter = this.waiters.shift();
        if (waiter) waiter(line);
        else this.lines.push(line);
      }
    });
    socket.on('error', err => this.fail(err));
    socket.on('close', () => this.fail(new Error('Connexion SMTP fermée')));
  }

  private fail(err: Error): void {
    if (this.failure) return;
    this.failure = err;
    this.socket.destroy();
    const waiters = this.waiters;
    this.waiters = [];
    waiters.forEach(waiter => waiter(`__error__`));
  }

  private nextLine(): Promise<string> {
    const queued = this.lines.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      this.waiters.push(line => (line === '__error__' ? reject(this.failure) : resolve(line)));
    });
  }

  /** Lit une réponse complète (lignes « 250-… » puis « 250 … ») et vérifie le code attendu */
  async read(expected: number): Promise<string[]> {
    const lines: string[] = [];
    for (;;) {
      const line = await this.nextLine();
      lines.push(line);
      if (!/^\d{3}-/.test(line)) break;
    }
    const code = Number(lines[lines.length - 1].slice(0, 3));
    if (code !== expected) throw new Error(`Réponse SMTP inattendue : ${lines.join(' | ')}`);
    return lines;
  }

  async command(line: string, expected: number): Promise<string[]> {
    this.socket.write(`${line}\r\n`);
    return this.read(expected);
  }

  write(data: string): void {
    this.socket.write(data);
  }

  async upgradeToTls(host: string, allowInvalid: boolean): Promise<void> {
    const plain = this.socket;
    plain.removeAllListeners('data');
    plain.removeAllListeners('close');
    plain.removeAllListeners('error');
    plain.setTimeout(0);
    const secure = await new Promise<TLSSocket>((resolve, reject) => {
      const tls = tlsConnect({ socket: plain as Socket, servername: host, rejectUnauthorized: !allowInvalid }, () => resolve(tls));
      tls.once('error', reject);
    });
    this.socket = secure;
    this.attach(secure);
  }

  close(): void {
    this.socket.end();
  }
}

function openSocket(config: SmtpConfig): Promise<Socket | TLSSocket> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => reject(err);
    const socket = config.security === 'tls'
      ? tlsConnect({ host: config.host, port: config.port, servername: config.host, rejectUnauthorized: !config.allowInvalidCertificate }, () => resolve(socket))
      : netConnect({ host: config.host, port: config.port }, () => resolve(socket));
    socket.once('error', onError);
    socket.setTimeout(TIMEOUT_MS, () => {
      socket.destroy();
      reject(new Error('Serveur SMTP injoignable (délai dépassé)'));
    });
  });
}

const encodeHeader = (value: string) => (/^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value).toString('base64')}?=`);

const addressOf = (value: string) => /<([^>]+)>/.exec(value)?.[1] ?? value.trim();

export function buildMessage(from: string, message: MailMessage, now = new Date()): string {
  const body = Buffer.from(message.text.replace(/\r?\n/g, '\r\n')).toString('base64').replace(/.{76}/g, '$&\r\n');
  const domain = addressOf(from).split('@')[1] ?? 'bettervault.local';
  return [
    `From: ${from}`,
    `To: ${message.to}`,
    `Subject: ${encodeHeader(message.subject)}`,
    `Date: ${now.toUTCString()}`,
    `Message-ID: <${randomUUID()}@${domain}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    body
  ].join('\r\n');
}

export async function sendMail(config: SmtpConfig, message: MailMessage): Promise<void> {
  if (/[\r\n]/.test(message.to + message.subject + config.from)) throw new Error('En-tête email invalide');
  const connection = new SmtpConnection(await openSocket(config));
  try {
    await connection.read(220);
    const ehlo = await connection.command('EHLO bettervault', 250);

    if (config.security === 'starttls') {
      if (!ehlo.some(line => /STARTTLS/i.test(line))) throw new Error('Le serveur SMTP ne propose pas STARTTLS');
      await connection.command('STARTTLS', 220);
      await connection.upgradeToTls(config.host, !!config.allowInvalidCertificate);
      await connection.command('EHLO bettervault', 250);
    }

    if (config.user) {
      const token = Buffer.from(`\0${config.user}\0${config.password}`).toString('base64');
      await connection.command(`AUTH PLAIN ${token}`, 235);
    }

    await connection.command(`MAIL FROM:<${addressOf(config.from)}>`, 250);
    await connection.command(`RCPT TO:<${addressOf(message.to)}>`, 250);
    await connection.command('DATA', 354);
    // Transparence SMTP : une ligne commençant par « . » est doublée
    connection.write(`${buildMessage(config.from, message).replace(/\r\n\./g, '\r\n..')}\r\n.\r\n`);
    await connection.read(250);
    await connection.command('QUIT', 221).catch(() => undefined);
  } finally {
    connection.close();
  }
}

export function createSmtpMailer(config: SmtpConfig): Mailer {
  return { send: message => sendMail(config, message) };
}
