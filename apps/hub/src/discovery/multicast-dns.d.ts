/**
 * The part of `multicast-dns` the mDNS source uses.
 *
 * The package ships no types, and the ones on DefinitelyTyped pull in `dns-packet`'s as well for
 * the three calls made here, so they are written down instead - loosely where the packet is
 * concerned, since the source checks every record it reads.
 */
declare module 'multicast-dns' {
  /** One resource record, as `dns-packet` decodes it. */
  export type MulticastDnsRecord = {
    readonly name: string;
    readonly type: string;
    readonly ttl?: number;
    readonly data?: unknown;
  };

  /** One decoded packet. */
  export type MulticastDnsPacket = {
    readonly answers?: readonly MulticastDnsRecord[];
    readonly additionals?: readonly MulticastDnsRecord[];
  };

  /** One question. */
  export type MulticastDnsQuestion = { readonly name: string; readonly type: string };

  /** Where a packet came from. */
  export type MulticastDnsRemote = { readonly address: string; readonly port: number };

  /** The options the source passes. */
  export type MulticastDnsOptions = {
    /** The interface address to join the group on and send from. */
    readonly interface?: string;

    /** The address to bind to; the interface's when not said, which Linux cannot receive on. */
    readonly bind?: string;
  };

  /** One socket on the mDNS group. */
  export type MulticastDns = {
    /**
     * Hears the answers on the group, whoever asked.
     *
     * @param event - `response`.
     * @param listener - Called with each answer and who sent it.
     * @returns The socket.
     */
    on(
      event: 'response',
      listener: (packet: MulticastDnsPacket, remote: MulticastDnsRemote) => void,
    ): MulticastDns;

    /**
     * Hears the questions on the group: what a responder standing in for a device answers.
     *
     * @param event - `query`.
     * @param listener - Called with each question and who asked it.
     * @returns The socket.
     */
    on(
      event: 'query',
      listener: (
        packet: { readonly questions: readonly MulticastDnsQuestion[] },
        remote: MulticastDnsRemote,
      ) => void,
    ): MulticastDns;

    /**
     * Hears the socket's failures.
     *
     * @param event - `error` for the port or the interface, `warning` for the rest.
     * @param listener - Called with the failure.
     * @returns The socket.
     */
    on(event: 'error' | 'warning', listener: (error: Error) => void): MulticastDns;

    /**
     * Asks the group.
     *
     * @param query - The packet.
     * @param query.questions - What it asks.
     */
    query(query: { readonly questions: readonly MulticastDnsQuestion[] }): void;

    /**
     * Answers, as a device does: what the tests use to stand in for one.
     *
     * @param response - The records.
     * @param callback - Called once it is sent.
     */
    respond(response: MulticastDnsPacket, callback?: () => void): void;

    /**
     * Leaves the group and closes the socket.
     *
     * @param callback - Called once it is closed.
     */
    destroy(callback?: () => void): void;
  };

  /**
   * Opens a socket on the mDNS group.
   *
   * @param options - Which interface, and where to bind.
   * @returns The socket.
   */
  function createMulticastDns(options?: MulticastDnsOptions): MulticastDns;

  // The package is CommonJS and exports this one function: a default import is what it is.
  // eslint-disable-next-line import-x/no-default-export
  export default createMulticastDns;
}
