declare module 'nodemailer' {
  interface TransportOptions {
    host?: string;
    port?: number;
    secure?: boolean;
    auth?: { user: string; pass: string };
  }
  interface SendMailOptions {
    from: string;
    to: string;
    subject: string;
    text?: string;
    html?: string;
    inReplyTo?: string;
  }
  interface SendMailResult {
    messageId: string;
    accepted: string[];
    rejected: string[];
    response: string;
  }
  interface Transporter {
    sendMail(options: SendMailOptions): Promise<SendMailResult>;
  }
  function createTransport(options: TransportOptions): Transporter;
  export { createTransport, Transporter, SendMailOptions, SendMailResult, TransportOptions };
}

